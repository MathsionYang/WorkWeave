import type { IncomingMessage, ServerResponse } from "node:http";
import type { ContractGateway } from "./gateway.js";

interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

export async function handleJsonRpcLine(gateway: ContractGateway, line: string): Promise<string> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    return JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
  }

  const id = request.id ?? null;

  if (request.method === "tools/list") {
    return JSON.stringify({ jsonrpc: "2.0", id, result: gateway.capabilityQuery() });
  }

  if (request.method === "tools/call") {
    const params = request.params ?? {};
    const name = typeof params.name === "string" ? params.name : "";
    const args = typeof params.arguments === "object" && params.arguments !== null
      ? (params.arguments as Record<string, unknown>)
      : {};
    const auth = typeof params.auth === "object" && params.auth !== null
      ? (params.auth as Record<string, string>)
      : {};
    const callId = typeof params.callId === "string" ? params.callId : String(id ?? "anonymous");
    const contractVersion = typeof params.contractVersion === "string" ? params.contractVersion : undefined;

    const result = await gateway.invoke({
      tool: name,
      callId,
      auth,
      params: args,
      ...(contractVersion !== undefined ? { contractVersion } : {})
    });
    return JSON.stringify({ jsonrpc: "2.0", id, result });
  }

  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `unknown method: ${String(request.method)}` }
  });
}

export function createHttpRequestHandler(
  gateway: ContractGateway,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end();
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const body = Buffer.concat(chunks).toString("utf8");
    const result = await handleJsonRpcLine(gateway, body);
    response.setHeader("content-type", "application/json");
    response.statusCode = 200;
    response.end(result);
  };
}