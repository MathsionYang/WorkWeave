import type { CompletenessStatus, SourceTool } from "../domain/types.js";

export type LogStage =
  | "probe"
  | "ingest"
  | "classify"
  | "extract"
  | "evidence"
  | "validate"
  | "report"
  | "export"
  | "schedule";

export interface LogRecord {
  readonly timestamp: string;
  readonly callId: string;
  readonly stage: LogStage;
  readonly sourceTool?: SourceTool;
  readonly resultCode: string;
  readonly durationMs: number;
  readonly completenessStatus?: CompletenessStatus;
  readonly contentDigest?: string;
}

export const FORBIDDEN_LOG_FIELDS = ["text", "body", "content", "message", "arguments", "token", "password"] as const;

export function formatLog(record: LogRecord): string {
  return JSON.stringify({
    timestamp: record.timestamp,
    callId: record.callId,
    stage: record.stage,
    sourceTool: record.sourceTool ?? null,
    resultCode: record.resultCode,
    durationMs: record.durationMs,
    completenessStatus: record.completenessStatus ?? null,
    contentDigest: record.contentDigest ?? null
  });
}