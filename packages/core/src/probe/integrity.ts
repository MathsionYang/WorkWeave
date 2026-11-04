import type { CompletenessGapType, SourceTool } from "../domain/types.js";
import type { CompletenessDeclaration, CompletenessGap } from "../domain/models.js";

export interface IntegrityThresholds {
  readonly timeGapMs: number;
  readonly discontinuityMs: number;
}

export const DEFAULT_INTEGRITY_THRESHOLDS: IntegrityThresholds = {
  timeGapMs: 6 * 60 * 60 * 1000,
  discontinuityMs: 60 * 1000
};

export interface IntegrityInput {
  readonly source: SourceTool;
  readonly rootExists: boolean;
  readonly rootReadable: boolean;
  readonly readableTypes?: readonly ("code" | "desktop")[];
  readonly indexSessionIds?: readonly string[];
  readonly readableSessionIds?: readonly string[];
  readonly indexCount?: number;
  readonly readableCount?: number;
  readonly messageOrdinals?: readonly number[];
  readonly messageTimestamps?: readonly string[];
  readonly emptyBodyMessageCount?: number;
  readonly hasAnyReadableRecord?: boolean;
  readonly hasAnyCompletenessBasis?: boolean;
  readonly thresholds?: IntegrityThresholds;
}

function gapsForClaude(input: IntegrityInput): CompletenessGap[] {
  const gaps: CompletenessGap[] = [];
  const types = input.readableTypes ?? [];
  const hasCode = types.includes("code");
  const hasDesktop = types.includes("desktop");

  if (hasCode && !hasDesktop) {
    gaps.push({
      type: "source-type-missing",
      source: "claude",
      scope: "claude-desktop",
      basis: "only Claude Code records are readable; no Claude Desktop chat record was discovered"
    });
  }

  if (input.indexSessionIds !== undefined && input.readableSessionIds !== undefined) {
    const readable = new Set(input.readableSessionIds);
    const missing = input.indexSessionIds.filter((id) => !readable.has(id));
    if (missing.length > 0) {
      gaps.push({
        type: "session-missing",
        source: "claude",
        scope: "claude-sessions",
        affectedCount: missing.length,
        basis: `index contains ${missing.length} session(s) not readable locally`
      });
    }
  }

  return gaps;
}

function gapsForMessages(input: IntegrityInput): CompletenessGap[] {
  const gaps: CompletenessGap[] = [];
  const thresholds = input.thresholds ?? DEFAULT_INTEGRITY_THRESHOLDS;

  if ((input.emptyBodyMessageCount ?? 0) > 0) {
    gaps.push({
      type: "body-missing",
      source: input.source,
      scope: "messages",
      affectedCount: input.emptyBodyMessageCount,
      basis: "one or more messages have an empty body"
    });
  }

  const ordinals = input.messageOrdinals;
  if (ordinals !== undefined && ordinals.length > 1) {
    let discontinuities = 0;
    for (let i = 1; i < ordinals.length; i += 1) {
      const previous = ordinals[i - 1];
      const current = ordinals[i];
      if (previous !== undefined && current !== undefined && current - previous > 1) {
        discontinuities += 1;
      }
    }
    if (discontinuities > 0) {
      gaps.push({
        type: "message-discontinuity",
        source: input.source,
        scope: "messages",
        affectedCount: discontinuities,
        basis: "ordinal gaps detected between adjacent messages"
      });
    }
  }

  const timestamps = input.messageTimestamps;
  if (timestamps !== undefined && timestamps.length > 1) {
    let gapsCount = 0;
    for (let i = 1; i < timestamps.length; i += 1) {
      const previous = timestamps[i - 1];
      const current = timestamps[i];
      if (previous === undefined || current === undefined) continue;
      const delta = new Date(current).getTime() - new Date(previous).getTime();
      if (Number.isFinite(delta) && delta > thresholds.timeGapMs) {
        gapsCount += 1;
      }
    }
    if (gapsCount > 0) {
      gaps.push({
        type: "time-gap",
        source: input.source,
        scope: "messages",
        affectedCount: gapsCount,
        basis: `adjacent message gap exceeds ${thresholds.timeGapMs} ms`
      });
    }
  }

  return gaps;
}

function gapsForIndex(input: IntegrityInput): CompletenessGap[] {
  if (
    input.indexSessionIds === undefined &&
    input.readableSessionIds === undefined &&
    input.indexCount !== undefined &&
    input.readableCount !== undefined &&
    input.indexCount > input.readableCount
  ) {
    return [
      {
        type: "index-mismatch",
        source: input.source,
        scope: "session-index",
        affectedCount: input.indexCount - input.readableCount,
        basis: "session index count is greater than readable session file count"
      }
    ];
  }
  return [];
}

export function analyzeIntegrity(input: IntegrityInput): CompletenessDeclaration {
  if (!input.rootExists || !input.rootReadable) {
    return { status: "complete", gaps: [], undetermined: false };
  }

  const gaps: CompletenessGap[] = [];
  if (input.source === "claude") {
    gaps.push(...gapsForClaude(input));
  }
  gaps.push(...gapsForMessages(input));
  gaps.push(...gapsForIndex(input));

  const hasAnyReadableRecord = input.hasAnyReadableRecord ?? true;
  const hasAnyCompletenessBasis =
    input.hasAnyCompletenessBasis ?? (gaps.length > 0 || (input.indexSessionIds?.length ?? 0) > 0);

  const undetermined = !hasAnyReadableRecord && !hasAnyCompletenessBasis;
  const status = gaps.length > 0 || undetermined ? "possibly-incomplete" : "complete";

  return { status, gaps, undetermined };
}

export function gapTypes(declaration: CompletenessDeclaration): readonly CompletenessGapType[] {
  return [...new Set<CompletenessGapType>(declaration.gaps.map((gap) => gap.type))];
}