import assert from "node:assert/strict";
import test from "node:test";
import { redact, totalHits } from "@workweave/core";

test("四类敏感信息在同一规则集下被替换并计数", () => {
  const input = [
    "key sk-abcdefghijklmnopqrstuvwxyz123456",
    "mail dev@example.com",
    "phone 13812345678",
    "id 110105199001011234",
    "ip 192.168.1.20",
    "password=SuperSecret123"
  ].join("\n");

  const result = redact(input, "report");
  assert.equal(result.text.includes("sk-abcdefghijklmnopqrstuvwxyz123456"), false);
  assert.equal(result.text.includes("dev@example.com"), false);
  assert.equal(result.text.includes("13812345678"), false);
  assert.equal(result.text.includes("110105199001011234"), false);
  assert.equal(result.text.includes("192.168.1.20"), false);
  assert.equal(result.text.includes("SuperSecret123"), false);
  assert.ok(totalHits(result) >= 6);
});

test("同一字段在证据包与报告边界得到一致结果", () => {
  const input = "token: Bearer abcdefghijklmnopqrstuvwxyz012345";
  const evidence = redact(input, "evidence");
  const report = redact(input, "report");
  assert.equal(evidence.text, report.text);
  assert.deepEqual(evidence.hits, report.hits);
});