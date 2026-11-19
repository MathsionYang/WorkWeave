import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runIngestCommand } from "@workweave/cli";

test("CLI ingest ? MCP ?? SQLite checkpoint", async () => {
  const home = await mkdtemp(join(tmpdir(), "ww-cli-ingest-"));
  const dir = join(home, ".codex", "sessions", "2026", "11", "04");
  await mkdir(dir, { recursive: true });
  const content = [
    JSON.stringify({ timestamp: "2026-11-04T08:00:00.000Z", ordinal: 0, type: "session_meta", payload: { session_id: "cli-session", cwd: "/work/project" } }),
    JSON.stringify({ timestamp: "2026-11-04T08:01:00.000Z", ordinal: 1, type: "response_item", payload: { type: "message", id: "m1", role: "user", content: [{ type: "text", text: "cli ingest" }] } })
  ].join("\n");
  await writeFile(join(dir, "rollout-2026-11-04T08-00-00-cli.jsonl"), content, "utf8");
  const first = await runIngestCommand({ day: "2026-11-04", source: "codex", homeDir: home, platform: "linux", env: {} });
  const resumed = await runIngestCommand({ day: "2026-11-04", source: "codex", homeDir: home, platform: "linux", env: {}, resume: true });
  const range = await runIngestCommand({ dayFrom: "2026-11-04", dayTo: "2026-11-05", source: "codex", homeDir: home, platform: "linux", env: {}, resume: true });
  assert.equal(first.sessionCount, 1);
  assert.equal(first.completedFiles, 1);
  assert.equal(resumed.resumedFiles, 1);
  assert.equal(resumed.sessionCount, 1);
  assert.equal(range.sessionCount, 1);
  assert.equal(range.messageCount, 1);
});
