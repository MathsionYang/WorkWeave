import assert from "node:assert/strict";
import test from "node:test";
import { ContractGateway, TOOL_CONTRACTS, handleJsonRpcLine } from "@workweave/mcp";
import type { ToolHandler } from "@workweave/mcp";

const auth = { hostId: "workbuddy", token: "local-token" };

function makeGateway(handlers: ReadonlyMap<string, ToolHandler>): ContractGateway {
  return new ContractGateway({
    expectedHostId: auth.hostId,
    expectedToken: auth.token,
    handlers
  });
}

test("能力声明包含工具清单且不返回用户数据", () => {
  const gateway = makeGateway(new Map());
  const declaration = gateway.capabilityQuery();
  assert.equal(declaration.contractVersion, "1.0.0");
  assert.equal(declaration.tools.length, TOOL_CONTRACTS.length);
  assert.ok(declaration.tools.every((tool) => tool.hasBody === false));
  assert.equal(JSON.stringify(declaration).includes("messages"), false);
});

test("契约版本不匹配时返回 E-MCP-001", async () => {
  const gateway = makeGateway(new Map());
  const result = await gateway.invoke({
    tool: "ww_skill_template_get",
    callId: "c1",
    contractVersion: "9.0.0",
    auth
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "E-MCP-001");
});

test("未知参数整体拒绝并列出允许参数", async () => {
  const gateway = makeGateway(new Map([
    ["ww_source_probe", async () => ({ probed: true })]
  ]));
  const result = await gateway.invoke({
    tool: "ww_source_probe",
    callId: "c2",
    auth,
    params: { bogus: 1 }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "E-MCP-003");
  assert.ok(result.detail?.includes("bogus"));
  assert.ok(result.detail?.includes("source"));
});

test("鉴权失败返回 E-MCP-002 且不执行业务处理", async () => {
  let called = false;
  const gateway = makeGateway(new Map([
    ["ww_source_probe", async () => {
      called = true;
      return {};
    }]
  ]));
  const result = await gateway.invoke({
    tool: "ww_source_probe",
    callId: "c3",
    auth: { hostId: "other", token: "forged" }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "E-MCP-002");
  assert.equal(called, false);
});

test("未知工具返回 E-MCP-005", async () => {
  const gateway = makeGateway(new Map());
  const result = await gateway.invoke({ tool: "unknown", callId: "c4", auth });
  assert.equal(result.code, "E-MCP-005");
});

test("写入型工具同一 callId 只执行一次", async () => {
  let count = 0;
  const gateway = makeGateway(new Map([
    ["ww_pending_manage", async () => {
      count += 1;
      return { updated: 1 };
    }]
  ]));

  const first = await gateway.invoke({
    tool: "ww_pending_manage",
    callId: "same",
    auth,
    params: { day: "2026-11-04" }
  });
  const second = await gateway.invoke({
    tool: "ww_pending_manage",
    callId: "same",
    auth,
    params: { day: "2026-11-04" }
  });

  assert.equal(first.ok, true);
  assert.deepEqual(second.data, first.data);
  assert.equal(count, 1);
});

test("JSON-RPC tools/call 返回统一 envelope", async () => {
  const gateway = makeGateway(new Map([
    ["ww_skill_template_get", async () => ({ templateVersion: "1.0.0" })]
  ]));
  const response = await handleJsonRpcLine(
    gateway,
    JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "ww_skill_template_get", callId: "rpc-1", auth, arguments: {} }
    })
  );
  const parsed = JSON.parse(response) as { id: number; result: { ok: boolean; data: { templateVersion: string } } };
  assert.equal(parsed.id, 7);
  assert.equal(parsed.result.ok, true);
  assert.equal(parsed.result.data.templateVersion, "1.0.0");
});