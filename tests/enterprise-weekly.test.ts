import assert from "node:assert/strict";
import test from "node:test";
import {
  EnterprisePolicy,
  WorkWeaveError,
  aggregateAdoption,
  asConfidence,
  asInstant,
  asMessageId,
  asPlainDate,
  asProjectId,
  asSessionId,
  buildFactReport,
  buildWeeklyReport,
  escapeHtml,
  renderHtml,
  renderMarkdown
} from "@workweave/core";
import type { ClassifiedSession, ParsedSession, TestFact } from "@workweave/core";

function makeSession(day: string, sessionId: string): ParsedSession {
  const id = asSessionId(sessionId);
  return {
    sessionId: id,
    sourceTool: "codex",
    startedAt: asInstant(`${day}T08:00:00.000Z`),
    workDir: "/work/project-a",
    messages: [
      {
        messageId: asMessageId(`${sessionId}-m1`),
        sessionId: id,
        sourceTool: "codex",
        role: "user",
        timestamp: asInstant(`${day}T08:01:00.000Z`),
        text: "修复登录 bug"
      }
    ],
    unknownTypeCount: 0,
    gaps: [],
    sourceFile: `/fixtures/${sessionId}.jsonl`
  };
}

function makeClassification(sessionId: string): ClassifiedSession {
  return {
    sessionId: asSessionId(sessionId),
    projectId: "project-a",
    category: "debugging",
    secondaryCategories: [],
    basis: "structured-feature",
    confidence: asConfidence(0.8),
    locked: false,
    pending: false,
    reasons: []
  };
}

function makeReport(day: string, sessionId: string) {
  const testFact: TestFact = {
    sessionId: asSessionId(sessionId),
    projectId: asProjectId("project-a"),
    type: "jest",
    command: "npx jest",
    status: "failed",
    failureReason: "1 failed",
    evidenceIds: []
  };
  return buildFactReport({
    day: asPlainDate(day),
    dataVersion: `v-${day}`,
    sessions: [makeSession(day, sessionId)],
    classifications: [makeClassification(sessionId)],
    tests: [testFact],
    submissions: [],
    adoption: aggregateAdoption([], []),
    research: []
  });
}

test("HTML 由同一报告 IR 渲染并转义危险字符", () => {
  const report = makeReport("2026-11-04", "s1");
  const html = renderHtml(report);
  assert.ok(html.includes("<h2>本期结论</h2>"));
  assert.ok(html.includes("<h2>1. 工作进展</h2>"));
  assert.ok(html.includes("<h2>2. 问题与质量</h2>"));
  assert.ok(html.includes("<h2>3. 调研与行动</h2>"));
  for (const removed of ["AI 协作与采纳", "数据覆盖边界", "证据索引"]) {
    assert.equal(html.includes(removed), false, `unexpected section: ${removed}`);
  }
  assert.equal(escapeHtml("<script>alert('x')</script>"), "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
});

test("周报聚合跨日项目与来源分布并标注缺失日期", () => {
  const first = makeReport("2026-11-04", "s1");
  const second = makeReport("2026-11-05", "s2");
  const weekly = buildWeeklyReport([first, second], ["2026-11-04", "2026-11-05", "2026-11-06"]);

  assert.equal(weekly.days.length, 2);
  assert.deepEqual(weekly.missingDays, ["2026-11-06"]);
  assert.equal(weekly.overview.sessions, 2);
  assert.equal(weekly.overview.projects, 1);
  assert.equal(weekly.projects.length, 1);
  assert.equal(weekly.projects[0]?.projectId, "project-a");
  assert.equal(weekly.projects[0]?.distribution.totalSessions, 2);
  assert.ok(weekly.projects[0]?.todos?.some((item) => item.includes("修复失败测试")));
  assert.equal(weekly.completeness.status, "complete");

  const html = renderHtml(weekly);
  const markdown = renderMarkdown(weekly);
  for (const heading of ["本期结论", "1. 工作进展", "2. 问题与质量", "3. 调研与行动", "4. 待办事项"]) {
    assert.ok(html.includes(heading), `weekly HTML missing ${heading}`);
    assert.ok(markdown.includes(heading), `weekly Markdown missing ${heading}`);
  }
  for (const removed of ["AI 协作与采纳", "数据覆盖边界", "证据索引"]) {
    assert.equal(html.includes(removed), false, `unexpected weekly HTML section: ${removed}`);
    assert.equal(markdown.includes(removed), false, `unexpected weekly Markdown section: ${removed}`);
  }
});

test("无数据时日报与周报仍保留相同固定章节", () => {
  const empty = buildFactReport({
    day: asPlainDate("2026-11-06"),
    dataVersion: "empty",
    sessions: [],
    classifications: [],
    tests: [],
    submissions: [],
    adoption: aggregateAdoption([], []),
    research: []
  });
  const weekly = buildWeeklyReport([empty], ["2026-11-06"]);
  const dailyHtml = renderHtml(empty);
  const weeklyHtml = renderHtml(weekly);
  const dailyMarkdown = renderMarkdown(empty);
  const weeklyMarkdown = renderMarkdown(weekly);

  for (const heading of ["本期结论", "1. 工作进展", "1.1 日度分布", "1.2 按项目归集", "2. 问题与质量", "2.1 解决的问题", "2.2 测试结果", "3. 调研与行动", "3.1 本期调研", "3.2 待优化项", "4. 待办事项"]) {
    assert.ok(dailyHtml.includes(heading), `daily HTML missing ${heading}`);
    assert.ok(weeklyHtml.includes(heading), `weekly HTML missing ${heading}`);
    assert.ok(dailyMarkdown.includes(heading), `daily Markdown missing ${heading}`);
    assert.ok(weeklyMarkdown.includes(heading), `weekly Markdown missing ${heading}`);
  }
});

test("企业策略要求登录并拒绝未授权出口", () => {
  const localPolicy = new EnterprisePolicy({
    requireLogin: true,
    allowedPurposes: ["report-delivery"],
    localOnly: true
  });

  assert.throws(
    () => localPolicy.assertAuthenticated(undefined),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-AUTH-001"
  );
  localPolicy.assertAuthenticated({ memberId: "m1", tenantId: "t1" });

  assert.throws(
    () => localPolicy.assertEgress("notification", "https://internal.example"),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-SEC-002"
  );
  localPolicy.assertEgress("report-delivery", "C:\\out\\report.md");

  const hostPolicy = new EnterprisePolicy({
    requireLogin: false,
    allowedPurposes: ["report-delivery"],
    allowedHosts: ["internal.example"]
  });
  assert.throws(
    () => hostPolicy.assertEgress("report-delivery", "https://evil.example/report"),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-SEC-002"
  );
  hostPolicy.assertEgress("report-delivery", "https://internal.example/report");
});
