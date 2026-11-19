import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  aggregateAdoption,
  asConfidence,
  asInstant,
  asMessageId,
  asPlainDate,
  asProjectId,
  asSessionId,
  buildFactReport,
  deriveProjectName,
  detectResearchFindings,
  isNoiseText,
  renderHtml,
  renderMarkdown
} from "@workweave/core";
import type { ClassifiedSession, Message, ParsedSession, TestFact } from "@workweave/core";

const day = asPlainDate("2026-11-04");
const sessionId = asSessionId("demo-1");

function message(role: Message["role"], text: string, index: number): Message {
  return {
    messageId: asMessageId(`m-${index}`),
    sessionId,
    sourceTool: "codex",
    role,
    timestamp: asInstant(`2026-11-04T08:0${index}:00.000Z`),
    text
  };
}

const session: ParsedSession = {
  sessionId,
  sourceTool: "codex",
  startedAt: asInstant("2026-11-04T08:00:00.000Z"),
  workDir: "/work/demo-app",
  messages: [
    message("system", "<environment_context><current_date>2026-11-04</current_date></environment_context>", 0),
    message("user", "请修复登录超时并补充测试", 1),
    message("assistant", "已修复登录超时；根因是 token 过期；测试 3 passed", 2),
    message("assistant", "TODO：补充回归用例，避免同类问题再次出现", 3)
  ],
  unknownTypeCount: 0,
  gaps: [],
  sourceFile: "/fixtures/demo-1.jsonl"
};

const classification: ClassifiedSession = {
  sessionId,
  projectId: "demo-app",
  category: "debugging",
  secondaryCategories: [],
  basis: "structured-feature",
  confidence: asConfidence(0.9),
  locked: false,
  pending: false,
  reasons: []
};

const failedTest: TestFact = {
  sessionId,
  projectId: asProjectId("demo-app"),
  type: "jest",
  command: "npm test",
  status: "failed",
  failureReason: "auth.spec.ts:42 expected 401",
  evidenceIds: ["test:demo-1:npm test"]
};

test("项目名优先 package.json，并清理副本后缀", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ww-name-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo-app" }), "utf8");
  const nested = join(dir, "src", "feature");
  await mkdir(nested, { recursive: true });
  assert.equal(deriveProjectName(nested).name, "demo-app");

  const copyDir = await mkdtemp(join(tmpdir(), "ww-copy-"));
  const copyProject = join(copyDir, "real-app - 副本");
  await mkdir(copyProject, { recursive: true });
  assert.equal(deriveProjectName(copyProject).name, "real-app");

  const unreadable = join(copyDir, "SATMCP", "SATBin64");
  await mkdir(unreadable, { recursive: true });
  assert.equal(deriveProjectName(unreadable).name, "SATMCP");
});

test("系统提示与环境上下文被识别为噪声，不进入调研", () => {
  assert.equal(isNoiseText("<environment_context><filesystem>...</filesystem>"), true);
  assert.equal(isNoiseText("You are Codex, an agent based on GPT-6"), true);
  assert.equal(isNoiseText("请实现登录超时修复"), false);

  const noiseOnly = detectResearchFindings({
    sessionId: "s1",
    day,
    messages: [{ text: "<environment_context>workspace_roots</environment_context>" }]
  });
  assert.equal(noiseOnly.length, 0);

  const research = detectResearchFindings({
    sessionId: "s2",
    day,
    messages: [
      { text: "<environment_context>noise</environment_context>" },
      { text: "调研 SQLite 多帧解压方案，结论是采用逐帧解压" }
    ]
  });
  assert.equal(research.length, 1);
  assert.equal(research[0]?.conclusion, "concluded");
  assert.equal(research[0]?.topic.includes("environment_context"), false);
});

