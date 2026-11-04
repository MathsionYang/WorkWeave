import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ContractGateway, McpServer, WorkWeaveRuntime, createRuntimeHandlers } from "@workweave/mcp";

const HOST = "workbuddy";
const TOKEN = "local-token";
const DAY = "2026-11-04";

function codexLines(): string {
  return [
    JSON.stringify({
      timestamp: `${DAY}T08:00:00.000Z`,
      ordinal: 0,
      type: "session_meta",
      payload: { session_id: "mcp-1", cwd: "/work/project-a" }
    }),
    JSON.stringify({
      timestamp: `${DAY}T08:01:00.000Z`,
      ordinal: 1,
      type: "response_item",
      payload: { type: "message", id: "m1", role: "user", content: [{ type: "text", text: "修复登录 bug" }] }
    })
  ].join("\n");
}

test("MCP 服务端完成 initialize 握手并声明工具 schema", async () => {
  const home = await mkdtemp(join(tmpdir(), "ww-mcp-server-"));
  const codexDir = join(home, ".codex", "sessions", "2026", "11", "04");
  await mkdir(codexDir, { recursive: true });
  await writeFile(join(codexDir, "rollout-2026-11-04T08-00-00-mcp-1.jsonl"), codexLines(), "utf8");

  const runtime = new WorkWeaveRuntime({ homeDir: home, platform: "linux", env: {} });
  const gateway = new ContractGateway({
    expectedHostId: HOST,
    expectedToken: TOKEN,
    handlers: createRuntimeHandlers(runtime)
  });
  const server = new McpServer(gateway, { hostId: HOST, token: TOKEN });

  const initialize = JSON.parse(
    (await server.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" }
      })
    )) as string
  ) as { result: { protocolVersion: string; serverInfo: { name: string } } };

  assert.equal(initialize.result.protocolVersion, "2025-03-26");
  assert.equal(initialize.result.serverInfo.name, "workweave");
  assert.equal(
    await server.handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })),
    undefined
  );

  const list = JSON.parse(
    (await server.handle(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }))) as string
  ) as {
    result: {
      tools: {
        name: string;
        inputSchema: { required: string[]; properties: Record<string, { type: string; enum?: string[] }> };
      }[];
    };
  };

  assert.equal(list.result.tools.length, 10);
  const probeTool = list.result.tools.find((tool) => tool.name === "ww_source_probe");
  assert.equal(probeTool?.inputSchema.properties.source?.type, "string");
  assert.ok(probeTool?.inputSchema.properties.source?.enum?.includes("codex"));

  const validateTool = list.result.tools.find((tool) => tool.name === "ww_summary_validate");
  assert.ok(validateTool?.inputSchema.required.includes("sections"));
});

test("MCP 服务端 tools/call 返回 content 数组与业务结论", async () => {
  const home = await mkdtemp(join(tmpdir(), "ww-mcp-server-"));
  const codexDir = join(home, ".codex", "sessions", "2026", "11", "04");
  await mkdir(codexDir, { recursive: true });
  await writeFile(join(codexDir, "rollout-2026-11-04T08-00-00-mcp-2.jsonl"), codexLines(), "utf8");

  const runtime = new WorkWeaveRuntime({ homeDir: home, platform: "linux", env: {} });
  const gateway = new ContractGateway({
    expectedHostId: HOST,
    expectedToken: TOKEN,
    handlers: createRuntimeHandlers(runtime)
  });
  const server = new McpServer(gateway, { hostId: HOST, token: TOKEN });

  const response = JSON.parse(
    (await server.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "ww_source_probe", arguments: { source: "codex" } }
      })
    )) as string
  ) as { result: { isError?: boolean; content: { type: string; text: string }[] } };

  assert.equal(response.result.isError, undefined);
  const data = JSON.parse(response.result.content[0]?.text ?? "{}") as { status: string }[];
  assert.equal(data[0]?.status, "discovered");

  const unknown = JSON.parse(
    (await server.handle(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "unknown/method" }))) as string
  ) as { error: { code: number } };
  assert.equal(unknown.error.code, -32601);
});