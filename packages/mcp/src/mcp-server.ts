import { TOOL_CONTRACTS } from "./contracts.js";
import type { ContractGateway } from "./gateway.js";
import {
  MCP_CONTRACT_VERSION,
  MCP_PROTOCOL_VERSIONS,
  type ToolContract,
  type ToolResult
} from "./types.js";

interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

export interface McpServerOptions {
  readonly hostId: string;
  readonly token: string;
  readonly serverName?: string;
  readonly serverVersion?: string;
  readonly contracts?: readonly ToolContract[];
}

interface ParamSchema {
  readonly type: string;
  readonly enum?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly items?: { readonly type: string };
}

function paramSchema(contract: ToolContract): {
  readonly type: "object";
  readonly properties: Readonly<Record<string, ParamSchema>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
} {
  const properties: Record<string, ParamSchema> = {};
  for (const param of contract.params) {
    if (param.type === "string[]") {
      properties[param.name] = { type: "array", items: { type: "string" } };
    } else if (param.type === "object") {
      properties[param.name] = { type: "object" };
    } else {
      properties[param.name] = {
        type: param.type,
        ...(param.enum !== undefined ? { enum: param.enum } : {}),
        ...(param.min !== undefined ? { minimum: param.min } : {}),
        ...(param.max !== undefined ? { maximum: param.max } : {})
      };
    }
  }
  return {
    type: "object",
    properties,
    required: contract.params.filter((param) => param.required).map((param) => param.name),
    additionalProperties: false
  };
}

function toolDescriptor(contract: ToolContract): unknown {
  return {
    name: contract.name,
    description: contract.description,
    inputSchema: paramSchema(contract)
  };
}

function errorResponse(id: string | number | undefined, code: number, message: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message }
  });
}

function resultResponse(id: string | number | undefined, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result });
}

function toolResponse(id: string | number | undefined, result: ToolResult): string {
  const payload = result.ok
    ? result.data
    : { code: result.code, detail: result.detail, warnings: result.warnings };
  return resultResponse(id, {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    ...(result.ok ? {} : { isError: true })
  });
}

export class McpServer {
  private readonly contracts: readonly ToolContract[];
  private readonly serverName: string;
  private readonly serverVersion: string;

  constructor(
    private readonly gateway: ContractGateway,
    private readonly options: McpServerOptions
  ) {
    this.contracts = options.contracts ?? TOOL_CONTRACTS;
    this.serverName = options.serverName ?? "workweave";
    this.serverVersion = options.serverVersion ?? "0.1.0";
  }

  async handle(line: string): Promise<string | undefined> {
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      return errorResponse(undefined, -32700, "parse error");
    }

    const id = request.id;
    const isNotification = id === undefined;

    if (request.method === "notifications/initialized") {
      return undefined;
    }

    if (request.method === "initialize") {
      const requested = request.params?.protocolVersion;
      const supported =
        typeof requested === "string" &&
        (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : (MCP_PROTOCOL_VERSIONS.at(-1) ?? "2025-03-26");
      return resultResponse(id, {
        protocolVersion: supported,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: this.serverName, version: this.serverVersion }
      });
    }

    if (request.method === "ping") {
      return isNotification ? undefined : resultResponse(id, {});
    }

    if (request.method === "tools/list") {
      return resultResponse(id, { tools: this.contracts.map(toolDescriptor) });
    }

    if (request.method === "tools/call") {
      const params = request.params ?? {};
      const name = typeof params.name === "string" ? params.name : "";
      const args =
        typeof params.arguments === "object" && params.arguments !== null
          ? (params.arguments as Record<string, unknown>)
          : {};
      const result = await this.gateway.invoke({
        tool: name,
        callId: `mcp-${String(id ?? Date.now())}`,
        contractVersion: MCP_CONTRACT_VERSION,
        auth: { hostId: this.options.hostId, token: this.options.token },
        params: args
      });
      return toolResponse(id, result);
    }

    if (isNotification) return undefined;
    return errorResponse(id, -32601, `unknown method: ${String(request.method)}`);
  }
}