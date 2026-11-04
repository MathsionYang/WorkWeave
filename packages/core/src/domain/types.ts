export type Brand<T, B extends string> = T & { readonly __brand: B };

export const SOURCE_TOOL_VALUES = ["codex", "claude", "workbuddy", "dsh"] as const;
export type SourceTool = (typeof SOURCE_TOOL_VALUES)[number];

export function isSourceTool(value: unknown): value is SourceTool {
  return typeof value === "string" && (SOURCE_TOOL_VALUES as readonly string[]).includes(value);
}

export type SessionId = Brand<string, "SessionId">;
export type MessageId = Brand<string, "MessageId">;
export type ProjectId = Brand<string, "ProjectId">;
export type PackageId = Brand<string, "PackageId">;
export type CallId = Brand<string, "CallId">;
export type Instant = Brand<string, "Instant">;
export type PlainDate = Brand<string, "PlainDate">;
export type Confidence = Brand<number, "Confidence">;
export type DataVersion = Brand<string, "DataVersion">;

function requireNonEmpty(value: string, label: string): string {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

export function asSessionId(value: string): SessionId {
  return requireNonEmpty(value, "SessionId") as SessionId;
}

export function asMessageId(value: string): MessageId {
  return requireNonEmpty(value, "MessageId") as MessageId;
}

export function asProjectId(value: string): ProjectId {
  return requireNonEmpty(value, "ProjectId") as ProjectId;
}

export function asPackageId(value: string): PackageId {
  return requireNonEmpty(value, "PackageId") as PackageId;
}

export function asCallId(value: string): CallId {
  return requireNonEmpty(value, "CallId") as CallId;
}

export function asInstant(value: string): Instant {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Instant must be an ISO timestamp: ${value}`);
  }
  return value as Instant;
}

export function asPlainDate(value: string): PlainDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`PlainDate must be YYYY-MM-DD: ${value}`);
  }
  return value as PlainDate;
}

export function asConfidence(value: number): Confidence {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Confidence must be between 0 and 1: ${value}`);
  }
  return value as Confidence;
}

export function asDataVersion(value: string): DataVersion {
  return requireNonEmpty(value, "DataVersion") as DataVersion;
}

export type ErrorCode =
  | "E-SRC-001"
  | "E-SRC-002"
  | "E-SRC-003"
  | "E-SRC-004"
  | "E-SRC-005"
  | "E-CAP-001"
  | "E-CAP-002"
  | "E-CAP-003"
  | "E-CAP-004"
  | "E-CLS-001"
  | "E-CLS-002"
  | "E-CLS-003"
  | "E-CLS-004"
  | "E-EXT-001"
  | "E-EXT-002"
  | "E-EXT-003"
  | "E-FIX-001"
  | "E-FIX-002"
  | "E-FIX-003"
  | "E-RPT-001"
  | "E-RPT-002"
  | "E-RPT-003"
  | "E-SCH-001"
  | "E-HOST-001"
  | "E-SUM-001"
  | "E-SUM-002"
  | "E-SUM-003"
  | "E-MCP-001"
  | "E-MCP-002"
  | "E-MCP-003"
  | "E-MCP-004"
  | "E-MCP-005"
  | "E-PKG-001"
  | "E-PKG-002"
  | "E-PKG-003"
  | "E-AUTH-001"
  | "E-AUTH-002"
  | "E-SEC-001"
  | "E-SEC-002";

export type ProbeStatus =
  | "discovered"
  | "partially-available"
  | "not-found"
  | "permission-denied"
  | "unsupported-format"
  | "version-unknown";

export const PROBE_STATUS_VALUES = [
  "discovered",
  "partially-available",
  "not-found",
  "permission-denied",
  "unsupported-format",
  "version-unknown"
] as const satisfies readonly ProbeStatus[];

export type CompletenessStatus = "complete" | "possibly-incomplete";

export type CompletenessGapType =
  | "source-type-missing"
  | "session-missing"
  | "body-missing"
  | "message-discontinuity"
  | "time-gap"
  | "index-mismatch";

export const COMPLETENESS_GAP_TYPES = [
  "source-type-missing",
  "session-missing",
  "body-missing",
  "message-discontinuity",
  "time-gap",
  "index-mismatch"
] as const satisfies readonly CompletenessGapType[];

export type ProbeLayer =
  | "manual"
  | "configured-rule"
  | "env"
  | "platform-default"
  | "builtin-fallback";

export const PROBE_LAYER_RANK: Readonly<Record<ProbeLayer, number>> = {
  manual: 0,
  "configured-rule": 1,
  env: 2,
  "platform-default": 3,
  "builtin-fallback": 4
};

export type CandidateValidationState =
  | "valid"
  | "missing"
  | "not-a-directory"
  | "unreadable"
  | "shape-mismatch"
  | "not-whitelisted";

export type CandidateHitState = "adopted" | "ignored" | "invalid" | "pending-confirmation";

export type ActivityCategory =
  | "requirements-design"
  | "coding"
  | "debugging"
  | "testing"
  | "documentation"
  | "research"
  | "pure-conversation"
  | "optimization";

export type TestStatus = "passed" | "failed" | "blocked" | "not-run";

export type AdoptionStatus =
  | "confirmed-adopted"
  | "inferred-adopted"
  | "not-adopted"
  | "undeterminable";

export type ResearchConclusionStatus =
  | "concluded"
  | "collecting"
  | "verification-failed"
  | "undecided";

export type MessageRole = "user" | "assistant" | "system" | "tool" | "developer";

export type Platform = "win32" | "darwin" | "linux";