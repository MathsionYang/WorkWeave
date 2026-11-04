import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isClaudeParserEnabled, validateClaudeFingerprint } from "@workweave/adapters";

const validReport = {
  version: 1,
  files: 1,
  samples: [
    {
      file: "s1.jsonl",
      lineCount: 42,
      typeCounts: { message: 40, "file-history-snapshot": 2 },
      shapes: { message: { role: "string", content: ["array"] } }
    }
  ]
};

test("合法取证报告允许启用 Claude 解析器", async () => {
  assert.equal(validateClaudeFingerprint(validReport), true);
  const dir = await mkdtemp(join(tmpdir(), "ww-claude-"));
  const path = join(dir, "claude-fingerprint.json");
  await writeFile(path, JSON.stringify(validReport), "utf8");
  assert.equal(await isClaudeParserEnabled(path), true);
});

test("缺失或不合规取证报告保持解析器禁用", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ww-claude-"));
  assert.equal(await isClaudeParserEnabled(join(dir, "missing.json")), false);
  assert.equal(validateClaudeFingerprint({ version: 1, files: 0, samples: [] }), false);
  assert.equal(validateClaudeFingerprint({ version: 2, files: 1, samples: [{}] }), false);
});