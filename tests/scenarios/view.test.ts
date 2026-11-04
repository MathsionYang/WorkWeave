import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthzService,
  WorkWeaveError,
  aggregateTeamView,
  asConfidence,
  asInstant,
  asMessageId,
  asPlainDate,
  asSessionId,
  classifySession,
  computeProjectDistribution
} from "@workweave/core";
import type { ClassifiedSession, ParsedSession, Principal, TeamSessionSignal } from "@workweave/core";

const range = { from: asPlainDate("2026-11-04"), to: asPlainDate("2026-11-04") };

function messages(sessionId: string, count: number, sourceTool: ParsedSession["sourceTool"]) {
  const id = asSessionId(sessionId);
  return Array.from({ length: count }, (_, index) => ({
    messageId: asMessageId(`${sessionId}-m${index}`),
    sessionId: id,
    sourceTool,
    role: "user" as const,
    timestamp: asInstant(new Date(Date.parse("2026-11-04T08:00:00.000Z") + index * 60000).toISOString()),
    text: `消息 ${index}`
  }));
}

function session(sessionId: string, sourceTool: ParsedSession["sourceTool"], count: number): ParsedSession {
  const id = asSessionId(sessionId);
  return {
    sessionId: id,
    sourceTool,
    startedAt: asInstant("2026-11-04T08:00:00.000Z"),
    workDir: "/work/project-a",
    messages: messages(sessionId, count, sourceTool),
    unknownTypeCount: 0,
    gaps: [],
    sourceFile: `/fixtures/${sessionId}.jsonl`
  };
}

function classification(sessionId: string, overrides: Partial<ClassifiedSession> = {}): ClassifiedSession {
  return {
    sessionId: asSessionId(sessionId),
    projectId: "project-a",
    category: "coding",
    secondaryCategories: [],
    basis: "configured-rule",
    confidence: asConfidence(0.9),
    locked: false,
    pending: false,
    reasons: [],
    ...overrides
  };
}

const sessions = [session("s1", "codex", 30), session("s2", "dsh", 10), session("s3", "codex", 2)];
const classifications = [
  classification("s1"),
  classification("s2"),
  classification("s3", { projectId: "unassigned", category: "pure-conversation", pureConversationKind: "knowledge-qa" })
];

test("V-09 同一项目多来源合并且来源分布正确", () => {
  const distribution = computeProjectDistribution({
    projectId: "project-a",
    range,
    sessions,
    classifications
  });
  assert.equal(distribution.totalSessions, 2);
  assert.equal(distribution.totalMessages, 40);
  assert.equal(distribution.shares.find((share) => share.source === "codex")?.share, 0.75);
  assert.equal(distribution.shares.find((share) => share.source === "dsh")?.share, 0.25);
});

test("V-10 停用来源不参与项目来源分布", () => {
  const distribution = computeProjectDistribution({
    projectId: "project-a",
    range,
    sessions,
    classifications,
    disabledSources: ["dsh"]
  });
  assert.equal(distribution.totalSessions, 1);
  assert.equal(distribution.totalMessages, 30);
  assert.equal(distribution.shares.some((share) => share.source === "dsh"), false);
});

test("V-11 双仓库文件路径判跨项目", () => {
  const result = classifySession({
    sessionId: asSessionId("s4"),
    sourceTool: "codex",
    filePaths: ["/repo-a/src/a.ts", "/repo-b/src/b.ts"],
    messages: [{ role: "user", text: "同时修改两个仓库" }]
  });
  assert.equal(result.projectId, "cross-project");
});

test("V-12 无线索时保留未归属，不强行分配", () => {
  const result = classifySession({
    sessionId: asSessionId("s5"),
    sourceTool: "codex",
    messages: [{ role: "user", text: "你好" }]
  });
  assert.equal(result.projectId, "unassigned");
});

test("V-13 纯对话单独归类并保留子类别", () => {
  const result = classifySession({
    sessionId: asSessionId("s6"),
    sourceTool: "workbuddy",
    messages: [{ role: "user", text: "什么是事件循环" }]
  });
  assert.equal(result.category, "pure-conversation");
  assert.equal(result.pureConversationKind, "knowledge-qa");
});

const teamSessions: readonly TeamSessionSignal[] = [
  { sessionId: "s1", sourceTool: "codex", memberId: "m1", projectId: "project-a", category: "coding", messages: 30 },
  { sessionId: "s2", sourceTool: "dsh", memberId: "m2", projectId: "project-a", category: "debugging", messages: 10 },
  { sessionId: "s3", sourceTool: "codex", memberId: "m1", projectId: "cross-project", category: "coding", messages: 5 },
  { sessionId: "s4", sourceTool: "workbuddy", memberId: "m2", projectId: "unassigned", category: "pure-conversation", messages: 2 }
];

test("V-14 团队视图项目唯一聚合且三类分组对账为 0", () => {
  const aggregate = aggregateTeamView({ range, sessions: teamSessions });
  assert.equal(aggregate.projects.length, 1);
  assert.equal(aggregate.projects[0]?.projectId, "project-a");
  assert.equal(aggregate.projects[0]?.sessions, 2);
  assert.equal(aggregate.projects[0]?.messages, 40);
  assert.equal(aggregate.groups.reduce((sum, group) => sum + group.sessions, 0), aggregate.totalSessions);
  assert.equal(aggregate.groups.reduce((sum, group) => sum + group.messages, 0), aggregate.totalMessages);
  assert.equal(aggregate.consistent, true);
});

test("V-15 权限过滤后重算，不展示不可见项目", () => {
  const lead: Principal = {
    memberId: "l1",
    tenantId: "t1",
    roles: ["lead"],
    visibleProjectIds: ["project-a"]
  };
  const authz = new AuthzService();
  authz.authorize(lead, "view-team", { tenantId: "t1", projectId: "project-a" });
  assert.throws(
    () => authz.authorize(lead, "view-team", { tenantId: "t1", projectId: "project-b" }),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-AUTH-002"
  );

  const visible = teamSessions.filter(
    (item) => item.projectId === "project-a" || item.projectId === "cross-project" || item.projectId === "unassigned"
  );
  const aggregate = aggregateTeamView({ range, sessions: visible });
  assert.equal(aggregate.projects.some((project) => project.projectId === "project-b"), false);
});