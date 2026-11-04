import type { CompletenessGap, Message } from "../domain/models.js";
import type { Instant, SessionId, SourceTool } from "../domain/types.js";

export interface ParsedSession {
  readonly sessionId: SessionId;
  readonly sourceTool: SourceTool;
  readonly startedAt: Instant;
  readonly endedAt?: Instant;
  readonly workDir?: string;
  readonly title?: string;
  readonly messages: readonly Message[];
  readonly unknownTypeCount: number;
  readonly redactedBlockCount?: number;
  readonly gaps: readonly CompletenessGap[];
  readonly sourceFile: string;
}

export interface SourceAdapter {
  readonly source: SourceTool;
  scan(root: string): AsyncIterable<string>;
  parse(filePath: string): Promise<ParsedSession>;
  enumerableSessionIds(root: string): Promise<readonly string[]>;
}

export interface CollectDayInput {
  readonly adapter: SourceAdapter;
  readonly root: string;
  readonly day: string;
  readonly maxSessions?: number;
}

export interface CollectFailure {
  readonly file: string;
  readonly reason: string;
}

export interface CollectDayResult {
  readonly dataVersion: string;
  readonly sessions: readonly ParsedSession[];
  readonly sessionCount: number;
  readonly messageCount: number;
  readonly duplicateSessionCount: number;
  readonly unknownTypeCount: number;
  readonly failures: readonly CollectFailure[];
  readonly warnings: readonly string[];
}