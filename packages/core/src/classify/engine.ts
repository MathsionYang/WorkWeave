import type { ActivityCategory, SessionId } from "../domain/types.js";
import { asConfidence } from "../domain/types.js";
import { isNoiseText } from "../facts/noise.js";
import { deriveProjectName } from "./project-name.js";
import {
  RULE_PRIORITY_RANK,
  type ClassificationRule,
  type ClassificationSignal,
  type ClassifiedSession,
  type ClassifyConfig,
  type ConsistencyReport,
  type ProjectRef,
  type RulePriority
} from "./types.js";

interface Heuristic {
  readonly category: ActivityCategory;
  readonly confidence: number;
  readonly reason: string;
}

const CATEGORY_KEYWORDS: readonly { readonly category: ActivityCategory; readonly words: readonly string[] }[] = [
  { category: "debugging", words: ["bug", "error", "exception", "fix", "调试", "排错", "异常", "崩溃"] },
  { category: "testing", words: ["test", "pytest", "jest", "vitest", "测试", "用例", "覆盖率"] },
  { category: "research", words: ["research", "调研", "对比", "查阅", "验证", "探索"] },
  { category: "requirements-design", words: ["需求", "设计", "方案", "spec", "architecture"] },
  { category: "documentation", words: ["文档", "readme", "docs", "说明", "注释"] },
  { category: "optimization", words: ["优化", "todo", "技术债", "重构建议", "风险"] },
  { category: "coding", words: ["implement", "代码", "开发", "新增", "修改", "refactor", "实现"] }
];

const PURE_CONVERSATION_WORDS: readonly { readonly kind: string; readonly words: readonly string[] }[] = [
  { kind: "status-sync", words: ["进度", "同步", "站会", "status"] },
  { kind: "knowledge-qa", words: ["什么是", "为什么", "怎么理解", "区别", "解释"] },
  { kind: "discussion", words: ["讨论", "方案", "权衡", "trade-off"] },
  { kind: "coordination", words: ["协调", "安排", "对接", "沟通"] },
  { kind: "chitchat", words: ["闲聊", "随便聊", "天气"] }
];

function collectText(signal: ClassificationSignal): string {
  const parts: string[] = [];
  if (signal.title !== undefined) parts.push(signal.title);
  for (const message of signal.messages) {
    if (message.text !== undefined && !isNoiseText(message.text)) parts.push(message.text);
  }
  return parts.join("\n").toLowerCase();
}

function matchesRule(rule: ClassificationRule, signal: ClassificationSignal, text: string): boolean {
  if (rule.sourceTool !== undefined && rule.sourceTool !== signal.sourceTool) return false;
  if (rule.workDirPrefix !== undefined) {
    if (signal.workDir === undefined || !signal.workDir.startsWith(rule.workDirPrefix)) return false;
  }
  if (rule.titleContains !== undefined) {
    if (signal.title === undefined || !signal.title.toLowerCase().includes(rule.titleContains.toLowerCase())) {
      return false;
    }
  }
  if (rule.keyword !== undefined && !text.includes(rule.keyword.toLowerCase())) return false;
  if (rule.repoName !== undefined) {
    if (signal.workDir === undefined || !signal.workDir.toLowerCase().includes(rule.repoName.toLowerCase())) {
      return false;
    }
  }
  return true;
}

function projectFromStructured(signal: ClassificationSignal): { project: ProjectRef; reason: string; confidence: number } {
  const paths = signal.filePaths ?? [];
  if (paths.length >= 2) {
    const roots = new Set(paths.map((path) => path.split(/[\\/]/).slice(0, 3).join("/")));
    if (roots.size > 1) {
      return { project: "cross-project", reason: "file paths span multiple repositories", confidence: 0.8 };
    }
  }
  if (signal.workDir !== undefined) {
    const derived = deriveProjectName(signal.workDir);
    if (derived.name !== undefined) {
      return { project: derived.name, reason: derived.reason, confidence: 0.8 };
    }
  }
  return { project: "unassigned", reason: "no structured project cue", confidence: 0.4 };
}

function heuristicCategory(signal: ClassificationSignal, text: string): Heuristic {
  let best: Heuristic | undefined;
  for (const entry of CATEGORY_KEYWORDS) {
    const hits = entry.words.filter((word) => text.includes(word)).length;
    if (hits === 0) continue;
    const candidate: Heuristic = {
      category: entry.category,
      confidence: Math.min(0.9, 0.55 + hits * 0.1),
      reason: `keyword hits for ${entry.category}: ${hits}`
    };
    if (best === undefined || candidate.confidence > best.confidence) best = candidate;
  }
  if (best !== undefined) return best;

  const hasDeliverable = (signal.filePaths?.length ?? 0) > 0 || /\b(commit|diff|patch)\b/i.test(text);
  if (!hasDeliverable) {
    return { category: "pure-conversation", confidence: 0.65, reason: "no deliverable or code signal" };
  }
  return { category: "coding", confidence: 0.5, reason: "default coding category" };
}

