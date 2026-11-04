import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
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
  computeProjectDistribution,
  exportReportAtomic,
  renderMarkdown
} from "@workweave/core";
import type { ClassifiedSession, Message, ParsedSession, TestFact } from "@workweave/core";

function makeMessages(sessionId: string, count: number): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    messageId: asMessageId(`${sessionId}-m${index}`),
    sessionId: asSessionId(sessionId),
    sourceTool: "codex",
    role: index % 2 === 0 ? "user" : "assistant",
    timestamp: asInstant(new Date(Date.parse("2026-11-04T08:00:00.000Z") + index * 60000).toISOString()),
    text: `消息 ${index}`
  }));
}

function makeSession(sessionId: string, sourceTool: ParsedSession["sourceTool"], count: number): ParsedSession {
  return {
    sessionId: asSessionId(sessionId),
    sourceTool,
    startedAt: asInstant("2026-11-04T08:00:00.000Z"),
    messages: makeMessages(sessionId, count).map((message) => ({ ...message, sourceTool })),
    unknownTypeCount: 0,
    gaps: [],
    sourceFile: `/fixtures/${sessionId}.jsonl`
  };
}

function classification(
  overrides: Omit<Partial<ClassifiedSession>, "sessionId"> & { readonly sessionId: string }
): ClassifiedSession {
  return {
    projectId: "project-a",
    category: "coding",
    secondaryCategories: [],
    basis: "configured-rule",
    confidence: asConfidence(0.9),
    locked: false,
    pending: false,
    reasons: [],
    ...overrides,
    sessionId: asSessionId(overrides.sessionId)
  };
}

const sessions = [
  makeSession("s1", "codex", 30),
  makeSession("s2", "dsh", 10),
  makeSession("s3", "workbuddy", 2)
];
const classifications = [
  classification({ sessionId: "s1" }),
  classification({ sessionId: "s2" }),
  classification({ sessionId: "s3", projectId: "unassigned", category: "pure-conversation", pureConversationKind: "knowledge-qa" })
];
const failedTest: TestFact = {
  sessionId: asSessionId("s1"),
  projectId: asProjectId("project-a"),
  type: "jest",
  command: "npx jest",
  status: "failed",
  failureReason: "1 failed",
  evidenceIds: ["e1"]
};
const adoption = aggregateAdoption([], []);

test("同一项目多来源会话合并计算来源分布", () => {
  const distribution = computeProjectDistribution({
    projectId: "project-a",
    range: { from: asPlainDate("2026-11-04"), to: asPlainDate("2026-11-04") },
    sessions,
    classifications
  });
  assert.equal(distribution.totalSessions, 2);
  assert.equal(distribution.totalMessages, 40);
  assert.equal(distribution.shares.find((share) => share.source === "codex")?.share, 0.75);
  assert.equal(distribution.shares.find((share) => share.source === "dsh")?.share, 0.25);
});

test("日报八部分结构且项目只出现一次", () => {
  const report = buildFactReport({
    day: asPlainDate("2026-11-04"),
    dataVersion: "abc123",
    sessions,
    classifications,
    tests: [failedTest],
    submissions: [],
    adoption,
    research: [],
    now: new Date("2026-11-04T20:00:00.000Z")
  });

  assert.equal(report.projects.length, 1);
  assert.equal(report.projects[0]?.projectId, "project-a");
  assert.equal(report.crossProject.length, 1);
  assert.equal(report.pureConversation.length, 1);
  assert.equal(report.overview.failures, 1);

  const markdown = renderMarkdown(report);
  for (const heading of [
    "## 1. 今日概览",
    "## 2. AI 协作与采纳",
    "## 3. 今日调研",
    "## 4. 按项目总结",
    "## 5. 跨项目与未归属事项",
    "## 6. 纯对话归类摘要",
    "## 7. 待确认项",
    "## 8. 证据索引"
  ]) {
    assert.ok(markdown.includes(heading), `missing ${heading}`);
  }
  assert.equal(markdown.split("### project-a").length - 1, 1);
  assert.equal(markdown.includes("（Codex）"), false);
});

test("部分可用来源使报告标注可能不完整", () => {
  const report = buildFactReport({
    day: asPlainDate("2026-11-04"),
    dataVersion: "abc123",
    sessions,
    classifications,
    tests: [],
    submissions: [],
    adoption,
    research: [],
    completenessBySource: {
      claude: {
        status: "possibly-incomplete",
        gaps: [{ type: "source-type-missing", source: "claude", scope: "claude-desktop", basis: "missing desktop chat" }],
        undetermined: false
      }
    }
  });

  assert.equal(report.completeness.status, "possibly-incomplete");
  assert.ok(renderMarkdown(report).includes("可能不完整"));
});

test("原子导出写入目标且不留下临时文件", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ww-export-"));
  const target = join(dir, "daily.md");
  await exportReportAtomic(target, "# 日报\n");

  assert.equal(await readFile(target, "utf8"), "# 日报\n");
  const files = await readdir(dir);
  assert.equal(files.some((file) => file.endsWith(".tmp")), false);
});