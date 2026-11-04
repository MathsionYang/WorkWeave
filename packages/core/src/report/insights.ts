import type { ParsedSession } from "../ingest/types.js";
import type { ClassifiedSession } from "../classify/types.js";
import type { SubmissionLike } from "../adoption/engine.js";
import type { ResearchFinding } from "../adoption/research.js";
import type { TestFact } from "../domain/models.js";
import { isNoiseText } from "../facts/noise.js";

export interface ProjectInsight {
  readonly tasks: readonly string[];
  readonly completions: readonly string[];
  readonly problems: readonly string[];
  readonly optimizations: readonly string[];
  readonly risks: readonly string[];
  readonly blockers: readonly string[];
  readonly nextSteps: readonly string[];
}

export interface ReportInsights {
  readonly summary: string;
  readonly projects: ReadonlyMap<string, ProjectInsight>;
  readonly nextSteps: readonly string[];
}

export interface InsightInput {
  readonly sessions: readonly ParsedSession[];
  readonly classifications: readonly ClassifiedSession[];
  readonly tests: readonly TestFact[];
  readonly submissions: readonly SubmissionLike[];
  readonly research: readonly ResearchFinding[];
}

const TASK = /(请|帮我|需要|实现|开发|新增|修复|排查|检查|优化|重构|调研|确认|处理)/i;
const COMPLETION = /(已完成|已修复|已实现|已生成|已更新|已补充|已通过|已跑通|完成|修复了|实现了|生成了|新增了|通过了)/i;
const PROBLEM = /(问题|报错|错误|异常|失败|bug|崩溃|根因|不兼容|卡住|无法)/i;
const OPTIMIZATION = /(待优化|优化|todo|技术债|遗留|后续|改进|风险|阻塞)/i;
const RISK = /(风险|隐患|潜在|担心)/i;
const BLOCKER = /(阻塞|受阻|权限不足|无法继续|无法发布)/i;
const NOISE_LINE = /^(>|#|\*\*|\d+\.\s|\||执行命令|命令输出|stdout|stderr)/i;

function cleanSnippet(text: string): string {
  let value = text
    .replace(/\[\{[\s\S]*$/i, "")
    .replace(/^[-*]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (value.length > 120) value = `${value.slice(0, 119)}…`;
  return value;
}

function sentences(text: string): readonly string[] {
  return text
    .split(/[。；;\n]/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 5 && line.length <= 160 && !NOISE_LINE.test(line));
}

function addUnique(target: string[], value: string, limit: number): void {
  if (target.includes(value) || target.length >= limit) return;
  target.push(value);
}

function projectOf(session: ParsedSession, classifications: readonly ClassifiedSession[]): string | undefined {
  const classification = classifications.find((item) => item.sessionId === session.sessionId);
  if (classification === undefined) return undefined;
  if (classification.category === "pure-conversation") return undefined;
  if (classification.projectId === "cross-project" || classification.projectId === "unassigned") return undefined;
  return classification.projectId;
}

export function extractReportInsights(input: InsightInput): ReportInsights {
  const byProject = new Map<string, {
    tasks: string[];
    completions: string[];
    problems: string[];
    optimizations: string[];
    risks: string[];
    blockers: string[];
    nextSteps: string[];
  }>();

  for (const session of input.sessions) {
    const projectId = projectOf(session, input.classifications);
    if (projectId === undefined) continue;
    const bucket = byProject.get(projectId) ?? {
      tasks: [],
      completions: [],
      problems: [],
      optimizations: [],
      risks: [],
      blockers: [],
      nextSteps: []
    };

    for (const message of session.messages) {
      if (message.role === "system" || message.role === "developer") continue;
      if (isNoiseText(message.text)) continue;
      const text = message.text ?? "";

      for (const sentence of sentences(text)) {
        const cleaned = cleanSnippet(sentence);
        if (cleaned.length === 0) continue;
        if (message.role === "user" && TASK.test(cleaned)) {
          addUnique(bucket.tasks, cleaned, 5);
        }
        if ((message.role === "assistant" || message.role === "tool") && COMPLETION.test(cleaned)) {
          addUnique(bucket.completions, cleaned, 7);
        }
        if (
          PROBLEM.test(cleaned) &&
          !(message.role === "user" && TASK.test(cleaned)) &&
          !OPTIMIZATION.test(cleaned)
        ) {
          addUnique(bucket.problems, cleaned, 4);
        }
        if (OPTIMIZATION.test(cleaned)) {
          addUnique(bucket.optimizations, cleaned, 5);
        }
        if (RISK.test(cleaned)) {
          addUnique(bucket.risks, cleaned, 3);
        }
        if (BLOCKER.test(cleaned)) {
          addUnique(bucket.blockers, cleaned, 3);
        }
      }
    }

    byProject.set(projectId, bucket);
  }

  const nextSteps: string[] = [];
  const projectBySession = new Map(
    input.classifications.map((classification) => [classification.sessionId, classification.projectId])
  );
  for (const test of input.tests) {
    if (test.status === "failed" && nextSteps.length < 5) {
      const reason = test.failureReason === undefined
        ? ""
        : `（${test.failureReason.replace(/\s+/g, " ").slice(0, 80)}）`;
      nextSteps.push(`[高] 修复失败测试：${test.type}${reason}`);
    }
  }
  for (const [projectId, bucket] of byProject) {
    for (const blocker of bucket.blockers) {
      if (nextSteps.length < 5) nextSteps.push(`[高] 解除阻塞：${blocker}（项目：${projectId}）`);
    }
    for (const risk of bucket.risks) {
      if (nextSteps.length < 5) nextSteps.push(`[中] 处理风险：${risk}（项目：${projectId}）`);
    }
    for (const optimization of bucket.optimizations) {
      if (nextSteps.length < 5) nextSteps.push(`[中] 推进优化：${optimization}（项目：${projectId}）`);
    }
  }
  for (const research of input.research) {
    if (research.conclusion !== "concluded" && nextSteps.length < 5) {
      nextSteps.push(`[中] 推进调研：${research.topic}`);
    }
  }

  const top = [...byProject.entries()].find(([, bucket]) => bucket.completions.length > 0 || bucket.tasks.length > 0);
  let summary = "未检测到可读工作结论（采集 " + String(input.sessions.length) + " 个会话，消息缺少可读任务或结果）";
  if (top !== undefined) {
    const [projectId, bucket] = top;
    const focus = bucket.completions[0] ?? bucket.tasks[0] ?? "";
    const short = focus.length > 36 ? `${focus.slice(0, 36)}…` : focus;
    summary = bucket.completions.length > 0
      ? `今日主要完成 ${projectId}：${short}`
      : `今日主要处理 ${projectId}：${short}`;
    if (nextSteps.length > 0) {
      summary += "；已生成下一步建议";
    }
  }
  if (summary.length > 80) summary = `${summary.slice(0, 79)}…`;

  const projects = new Map<string, ProjectInsight>();
  for (const [projectId, bucket] of byProject) {
    const projectNextSteps: string[] = [];
    for (const test of input.tests) {
      if (test.status !== "failed") continue;
      if (projectBySession.get(test.sessionId) !== projectId) continue;
      projectNextSteps.push(`[高] 修复失败测试：${test.type}`);
    }
    for (const blocker of bucket.blockers) {
      projectNextSteps.push(`[高] 解除阻塞：${blocker}`);
    }
    for (const risk of bucket.risks) {
      projectNextSteps.push(`[中] 处理风险：${risk}`);
    }
    for (const optimization of bucket.optimizations) {
      projectNextSteps.push(`[中] 推进优化：${optimization}`);
    }
    projects.set(projectId, {
      tasks: [...bucket.tasks],
      completions: [...bucket.completions],
      problems: [...bucket.problems],
      optimizations: [...bucket.optimizations],
      risks: [...bucket.risks],
      blockers: [...bucket.blockers],
      nextSteps: projectNextSteps.slice(0, 5)
    });
  }

  return { summary, projects, nextSteps: nextSteps.length > 0 ? nextSteps : ["—（未检测到可执行建议）"] };
}