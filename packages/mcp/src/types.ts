import type { ErrorCode } from "@workweave/core";

export const MCP_CONTRACT_VERSION = "1.0.0";
export const MCP_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26"] as const;

export type ToolName =
  | "ww_source_probe"
  | "ww_source_ingest"
  | "ww_work_classify"
  | "ww_fact_extract"
  | "ww_evidence_package"
  | "ww_skill_template_get"
  | "ww_summary_validate"
  | "ww_report_export"
  | "ww_pending_manage"
  | "ww_evidence_resolve";

export type ToolPermission = "read-probe" | "read-ingest" | "local-read-write" | "egress" | "write";

export interface ToolParamSpec {
  readonly name: string;
  readonly required: boolean;
  readonly type: "string" | "number" | "boolean" | "string[]" | "object";
  readonly enum?: readonly string[];
  readonly min?: number;
  readonly max?: number;
}

export interface ToolContract {
  readonly name: ToolName;
  readonly title: string;
  readonly description: string;
  readonly permission: ToolPermission;
  readonly hasBody: false;
  readonly params: readonly ToolParamSpec[];
}

export interface AuthContext {
  readonly hostId: string;
  readonly token: string;
  readonly memberId?: string;
  readonly tenantId?: string;
}

export interface ToolInvocation {
  readonly tool: string;
  readonly contractVersion?: string;
  readonly callId: string;
  readonly auth: Readonly<Partial<AuthContext>>;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface ToolResult {
  readonly ok: boolean;
  readonly callId: string;
  readonly contractVersion: string;
  readonly data?: unknown;
  readonly code?: ErrorCode;
  readonly detail?: string;
  readonly warnings: readonly string[];
}

export type ToolHandler = (invocation: ToolInvocation) => Promise<unknown>;

export interface CapabilityDeclaration {
  readonly protocolVersions: readonly string[];
  readonly contractVersion: string;
  readonly sources: readonly string[];
  readonly reportFormats: readonly string[];
  readonly evidencePackageMaxBytes: number;
  readonly evidencePackageMaxEntries: number;
  readonly templateVersion: string;
  readonly tools: readonly {
    readonly name: ToolName;
    readonly title: string;
    readonly description: string;
    readonly permission: ToolPermission;
    readonly hasBody: false;
    readonly allowedParams: readonly string[];
  }[];
}