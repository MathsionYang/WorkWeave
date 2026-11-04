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
  renderHtml
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
  assert.ok(html.includes("<h2>1. 今日概览</h2>"));
  assert.ok(html.includes("<h2>8. 证据索引</h2>"));
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
  assert.equal(weekly.completeness.status, "complete");
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