test("报告能产出可读的任务、完成事项、问题与下一步", () => {
  const report = buildFactReport({
    day,
    dataVersion: "v-insight",
    sessions: [session],
    classifications: [classification],
    tests: [failedTest],
    submissions: [],
    adoption: aggregateAdoption([], []),
    research: []
  });

  const project = report.projects.find((item) => item.projectId === "demo-app");
  assert.ok(project !== undefined);
  assert.ok((project?.tasks ?? []).some((item) => item.includes("登录超时")));
  assert.ok(project?.completions.some((item) => item.includes("已修复")));
  assert.ok(project?.problems.some((item) => item.includes("根因")));
  assert.ok(project?.optimizations.some((item) => item.includes("回归用例")));
  assert.ok(report.summary?.includes("demo-app"));
  assert.ok(report.nextSteps?.some((step) => step.includes("修复失败测试")));

  const markdown = renderMarkdown(report);
  assert.ok(markdown.includes("## 本期结论"));
  assert.ok(markdown.includes("- 任务："));
  assert.ok(markdown.includes("待优化项"));
  assert.equal(markdown.includes("未提供"), false);
  assert.equal(markdown.includes("environment_context"), false);
  assert.equal(markdown.includes("无法判定率 100.0%"), false);
});

test("报告先给结论，再按工作进展、质量、行动三类递进组织", () => {
  const report = buildFactReport({
    day,
    dataVersion: "v-structured-summary",
    sessions: [session],
    classifications: [classification],
    tests: [failedTest],
    submissions: [],
    adoption: aggregateAdoption([], []),
    research: []
  });

  const markdown = renderMarkdown(report);
  const conclusion = markdown.indexOf("## 本期结论");
  const outcomes = markdown.indexOf("## 1. 工作进展");
  const issues = markdown.indexOf("## 2. 问题与质量");
  const decisions = markdown.indexOf("## 3. 调研与行动");

  assert.ok(conclusion >= 0, "starts with a clear conclusion section");
  assert.ok(outcomes > conclusion, "outcomes support the conclusion");
  assert.ok(issues > outcomes, "issues follow the achieved outcomes");
  assert.ok(decisions > issues, "actions follow from the issues");
  assert.equal((markdown.match(/^## (1\. 工作进展|2\. 问题与质量|3\. 调研与行动)$/gm) ?? []).length, 3);
  assert.match(markdown, /修复登录超时/);
  assert.match(markdown, /auth\.spec\.ts:42/);

  const html = renderHtml(report);
  assert.ok(html.indexOf("本期结论") < html.indexOf("1. 工作进展"));
  assert.ok(html.indexOf("1. 工作进展") < html.indexOf("2. 问题与质量"));
  assert.ok(html.indexOf("2. 问题与质量") < html.indexOf("3. 调研与行动"));
});

test("从项目详情提取明确待办并单独成节，排除完成项和纯风险建议", () => {
  const detailedSession: ParsedSession = {
    ...session,
    messages: [
      ...session.messages,
      message("assistant", "建议优化报告加载性能；风险是旧配置不兼容", 4),
      message("assistant", "后续需要补充 WorkBuddy 区间采集回归测试", 5)
    ]
  };
  const report = buildFactReport({
    day,
    dataVersion: "v-todos",
    sessions: [detailedSession],
    classifications: [classification],
    tests: [failedTest],
    submissions: [],
    adoption: aggregateAdoption([], []),
    research: []
  });

  const markdown = renderMarkdown(report);
  const html = renderHtml(report);
  const todoSection = markdown.split("## 4. 待办事项")[1] ?? "";
  assert.ok(todoSection.includes("补充回归用例"));
  assert.ok(todoSection.includes("补充 WorkBuddy 区间采集回归测试"));
  assert.ok(todoSection.includes("修复失败测试"));
  assert.equal(todoSection.includes("已修复登录超时"), false);
  assert.equal(todoSection.includes("优化报告加载性能"), false);
  assert.equal(todoSection.includes("旧配置不兼容"), false);
  assert.ok(html.includes("4. 待办事项"));
  assert.ok(html.includes("补充 WorkBuddy 区间采集回归测试"));
});
