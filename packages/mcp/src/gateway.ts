import type { ErrorCode } from "@workweave/core";
import { TOOL_CONTRACTS, capabilityDeclaration } from "./contracts.js";
import {
  MCP_CONTRACT_VERSION,
  type AuthContext,
  type CapabilityDeclaration,
  type ToolContract,
  type ToolHandler,
  type ToolInvocation,
  type ToolResult
} from "./types.js";

export interface GatewayOptions {
  readonly expectedHostId: string;
  readonly expectedToken: string;
  readonly handlers: ReadonlyMap<string, ToolHandler>;
  readonly contracts?: readonly ToolContract[];
}

interface ParamValidation {
  readonly ok: boolean;
  readonly detail?: string;
}

function validateParams(contract: ToolContract, params: Readonly<Record<string, unknown>>): ParamValidation {
  const specs = new Map(contract.params.map((param) => [param.name, param]));
  const allowed = [...specs.keys()];

  for (const key of Object.keys(params)) {
    if (!specs.has(key)) {
      return { ok: false, detail: `unknown parameter: ${key}; allowed: ${allowed.join(",")}` };
    }
  }

  for (const spec of contract.params) {
    const value = params[spec.name];
    if (value === undefined) {
      if (spec.required) return { ok: false, detail: `missing required parameter: ${spec.name}` };
      continue;
    }

    if (spec.type === "string[]") {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        return { ok: false, detail: `parameter ${spec.name} must be an array of strings` };
      }
    } else if (spec.type === "object") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { ok: false, detail: `parameter ${spec.name} must be an object` };
      }
    } else if (typeof value !== spec.type) {
      return { ok: false, detail: `parameter ${spec.name} must be of type ${spec.type}` };
    }

    if (spec.enum !== undefined && typeof value === "string" && !spec.enum.includes(value)) {
      return { ok: false, detail: `parameter ${spec.name} must be one of: ${spec.enum.join(",")}` };
    }

    if (typeof value === "string" && spec.max !== undefined && value.length > spec.max) {
      return { ok: false, detail: `parameter ${spec.name} exceeds maximum length ${spec.max}` };
    }
    if (typeof value === "number") {
      if (spec.min !== undefined && value < spec.min) {
        return { ok: false, detail: `parameter ${spec.name} must be >= ${spec.min}` };
      }
      if (spec.max !== undefined && value > spec.max) {
        return { ok: false, detail: `parameter ${spec.name} must be <= ${spec.max}` };
      }
    }
  }

  return { ok: true };
}

export class ContractGateway {
  private readonly expectedHostId: string;
  private readonly expectedToken: string;
  private readonly handlers: ReadonlyMap<string, ToolHandler>;
  private readonly contracts: ReadonlyMap<string, ToolContract>;
  private readonly calls = new Map<string, ToolResult | Promise<ToolResult>>();

  constructor(options: GatewayOptions) {
    this.expectedHostId = options.expectedHostId;
    this.expectedToken = options.expectedToken;
    this.handlers = options.handlers;
    const contracts = options.contracts ?? TOOL_CONTRACTS;
    this.contracts = new Map(contracts.map((contract) => [contract.name, contract]));
  }

  capabilityQuery(): CapabilityDeclaration {
    return capabilityDeclaration([...this.contracts.values()]);
  }

  async invoke(invocation: ToolInvocation): Promise<ToolResult> {
    const base = {
      callId: invocation.callId,
      contractVersion: MCP_CONTRACT_VERSION,
      warnings: [] as readonly string[]
    };

    const contract = this.contracts.get(invocation.tool);
    if (contract === undefined) {
      return { ...base, ok: false, code: "E-MCP-005", detail: `unknown tool: ${invocation.tool}` };
    }

    if (invocation.contractVersion !== undefined && invocation.contractVersion !== MCP_CONTRACT_VERSION) {
      return {
        ...base,
        ok: false,
        code: "E-MCP-001",
        detail: `unsupported contract version ${invocation.contractVersion}; supported: ${MCP_CONTRACT_VERSION}`
      };
    }

    const auth: Readonly<Partial<AuthContext>> = invocation.auth;
    if (auth.hostId !== this.expectedHostId || auth.token !== this.expectedToken) {
      return { ...base, ok: false, code: "E-MCP-002", detail: "invalid host credentials" };
    }

    const validation = validateParams(contract, invocation.params ?? {});
    if (!validation.ok) {
      return { ...base, ok: false, code: "E-MCP-003", detail: validation.detail ?? "invalid parameters" };
    }

    const cached = this.calls.get(invocation.callId);
    if (cached !== undefined) return await cached;

    const handler = this.handlers.get(contract.name);
    if (handler === undefined) {
      return { ...base, ok: false, code: "E-MCP-005", detail: `no handler registered for: ${contract.name}` };
    }

    const pending = (async (): Promise<ToolResult> => {
      try {
        const data = await handler(invocation);
        return { ...base, ok: true, data };
      } catch (error) {
        const code = ((error as { code?: ErrorCode }).code ?? "E-MCP-004") as ErrorCode;
        return {
          ...base,
          ok: false,
          code,
          detail: error instanceof Error ? error.message : String(error)
        };
      }
    })();

    this.calls.set(invocation.callId, pending);
    const result = await pending;
    this.calls.set(invocation.callId, result);
    return result;
  }
}