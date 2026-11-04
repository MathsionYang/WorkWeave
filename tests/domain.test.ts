import assert from "node:assert/strict";
import test from "node:test";
import {
  ERROR_META,
  asConfidence,
  asPlainDate,
  asSessionId,
  isSourceTool
} from "@workweave/core";

test("品牌类型拒绝空值与非法置信度", () => {
  assert.equal(asSessionId("s1"), "s1");
  assert.throws(() => asSessionId("  "), TypeError);
  assert.equal(asConfidence(0.5), 0.5);
  assert.throws(() => asConfidence(1.1), RangeError);
  assert.equal(asPlainDate("2026-11-04"), "2026-11-04");
  assert.throws(() => asPlainDate("2026/11/04"), TypeError);
});

test("来源工具守卫只接受四个来源", () => {
  assert.equal(isSourceTool("codex"), true);
  assert.equal(isSourceTool("claude"), true);
  assert.equal(isSourceTool("workbuddy"), true);
  assert.equal(isSourceTool("dsh"), true);
  assert.equal(isSourceTool("openai"), false);
});

test("错误码全集包含 C14 新增的记录完整性警告", () => {
  assert.equal(ERROR_META["E-SRC-003"].surface, "warning");
  assert.equal(ERROR_META["E-SRC-005"].retryable, false);
});