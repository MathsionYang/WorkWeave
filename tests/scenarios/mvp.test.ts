import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zstdCompressSync } from "node:zlib";
import { runReportCommand } from "@workweave/cli";

const BASE = Date.parse("2026-11-04T08:00:00.000Z");

function frame(lines: readonly Record<string, unknown>[]): Buffer {
  return zstdCompressSync(Buffer.from(lines.map((line) => JSON.stringify(line)).join("\n"), "utf8"));
}

function codexSession(): string {
  return [
    JSON.stringify({
      timestamp: "2026-11-04T08:00:00.000Z",
      ordinal: 0,
      type: "session_meta",
      payload: { session_id: "codex-1", cwd: "/work/project-a" }
    }),
    JSON.stringify({
      timestamp: "2026-11-04T08:01:00.000Z",
      ordinal: 1,
      type: "response_item",
      payload: { type: "message", id: "c1", role: "user", content: [{ type: "text", text: "修复登录 bug" }] }
    }),
    JSON.stringify({
      timestamp: "2026-11-04T08:02:00.000Z",
      ordinal: 2,
      type: "response_item",
      payload: { type: "message", id: "c2", role: "assistant", content: [{ type: "text", text: "已修复" }] }
    })
  ].join("\n");
}

function workbuddySession(): string {
  return [
    JSON.stringify({
      type: "message",
      id: "w1",
      timestamp: BASE,
      role: "user",
      cwd: "D:\\项目\\CheckMCP\\Doc",
      content: [{ type: "text", text: "检查文档" }]
    }),
    JSON.stringify({
      type: "ai-title",
      aiTitle: "文档检查",
      sessionId: "wb-1",
      cwd: "D:\\项目\\CheckMCP\\Doc",
      timestamp: "2026-11-04T08:00:00.000Z"
    }),
    JSON.stringify({
      type: "message",
      id: "w2",
      timestamp: BASE + 60000,
      role: "assistant",
      cwd: "D:\\项目\\CheckMCP\\Doc",
      content: [{ type: "text", text: "已检查" }]
    })
  ].join("\n");
}

function dshSession(): Buffer {
  const first = frame([
    {
      type: "session",
      seq: 0,
      time: BASE,
      data: { version: 3, id: "dsh-1", createdAt: BASE, cwd: "D:\\项目\\CheckMCP\\Doc" }
    },
    {
      type: "user/message",
      seq: 1,
      time: BASE + 1000,
      data: { content: [{ type: "text", text: "调研方案对比" }], role: "user", id: "du1" }
    }
  ]);
  const second = frame([
    {
      type: "assistant/message",
      seq: 2,
      time: BASE + 2000,
      data: {
        turn: 1,
        step: 1,
        message: { role: "assistant", content: [{ type: "text", text: "结论是采用 A" }], id: "da1" }
      }
    },
    {
      type: "session/title",
      seq: 3,
      time: BASE + 3000,
      data: { title: "调研方案对比" }
    }
  ]);
  return Buffer.concat([first, second]);
}

test("MVP 端到端：三来源 + Claude 部分可用 + 无宿主事实模式", async () => {
  const home = await mkdtemp(join(tmpdir(), "ww-mvp-"));
  const codexDir = join(home, ".codex", "sessions", "2026", "11", "04");
  const workbuddyDir = join(home, ".workbuddy", "projects", "d-项目-CheckMCP-Doc");
  const dshDir = join(home, ".dsh", "sessions", "project", "dsh-1");
  await mkdir(codexDir, { recursive: true });
  await mkdir(workbuddyDir, { recursive: true });
  await mkdir(dshDir, { recursive: true });
  await mkdir(join(home, ".claude", "projects"), { recursive: true });

  await writeFile(join(codexDir, "rollout-2026-11-04T08-00-00-codex-1.jsonl"), codexSession(), "utf8");
  await writeFile(join(workbuddyDir, "wb-1.jsonl"), workbuddySession(), "utf8");
  await writeFile(join(dshDir, "session.v3.jsonl.zstd"), dshSession());

  const out = join(home, "mvp-daily.md");
  const first = await runReportCommand({
    day: "2026-11-04",
    out,
    homeDir: home,
    platform: "linux",
    env: {},
    format: "markdown",
    now: new Date("2026-11-06T00:00:00.000Z")
  });
  const markdown = await readFile(out, "utf8");

  assert.equal(first.sessionCount, 3);
  assert.ok(first.skippedSources.includes("claude"));
  assert.ok(markdown.includes("可能不完整"));
  assert.ok(markdown.includes("来源分布"));
  for (const source of ["codex", "dsh", "workbuddy"]) {
    assert.ok(markdown.includes(source), `missing source: ${source}`);
  }
  assert.ok(markdown.includes("调研方案对比"));
  assert.ok(markdown.includes("AI 协作与采纳"));

  const second = await runReportCommand({
    day: "2026-11-04",
    out,
    homeDir: home,
    platform: "linux",
    env: {},
    format: "markdown",
    now: new Date("2026-11-06T00:00:00.000Z")
  });
  assert.equal(second.dataVersion, first.dataVersion);
  assert.equal(second.sessionCount, first.sessionCount);
});