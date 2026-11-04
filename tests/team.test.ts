import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthzService,
  aggregateTeamView,
  asPlainDate,
  WorkWeaveError
} from "@workweave/core";
import type { Principal, TeamSessionSignal } from "@workweave/core";

const authz = new AuthzService();
const day = asPlainDate("2026-11-04");
const range = { from: day, to: day };

function expectDenied(fn: () => void): void {
  assert.throws(fn, (error: unknown) => error instanceof WorkWeaveError && error.code === "E-AUTH-002");
}

test("成员只能查看本人内容，负责人可查看团队", () => {
  const member: Principal = { memberId: "m1", tenantId: "t1", roles: ["member"] };
  const lead: Principal = { memberId: "l1", tenantId: "t1", roles: ["lead"] };

  authz.authorize(member, "view-own", { tenantId: "t1", memberId: "m1" });
  expectDenied(() => authz.authorize(member, "view-own", { tenantId: "t1", memberId: "m2" }));
  expectDenied(() => authz.authorize(member, "view-team", { tenantId: "t1" }));
  authz.authorize(lead, "view-team", { tenantId: "t1" });
});

test("查看他人原始对话需审计员或管理员，租户不匹配拒绝", () => {
  const member: Principal = { memberId: "m1", tenantId: "t1", roles: ["member"] };
  const auditor: Principal = { memberId: "a1", tenantId: "t1", roles: ["auditor"] };
  const admin: Principal = { memberId: "ad1", tenantId: "t1", roles: ["admin"] };

  expectDenied(() => authz.authorize(member, "view-raw", { tenantId: "t1", memberId: "m2" }));
  authz.authorize(auditor, "view-raw", { tenantId: "t1", memberId: "m2" });
  authz.authorize(admin, "manage", { tenantId: "t1" });
  expectDenied(() => authz.authorize(admin, "manage", { tenantId: "t2" }));
});

test("项目可见范围之外的请求被拒绝", () => {
  const principal: Principal = {
    memberId: "l1",
    tenantId: "t1",
    roles: ["lead"],
    visibleProjectIds: ["project-a"]
  };
  authz.authorize(principal, "view-team", { tenantId: "t1", projectId: "project-a" });
  expectDenied(() => authz.authorize(principal, "view-team", { tenantId: "t1", projectId: "project-b" }));
});

const sessions: readonly TeamSessionSignal[] = [
  { sessionId: "s1", sourceTool: "codex", memberId: "m1", projectId: "project-a", category: "coding", messages: 30 },
  { sessionId: "s2", sourceTool: "dsh", memberId: "m2", projectId: "project-a", category: "debugging", messages: 10 },
  { sessionId: "s3", sourceTool: "workbuddy", memberId: "m1", projectId: "cross-project", category: "coding", messages: 5 },
  { sessionId: "s4", sourceTool: "claude", memberId: "m2", projectId: "unassigned", category: "pure-conversation", messages: 2 }
];

test("团队视图按项目唯一聚合并给出来源分布", () => {
  const aggregate = aggregateTeamView({ range, sessions });
  assert.equal(aggregate.projects.length, 1);
  assert.equal(aggregate.projects[0]?.projectId, "project-a");
  assert.equal(aggregate.projects[0]?.sessions, 2);
  assert.equal(aggregate.projects[0]?.messages, 40);
  assert.equal(aggregate.projects[0]?.shares.find((share) => share.source === "codex")?.share, 0.75);
  assert.equal(aggregate.projects[0]?.shares.find((share) => share.source === "dsh")?.share, 0.25);
});

test("三类分组互斥且会话与消息对账差异为 0", () => {
  const aggregate = aggregateTeamView({ range, sessions });
  const totalSessions = aggregate.totalSessions;
  const totalMessages = aggregate.totalMessages;
  assert.equal(totalSessions, 4);
  assert.equal(totalMessages, 47);
  assert.equal(aggregate.groups.reduce((sum, group) => sum + group.sessions, 0), totalSessions);
  assert.equal(aggregate.groups.reduce((sum, group) => sum + group.messages, 0), totalMessages);
  assert.equal(aggregate.consistent, true);
});

test("停用来源不参与分布并触发可能不完整", () => {
  const aggregate = aggregateTeamView({
    range,
    sessions,
    disabledSources: ["claude"],
    completenessBySource: {
      dsh: { status: "possibly-incomplete", gaps: ["record-integrity:session-missing"] }
    }
  });

  assert.equal(aggregate.totalSessions, 3);
  assert.equal(aggregate.teamShares.some((share) => share.source === "claude"), false);
  assert.equal(aggregate.completeness.status, "possibly-incomplete");
  assert.ok(aggregate.completeness.gaps.includes("dsh:record-integrity:session-missing"));
});