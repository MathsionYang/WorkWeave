import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkBuddyAdapter } from "@workweave/adapters";
import { collectDay } from "@workweave/core";

const SESSION_ID = "14e30639-7b55-4340-abdb-50c28c963eea";

function lines(): string[] {
  return [
    JSON.stringify({
      type: "file-history-snapshot",
      isSnapshotUpdate: false,
      snapshot: { messageId: "m-1", trackedFileBackups: [], cwd: "D:\\项目\\CheckMCP\\Doc" }
    }),
    JSON.stringify({
      type: "message",
      id: "m-1",
      timestamp: Date.parse("2026-11-04T09:00:00.000Z"),
      role: "user",
      content: [{ type: "input_text", text: "检查项目文档" }]
    }),
    JSON.stringify({
      type: "ai-title",
      aiTitle: "文档检查",
      sessionId: SESSION_ID,
      cwd: "D:\\项目\\CheckMCP\\Doc",
      timestamp: "2026-11-04T09:00:00.000Z"
    }),
    JSON.stringify({
      type: "message",
      id: "m-2",
      timestamp: Date.parse("2026-11-04T09:05:00.000Z"),
      role: "assistant",
      content: [{ type: "output_text", text: "已完成检查" }]
    }),
    JSON.stringify({ type: "unknown-line", payload: {} })
  ];
}

async function writeSession(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ww-wb-"));
  const project = join(dir, ".workbuddy", "projects", "d-项目-CheckMCP-Doc");
  await mkdir(project, { recursive: true });
  const file = join(project, `${SESSION_ID}.jsonl`);
  await writeFile(file, lines().join("\n"), "utf8");
  return join(dir, ".workbuddy");
}

test("WorkBuddy 解析三类行、cwd 与毫秒时间", async () => {
  const root = await writeSession();
  const adapter = new WorkBuddyAdapter();
  const parsed = await adapter.parse(
    join(root, "projects", "d-项目-CheckMCP-Doc", `${SESSION_ID}.jsonl`)
  );

  assert.equal(parsed.sessionId, SESSION_ID);
  assert.equal(parsed.workDir, "D:\\项目\\CheckMCP\\Doc");
  assert.equal(parsed.title, "文档检查");
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.unknownTypeCount, 1);
  assert.ok(parsed.startedAt.startsWith("2026-11-04T09:00:00"));
});

test("WorkBuddy 扫描 projects 并去重", async () => {
  const root = await writeSession();
  const result = await collectDay({
    adapter: new WorkBuddyAdapter(),
    root,
    day: "2026-11-04",
    maxSessions: 500
  });
  assert.equal(result.sessionCount, 1);
  assert.equal(result.messageCount, 2);
  assert.equal(result.failures.length, 0);
});

test("WorkBuddy 剔除身份注入块只计数量", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ww-wb-"));
  const project = join(dir, ".workbuddy", "projects", "slug");
  await mkdir(project, { recursive: true });
  const file = join(project, "s1.jsonl");
  await writeFile(
    file,
    [
      JSON.stringify({
        type: "message",
        id: "m-1",
        timestamp: Date.parse("2026-11-04T09:00:00.000Z"),
        role: "user",
        content: [{ type: "input_text", text: "# SOUL.md\nprivate identity content" }]
      }),
      JSON.stringify({
        type: "message",
        id: "m-2",
        timestamp: Date.parse("2026-11-04T09:01:00.000Z"),
        role: "assistant",
        content: [{ type: "output_text", text: "正常回复" }]
      })
    ].join("\n")
  );
  const parsed = await new WorkBuddyAdapter().parse(file);
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.redactedBlockCount, 1);
  assert.equal(JSON.stringify(parsed).includes("private identity content"), false);
});