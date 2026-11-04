import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zstdCompressSync } from "node:zlib";
import { CodexAdapter } from "@workweave/adapters";
import { collectDay } from "@workweave/core";

const SESSION_ID = "01a19ee2-ffdd-78e3-b6ac-afdd95b1a065";

function lines(): string[] {
  return [
    JSON.stringify({
      timestamp: "2026-11-04T08:00:00.000Z",
      ordinal: 0,
      type: "session_meta",
      payload: { session_id: SESSION_ID, cwd: "/work/project-a" }
    }),
    JSON.stringify({
      timestamp: "2026-11-04T08:01:00.000Z",
      ordinal: 1,
      type: "response_item",
      payload: {
        type: "message",
        id: "m-1",
        role: "user",
        content: [{ type: "input_text", text: "帮我修复登录 bug" }]
      }
    }),
    JSON.stringify({
      timestamp: "2026-11-04T08:02:00.000Z",
      ordinal: 2,
      type: "event_msg",
      payload: { type: "task_started" }
    }),
    JSON.stringify({
      timestamp: "2026-11-04T08:03:00.000Z",
      ordinal: 4,
      type: "response_item",
      payload: {
        type: "message",
        id: "m-2",
        role: "assistant",
        content: [{ type: "output_text", text: "已修复并补充测试" }]
      }
    }),
    JSON.stringify({ timestamp: "2026-11-04T08:04:00.000Z", ordinal: 5, type: "future_event", payload: {} })
  ];
}

async function writeSession(root: string, content: string | Buffer, archived = false): Promise<string> {
  const dir = archived
    ? join(root, ".codex", "archived_sessions")
    : join(root, ".codex", "sessions", "2026", "11", "04");
  await mkdir(dir, { recursive: true });
  const file = join(dir, archived ? `rollout-${SESSION_ID}.jsonl.zst` : `rollout-2026-11-04T08-00-00-${SESSION_ID}.jsonl`);
  await writeFile(file, content);
  return file;
}

test("Codex 适配器解析 session_meta、消息角色与未知类型", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ww-codex-"));
  const file = await writeSession(dir, lines().join("\n"));
  const adapter = new CodexAdapter();
  const parsed = await adapter.parse(file);

  assert.equal(parsed.sessionId, SESSION_ID);
  assert.equal(parsed.workDir, "/work/project-a");
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.messages[0]?.role, "user");
  assert.equal(parsed.messages[1]?.role, "assistant");
  assert.equal(parsed.unknownTypeCount, 1);
  assert.ok(parsed.gaps.some((gap) => gap.type === "message-discontinuity"));
});

test("Codex 扫描在线与归档文件并可解析 zstd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ww-codex-"));
  const online = await writeSession(dir, lines().join("\n"));
  const archived = await writeSession(dir, zstdCompressSync(Buffer.from(lines().join("\n"), "utf8")), true);

  const adapter = new CodexAdapter();
  const scanned: string[] = [];
  for await (const file of adapter.scan(join(dir, ".codex"))) scanned.push(file);
  assert.ok(scanned.includes(online));
  assert.ok(scanned.includes(archived));
  const parsed = await adapter.parse(archived);
  assert.equal(parsed.messages.length, 2);
});

test("按自然日采集并去重同一会话", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ww-codex-"));
  await writeSession(dir, lines().join("\n"));
  await writeSession(dir, zstdCompressSync(Buffer.from(lines().join("\n"), "utf8")), true);

  const result = await collectDay({
    adapter: new CodexAdapter(),
    root: join(dir, ".codex"),
    day: "2026-11-04",
    maxSessions: 500
  });

  assert.equal(result.sessionCount, 1);
  assert.equal(result.messageCount, 2);
  assert.equal(result.duplicateSessionCount, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(result.dataVersion.length, 16);
});