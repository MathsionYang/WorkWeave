import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zstdCompressSync } from "node:zlib";
import {
  DshAdapter,
  decodeDshProjectSlug,
  decompressZstdFrames
} from "@workweave/adapters";
import { WorkWeaveError } from "@workweave/core";

const BASE = Date.parse("2026-11-04T08:00:00.000Z");

function frameText(lines: readonly Record<string, unknown>[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n");
}

function frames(version = 3): Buffer {
  const first = frameText([
    {
      type: "session",
      seq: 0,
      time: BASE,
      data: { version, id: "s1", createdAt: BASE, cwd: "D:\\项目\\CheckMCP\\Doc", isSeeded: false, delegationDepth: 0 }
    },
    {
      type: "user/message",
      seq: 1,
      time: BASE + 1000,
      data: { content: [{ type: "text", text: "检查项目文档" }], role: "user", id: "u1" },
      surfaceOp: "append"
    }
  ]);
  const second = frameText([
    {
      type: "assistant/message",
      seq: 2,
      time: BASE + 2000,
      data: {
        turn: 1,
        step: 1,
        message: { role: "assistant", content: [{ type: "text", text: "已完成检查" }], id: "a1" }
      },
      surfaceOp: "append"
    },
    {
      type: "session/title",
      seq: 3,
      time: BASE + 3000,
      data: { title: "文档检查", messageSeqs: [1, 2], source: { kind: "fallback" } }
    }
  ]);
  return Buffer.concat([zstdCompressSync(Buffer.from(first, "utf8")), zstdCompressSync(Buffer.from(second, "utf8"))]);
}

async function writeSession(version = 3): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ww-dsh-"));
  const dir = join(root, ".dsh", "sessions", "--D-~9879~76EE-CheckMCP-Doc-~5408~540C~5BA1~6279--", "s1");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `session.v${version}.jsonl.zstd`);
  await writeFile(file, frames(version));
  return join(root, ".dsh");
}

test("逐帧解压多帧 zstd 并还原 JSONL", () => {
  const result = decompressZstdFrames(frames());
  assert.equal(result.frames, 2);
  assert.equal(result.corrupt, 0);
  assert.ok(result.text.includes("\"user/message\""));
  assert.ok(result.text.includes("\"assistant/message\""));
});

test("dsh v3 解析用户与助手消息、cwd 与标题", async () => {
  const root = await writeSession();
  const adapter = new DshAdapter();
  const parsed = await adapter.parse(join(root, "sessions", "--D-~9879~76EE-CheckMCP-Doc-~5408~540C~5BA1~6279--", "s1", "session.v3.jsonl.zstd"));

  assert.equal(parsed.sessionId, "s1");
  assert.equal(parsed.workDir, "D:\\项目\\CheckMCP\\Doc");
  assert.equal(parsed.title, "文档检查");
  assert.deepEqual(parsed.messages.map((message) => message.role), ["user", "assistant"]);
  assert.equal(parsed.unknownTypeCount, 0);

  const scanned: string[] = [];
  for await (const file of adapter.scan(root)) scanned.push(file);
  assert.equal(scanned.length, 1);
});

test("dsh 项目 slug 按 UTF-16 与分隔符解码", () => {
  assert.equal(
    decodeDshProjectSlug("--D-~9879~76EE-CheckMCP-Doc-~5408~540C~5BA1~6279--"),
    "D:\\项目\\CheckMCP\\Doc\\合同审批"
  );
});

test("dsh v5 超出版本上限时显式拒绝", async () => {
  const root = await writeSession(5);
  const adapter = new DshAdapter();
  await assert.rejects(
    adapter.parse(join(root, "sessions", "--D-~9879~76EE-CheckMCP-Doc-~5408~540C~5BA1~6279--", "s1", "session.v5.jsonl.zstd")),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-SRC-002"
  );
});