function pureConversationKind(text: string): ClassifiedSession["pureConversationKind"] {
  for (const entry of PURE_CONVERSATION_WORDS) {
    if (entry.words.some((word) => text.includes(word))) {
      return entry.kind as NonNullable<ClassifiedSession["pureConversationKind"]>;
    }
  }
  return "no-action";
}

function classificationFrom(
  signal: ClassificationSignal,
  project: ProjectRef,
  category: ActivityCategory,
  basis: RulePriority,
  confidence: number,
  reasons: readonly string[],
  locked: boolean,
  threshold: number
): ClassifiedSession {
  const value = asConfidence(Math.min(1, Math.max(0, confidence)));
  return {
    sessionId: signal.sessionId,
    projectId: project,
    category,
    ...(category === "pure-conversation"
      ? { pureConversationKind: pureConversationKind(collectText(signal)) }
      : {}),
    secondaryCategories: [],
    basis,
    confidence: value,
    locked,
    pending: value < threshold,
    reasons
  };
}

export function classifySession(signal: ClassificationSignal, config: ClassifyConfig = {}): ClassifiedSession {
  const threshold = config.threshold ?? 0.6;
  const text = collectText(signal);
  const manual = config.manualOverrides?.find((override) => override.sessionId === signal.sessionId);

  if (manual !== undefined) {
    const structured = projectFromStructured(signal);
    const heuristic = heuristicCategory(signal, text);
    return classificationFrom(
      signal,
      manual.projectId ?? structured.project,
      manual.category ?? heuristic.category,
      "manual",
      0.99,
      ["manual override applied"],
      true,
      threshold
    );
  }

  const rules = [...(config.rules ?? [])].sort(
    (a, b) => RULE_PRIORITY_RANK[a.priority] - RULE_PRIORITY_RANK[b.priority]
  );
  for (const rule of rules) {
    if (rule.priority === "manual") continue;
    if (!matchesRule(rule, signal, text)) continue;
    if (rule.projectId === undefined && rule.category === undefined) continue;
    const structured = projectFromStructured(signal);
    const heuristic = heuristicCategory(signal, text);
    return classificationFrom(
      signal,
      rule.projectId ?? structured.project,
      rule.category ?? heuristic.category,
      rule.priority,
      rule.priority === "manual-rule" ? 0.95 : rule.priority === "configured-rule" ? 0.9 : 0.7,
      [`rule matched: ${rule.name}`],
      false,
      threshold
    );
  }

  const structured = projectFromStructured(signal);
  const heuristic = heuristicCategory(signal, text);
  return classificationFrom(
    signal,
    structured.project,
    heuristic.category,
    "structured-feature",
    Math.min(structured.confidence, heuristic.confidence),
    [structured.reason, heuristic.reason],
    false,
    threshold
  );
}

export function classifySessions(
  signals: readonly ClassificationSignal[],
  config: ClassifyConfig = {}
): readonly ClassifiedSession[] {
  return signals.map((signal) => classifySession(signal, config));
}

export function checkConsistency(
  signals: readonly ClassificationSignal[],
  classifications: readonly ClassifiedSession[]
): ConsistencyReport {
  const projectCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  for (const classification of classifications) {
    projectCounts[classification.projectId] = (projectCounts[classification.projectId] ?? 0) + 1;
    categoryCounts[classification.category] = (categoryCounts[classification.category] ?? 0) + 1;
  }
  const projectSum = Object.values(projectCounts).reduce((sum, value) => sum + value, 0);
  const categorySum = Object.values(categoryCounts).reduce((sum, value) => sum + value, 0);
  const conflicts: string[] = [];
  if (projectSum !== signals.length) conflicts.push(`project sum ${projectSum} != sessions ${signals.length}`);
  if (categorySum !== signals.length) conflicts.push(`category sum ${categorySum} != sessions ${signals.length}`);
  return {
    totalSessions: signals.length,
    projectCounts,
    categoryCounts,
    projectSum,
    categorySum,
    consistent: conflicts.length === 0,
    conflicts
  };
}

export function lockedSessionIds(classifications: readonly ClassifiedSession[]): readonly SessionId[] {
  return classifications.filter((classification) => classification.locked).map((classification) => classification.sessionId);
}