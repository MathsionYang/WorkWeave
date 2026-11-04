import assert from "node:assert/strict";
import test from "node:test";
import { adjudicateTestStatus, asProjectId, asSessionId, parseSubmissionFacts, parseTestResult } from "@workweave/core";

const sessionId = asSessionId("s1");
const projectId = asProjectId("project-a");

test("Jest 失败输出裁决为 failed 并保留失败原因", () => {
  const fact = parseTestResult({
    sessionId,
    projectId,
    command: "npx jest",
    output: "Tests: 1 failed, 3 passed\n  ● auth › rejects invalid token\n  AssertionError: expected 401",
    exitCode: 1
  });
  assert.equal(fact.status, "failed");
  assert.equal(fact.type, "jest");
  assert.ok(fact.failureReason?.includes("failed"));
});

test("截断输出不得判 passed", () => {
  const fact = parseTestResult({
    sessionId,
    projectId,
    command: "npx vitest run",
    output: "Tests: 3 passed",
    truncated: true
  });
  assert.equal(fact.status, "failed");
  assert.ok(fact.failureReason?.includes("truncated"));
});

test("pytest 全部通过裁决为 passed", () => {
  const fact = parseTestResult({
    sessionId,
    projectId,
    command: "pytest -q",
    output: "5 passed in 1.20s"
  });
  assert.equal(fact.status, "passed");
  assert.equal(fact.type, "pytest");
});

test("无测试命令时裁决为 not-run", () => {
  const fact = parseTestResult({
    sessionId,
    projectId,
    command: "echo hello",
    output: "hello"
  });
  assert.equal(fact.status, "not-run");
});

test("四态裁决优先级：失败 > 通过 > 阻塞 > 未执行", () => {
  assert.equal(adjudicateTestStatus({ failedEvidence: true, passedEvidence: true, blockedEvidence: true }), "failed");
  assert.equal(adjudicateTestStatus({ failedEvidence: false, passedEvidence: true, blockedEvidence: true }), "passed");
  assert.equal(adjudicateTestStatus({ failedEvidence: false, passedEvidence: false, blockedEvidence: true }), "blocked");
  assert.equal(adjudicateTestStatus({ failedEvidence: false, passedEvidence: false, blockedEvidence: false }), "not-run");
});

test("提交与回退事实按提交标识去重", () => {
  const output = "[main 1a2b3c4] fix login\n 1 file changed";
  const first = parseSubmissionFacts({ sessionId, command: "git commit -m fix", output });
  const second = parseSubmissionFacts({ sessionId, command: "git commit -m fix", output });
  assert.ok(first.some((fact) => fact.kind === "commit"));
  assert.ok(first.some((fact) => fact.kind === "file-change"));
  assert.equal(
    first.find((fact) => fact.kind === "commit")?.dedupKey,
    second.find((fact) => fact.kind === "commit")?.dedupKey
  );
});

test("回退事实可单独识别", () => {
  const facts = parseSubmissionFacts({
    sessionId,
    command: "git revert 1a2b3c4",
    output: "[main 5d6e7f8] Revert \"fix login\""
  });
  assert.ok(facts.some((fact) => fact.kind === "revert"));
});