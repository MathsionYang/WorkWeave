import assert from "node:assert/strict";
import test from "node:test";
import { groupExactPromptHits } from "@workweave/core";
import type { MessageSearchHit } from "@workweave/core";

function hit(sourceTool: "codex" | "workbuddy", sessionId: string, messageId: string, text: string, timestamp: string, projectId?: string): MessageSearchHit {
  return {
    sourceTool, sessionId, messageId, role: "user", text, timestamp,
    ...(projectId !== undefined ? { projectId } : {})
  };
}

test("????????????????????????????????", () => {
  const results = groupExactPromptHits([
    hit("codex", "c1", "m1", "  Fix login\r\nnow  ", "2026-11-01T10:00:00.000Z", "project-a"),
    hit("workbuddy", "w1", "m2", "Fix login\nnow", "2026-11-01T10:09:59.000Z", "project-a"),
    hit("codex", "c2", "m3", "Fix login\nnow", "2026-11-01T10:00:01.000Z", "project-b"),
    hit("workbuddy", "w2", "m4", "Fix login\nnow", "2026-11-01T10:10:01.000Z", "project-a"),
    hit("workbuddy", "w3", "m5", "Fix login\nnow", "2026-11-01T10:00:00.000Z")
  ]);
  assert.equal(results.length, 4);
  const grouped = results.find((item) => item.sources.length === 2);
  assert.ok(grouped);
  assert.deepEqual(grouped.sources.map(({ sourceTool, sessionId, messageId }) => ({ sourceTool, sessionId, messageId }))
    .sort((left, right) => left.sourceTool.localeCompare(right.sourceTool)), [
    { sourceTool: "codex", sessionId: "c1", messageId: "m1" },
    { sourceTool: "workbuddy", sessionId: "w1", messageId: "m2" }
  ]);
  assert.equal(results.some((item) => item.messageId === "m3"), true);
  assert.equal(results.some((item) => item.messageId === "m4"), true);
  assert.equal(results.some((item) => item.messageId === "m5"), true);

  const unicode = groupExactPromptHits([
    hit("codex", "unicode-c", "unicode-m1", "e\u0301", "2026-11-01T10:00:00.000Z", "project-a"),
    hit("workbuddy", "unicode-w", "unicode-m2", "\u00e9", "2026-11-01T10:01:00.000Z", "project-a")
  ]);
  assert.equal(unicode.length, 1);
  assert.equal(unicode[0]?.sources.length, 2);
});
