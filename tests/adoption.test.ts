import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateAdoption,
  aggregateResearch,
  asInstant,
  asMessageId,
  asPlainDate,
  asSessionId,
  decideAdoption,
  detectResearchFindings,
  pairInteractions
} from "@workweave/core";
import type { MessageLike, SubmissionLike } from "@workweave/core";

const sessionId = asSessionId("s1");

function messages(): MessageLike[] {
  return [
    { messageId: asMessageId("u1"), role: "user", timestamp: asInstant("2026-11-04T08:00:00.000Z"), text: "修复登录 bug" },
    { messageId: asMessageId("a1"), role: "assistant", timestamp: asInstant("2026-11-04T08:01:00.000Z"), text: "已修复" },
    { messageId: asMessageId("u2"), role: "user", timestamp: asInstant("2026-11-04T08:02:00.000Z"), text: "谢谢，可以了" },
    { messageId: asMessageId("a2"), role: "assistant", timestamp: asInstant("2026-11-04T08:03:00.000Z"), text: "好的" },
    { messageId: asMessageId("u3"), role: "user", timestamp: asInstant("2026-11-04T08:04:00.000Z"), text: "再看下文档" },
    { messageId: asMessageId("a3"), role: "assistant", timestamp: asInstant("2026-11-04T08:05:00.000Z"), text: "已更新文档" }
  ];
}

test("用户提问到下一次提问之间的助手输出合并为一次交互", () => {
  const interactions = pairInteractions(sessionId, messages());
  assert.equal(interactions.length, 3);
  assert.deepEqual(interactions[0]?.answerMessageIds, [asMessageId("a1")]);
  assert.equal(interactions[0]?.followUpText, "谢谢，可以了");
  assert.equal(interactions[2]?.followUpText, undefined);
});

test("明确接受 + 窗口内提交判可确证采纳", () => {
  const interactions = pairInteractions(sessionId, messages());
  const submissions: SubmissionLike[] = [
    { dedupKey: "commit:abc", kind: "commit", timestamp: asInstant("2026-11-04T09:00:00.000Z") }
  ];
  const decision = decideAdoption(
    interactions[0]!,
    submissions,
    24 * 60 * 60 * 1000,
    Date.parse("2026-11-06T00:00:00.000Z")
  );
  assert.equal(decision.status, "confirmed-adopted");
  assert.deepEqual(decision.submissionKeys, ["commit:abc"]);
  assert.equal(decision.observationPending, false);
});

test("明确接受但无提交判推断采纳", () => {
  const interactions = pairInteractions(sessionId, messages());
  const decision = decideAdoption(
    interactions[0]!,
    [],
    24 * 60 * 60 * 1000,
    Date.parse("2026-11-06T00:00:00.000Z")
  );
  assert.equal(decision.status, "inferred-adopted");
  assert.equal(decision.reason.includes("without commit"), true);
});

test("明确否定判未采纳，无信号判无法判定", () => {
  const interactions = pairInteractions(sessionId, messages());
  const rejected = decideAdoption(
    { ...interactions[1]!, followUpText: "不对，重新做" },
    [],
    24 * 60 * 60 * 1000,
    Date.parse("2026-11-06T00:00:00.000Z")
  );
  const unknown = decideAdoption(
    interactions[2]!,
    [],
    24 * 60 * 60 * 1000,
    Date.parse("2026-11-06T00:00:00.000Z")
  );
  assert.equal(rejected.status, "not-adopted");
  assert.equal(unknown.status, "undeterminable");
});

test("观察窗口未结束时标待观察且不计入采纳度分母", () => {
  const interactions = pairInteractions(sessionId, messages());
  const pending = decideAdoption(
    interactions[0]!,
    [],
    24 * 60 * 60 * 1000,
    Date.parse("2026-11-04T12:00:00.000Z")
  );
  const stats = aggregateAdoption([pending], []);
  assert.equal(pending.observationPending, true);
  assert.equal(stats.denominator, 0);
  assert.equal(stats.rate, null);
});

test("采纳度同时给出分子分母与无法判定率", () => {
  const decisions = [
    { interactionId: "i1", status: "confirmed-adopted" as const, observationPending: false, submissionKeys: ["commit:1"], reworkCount: 0, reason: "" },
    { interactionId: "i2", status: "inferred-adopted" as const, observationPending: false, submissionKeys: [], reworkCount: 0, reason: "" },
    { interactionId: "i3", status: "not-adopted" as const, observationPending: false, submissionKeys: [], reworkCount: 1, reason: "" },
    { interactionId: "i4", status: "undeterminable" as const, observationPending: false, submissionKeys: [], reworkCount: 0, reason: "" }
  ];
  const stats = aggregateAdoption(decisions, []);
  assert.equal(stats.numerator, 2);
  assert.equal(stats.denominator, 3);
  assert.equal(stats.rate, 2 / 3);
  assert.equal(stats.undeterminableRate, 0.25);
});

test("调研识别与主题聚合保留结论状态与跨日标记", () => {
  const first = detectResearchFindings({
    sessionId: "s1",
    title: "调研方案对比",
    day: asPlainDate("2026-11-04"),
    messages: [{ text: "调研 A 与 B 的差异，结论是采用 A" }]
  });
  const second = detectResearchFindings({
    sessionId: "s2",
    title: "调研方案对比",
    day: asPlainDate("2026-11-05"),
    messages: [{ text: "继续验证 A 的可行性" }]
  });
  const aggregated = aggregateResearch([...first, ...second]);
  assert.equal(first[0]?.conclusion, "concluded");
  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0]?.crossDay, true);
  assert.equal(aggregated[0]?.evidence.length, 2);
});