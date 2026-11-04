import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runReportCommand } from "@workweave/cli";

function jsonl(sessionId: string, source: "codex" | "workbuddy"): string {
  if (source === "codex") {
    return [
      JSON.stringify({
        timestamp: "2026-11-04T08:00:00.000Z",
        ordinal: 0,
        type: "session_meta",
        payload: { session_id: sessionId, cwd: "/work/project-a" }
      }),
      JSON.stringify({
        timestamp: "2026-11-04T08:01:00.000Z",
        ordinal: 1,
        type: "response_item",
        payload: { type: "message", id: "c1", role: "user", content: [{ type: "input_text", text: "修复登录 bug" }] }
      }),
      JSON.stringify({
        timestamp: "2026-11-04T08:02:00.000Z",
        ordinal: 2,
        type: "response_item",
        payload: { type: "message", id: "c2", role: "assistant", content: [{ type: "output_text", text: "已修复" }] }
      })
    ].join("\n");
  }
  return [
    JSON.stringify({
      type: "message",
      id: "w1",
      timestamp: Date.parse("2026-11-04T09:00:00.000Z"),
      role: "user",
      content: [{ type: "input_text", text: "调研方案对比" }],
      cwd: "D:\\项目\\CheckMCP\\Doc"
    }),
    JSON.stringify({
      type: "ai-title",
      aiTitle: "调研方案对比",
      sessionId,
      cwd: "D:\\项目\\CheckMCP\\Doc",
      timestamp: "2026-11-04T09:00:00.000Z"
    }),
    JSON.stringify({
      type: "message",
      id: "w2",
      timestamp: Date.parse("2026-11-04T09:01:00.000Z"),
      role: "assistant",
      content: [{ type: "output_text", text: "结论是采用 A" }],
      cwd: "D:\\项目\\CheckMCP\\Doc"
    })
  ].join("\n");
}

test("端到端报告命令产出八部分 Markdown 与数据版本", async () => {
  const home = await mkdtemp(join(tmpdir(), "ww-cli-"));
  const codexDir = join(home, ".codex", "sessions", "2026", "11", "04");
  const workbuddyDir = join(home, ".workbuddy", "projects", "d-项目-CheckMCP-Doc");
  await mkdir(codexDir, { recursive: true });
  await mkdir(workbuddyDir, { recursive: true });
  await writeFile(join(codexDir, "rollout-2026-11-04T08-00-00-s1.jsonl"), jsonl("s1", "codex"), "utf8");
  await writeFile(join(workbuddyDir, "s2.jsonl"), jsonl("s2", "workbuddy"), "utf8");

  const out = join(home, "daily.md");
  const result = await runReportCommand({
    day: "2026-11-04",
    out,
    homeDir: home,
    platform: "linux",
    env: {},
    now: new Date("2026-11-06T00:00:00.000Z")
  });

  assert.equal(result.sessionCount, 2);
  assert.ok(result.dataVersion.length > 0);
  const markdown = await readFile(out, "utf8");
  for (const heading of [
    "## 1. 今日概览",
    "## 2. AI 协作与采纳",
    "## 3. 今日调研",
    "## 4. 按项目总结",
    "## 5. 跨项目与未归属事项",
    "## 6. 纯对话归类摘要",
    "## 7. 待确认项",
    "## 8. 证据索引"
  ]) {
    assert.ok(markdown.includes(heading), `missing ${heading}`);
  }
  assert.ok(markdown.includes("project-a"));
  assert.ok(markdown.includes("Doc"));
});