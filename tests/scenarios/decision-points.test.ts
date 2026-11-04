import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_SCHEDULE_MODE,
  ProbeService,
  aggregateTeamView,
  analyzeIntegrity,
  asConfidence,
  asInstant,
  asMessageId,
  asPlainDate,
  asSessionId,
  computeProjectDistribution
} from "@workweave/core";
import type { ClassifiedSession, ParsedSession } from "@workweave/core";

const day = asPlainDate("2026-11-04");
const range = { from: day, to: day };

function session(sessionId: string, sourceTool: ParsedSession["sourceTool"], messageCount: number): ParsedSession {
  const id = asSessionId(sessionId);
  return {
    sessionId: id,
    sourceTool,
    startedAt: asInstant("2026-11-04T08:00:00.000Z"),
    workDir: "/work/project-a",
    messages: Array.from({ length: messageCount }, (_, index) => ({
      messageId: asMessageId(`${sessionId}-m${index}`),
      sessionId: id,
      sourceTool,
      role: "user" as const,
      timestamp: asInstant(new Date(Date.parse("2026-11-04T08:00:00.000Z") + index * 60000).toISOString()),
      text: `消息 ${index}`
    })),
    unknownTypeCount: 0,
    gaps: [],
    sourceFile: `/fixtures/${sessionId}.jsonl`
  };
}

function classification(sessionId: string): ClassifiedSession {
  return {
    sessionId: asSessionId(sessionId),
    projectId: "project-a",
    category: "coding",
    secondaryCategories: [],
    basis: "configured-rule",
    confidence: asConfidence(0.9),
    locked: false,
    pending: false,
    reasons: []
  };
}

test("D1 默认定时模式为 fact-auto", () => {
  assert.equal(DEFAULT_SCHEDULE_MODE, "fact-auto");
});

test("D5/D6 来源分布只列有会话来源，并标注四舍五入差异", () => {
  const sessions = [
    session("s1", "codex", 1),
    session("s2", "dsh", 1),
    session("s3", "workbuddy", 1)
  ];
  const classifications = [
    classification("s1"),
    classification("s2"),
    classification("s3")
  ];
  const distribution = computeProjectDistribution({
    projectId: "project-a",
    range,
    sessions,
    classifications
  });

  assert.equal(distribution.shares.length, 3);
  assert.equal(distribution.shares.every((share) => share.sessions > 0), true);
  assert.equal(distribution.roundingDifference, true);
});

test("D7 三类分组互斥且跨项目/未归属不进入项目分布", () => {
  const aggregate = aggregateTeamView({
    range,
    sessions: [
      { sessionId: "s1", sourceTool: "codex", memberId: "m1", projectId: "project-a", category: "coding", messages: 3 },
      { sessionId: "s2", sourceTool: "dsh", memberId: "m1", projectId: "cross-project", category: "coding", messages: 2 },
      { sessionId: "s3", sourceTool: "workbuddy", memberId: "m2", projectId: "unassigned", category: "pure-conversation", messages: 1 }
    ]
  });
  assert.equal(aggregate.projects.length, 1);
  assert.equal(aggregate.groups.reduce((sum, group) => sum + group.sessions, 0), 3);
  assert.equal(aggregate.consistent, true);
});

test("D8 人工/配置规则优先于环境变量", async () => {
  const home = await mkdtemp(join(tmpdir(), "ww-d8-"));
  await mkdir(join(home, "manual", "sessions"), { recursive: true });
  await mkdir(join(home, "configured", "sessions"), { recursive: true });
  await mkdir(join(home, "env", "sessions"), { recursive: true });

  const service = new ProbeService();
  const manual = await service.probe({
    source: "codex",
    platform: "linux",
    homeDir: home,
    env: { CODEX_HOME: join(home, "env") },
    manualPath: join(home, "manual"),
    configuredRulePath: join(home, "configured")
  });
  assert.ok(manual.adoptedPath?.endsWith("manual"));

  service.invalidate();
  const configured = await service.probe({
    source: "codex",
    platform: "linux",
    homeDir: home,
    env: { CODEX_HOME: join(home, "env") },
    configuredRulePath: join(home, "configured")
  });
  assert.ok(configured.adoptedPath?.endsWith("configured"));
});

test("D9 完整性阈值可配置且只影响判定器", () => {
  const base = {
    source: "codex" as const,
    rootExists: true,
    rootReadable: true,
    messageTimestamps: ["2026-11-04T08:00:00.000Z", "2026-11-04T08:00:02.000Z"],
    hasAnyReadableRecord: true
  };
  assert.equal(analyzeIntegrity(base).gaps.some((gap) => gap.type === "time-gap"), false);
  assert.equal(
    analyzeIntegrity({ ...base, thresholds: { timeGapMs: 1000, discontinuityMs: 60000 } }).gaps.some(
      (gap) => gap.type === "time-gap"
    ),
    true
  );
});