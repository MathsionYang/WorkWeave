import type { ClassifiedSession } from "../classify/types.js";
import type { ParsedSession } from "../ingest/types.js";
import type { CompletenessDeclaration, SourceDistribution, SourceShare } from "../domain/models.js";
import type { CompletenessGapType, PlainDate, SourceTool } from "../domain/types.js";

export interface DistributionInput {
  readonly projectId: string;
  readonly range: { readonly from: PlainDate; readonly to: PlainDate };
  readonly sessions: readonly ParsedSession[];
  readonly classifications: readonly ClassifiedSession[];
  readonly completenessBySource?: Readonly<Partial<Record<SourceTool, CompletenessDeclaration>>>;
  readonly disabledSources?: readonly SourceTool[];
}

function gapsOf(declaration: CompletenessDeclaration | undefined): readonly CompletenessGapType[] {
  return declaration === undefined ? [] : [...new Set(declaration.gaps.map((gap) => gap.type))];
}

export function computeProjectDistribution(input: DistributionInput): SourceDistribution {
  const disabled = new Set(input.disabledSources ?? []);
  const bySessionId = new Map(input.classifications.map((classification) => [classification.sessionId, classification]));
  const shares = new Map<SourceTool, { sessions: number; messages: number }>();
  let totalSessions = 0;
  let totalMessages = 0;

  for (const session of input.sessions) {
    if (disabled.has(session.sourceTool)) continue;
    const classification = bySessionId.get(session.sessionId);
    if (classification === undefined) continue;
    if (classification.projectId !== input.projectId) continue;
    if (classification.category === "pure-conversation") continue;

    const entry = shares.get(session.sourceTool) ?? { sessions: 0, messages: 0 };
    entry.sessions += 1;
    entry.messages += session.messages.length;
    shares.set(session.sourceTool, entry);
    totalSessions += 1;
    totalMessages += session.messages.length;
  }

  const shareList: SourceShare[] = [...shares.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, value]) => ({
      source,
      sessions: value.sessions,
      messages: value.messages,
      share: totalMessages === 0 ? 0 : Number((value.messages / totalMessages).toFixed(4)),
      completeness: input.completenessBySource?.[source]?.status ?? "complete",
      gaps: gapsOf(input.completenessBySource?.[source])
    }));

  const shareSum = shareList.reduce((sum, entry) => sum + entry.share, 0);

  return {
    projectId: input.projectId as SourceDistribution["projectId"],
    range: input.range,
    totalSessions,
    totalMessages,
    shares: shareList,
    roundingDifference: shareList.length > 1 && Math.abs(shareSum - 1) > 0.00001
  };
}

export function computeTeamDistribution(input: {
  readonly range: { readonly from: PlainDate; readonly to: PlainDate };
  readonly sessions: readonly ParsedSession[];
  readonly classifications: readonly ClassifiedSession[];
  readonly disabledSources?: readonly SourceTool[];
}): SourceDistribution {
  const disabled = new Set(input.disabledSources ?? []);
  const bySessionId = new Map(input.classifications.map((classification) => [classification.sessionId, classification]));
  const shares = new Map<SourceTool, { sessions: number; messages: number }>();
  let totalSessions = 0;
  let totalMessages = 0;

  for (const session of input.sessions) {
    if (disabled.has(session.sourceTool)) continue;
    const classification = bySessionId.get(session.sessionId);
    if (classification === undefined) continue;
    const entry = shares.get(session.sourceTool) ?? { sessions: 0, messages: 0 };
    entry.sessions += 1;
    entry.messages += session.messages.length;
    shares.set(session.sourceTool, entry);
    totalSessions += 1;
    totalMessages += session.messages.length;
  }

  const shareList: SourceShare[] = [...shares.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, value]) => ({
      source,
      sessions: value.sessions,
      messages: value.messages,
      share: totalMessages === 0 ? 0 : Number((value.messages / totalMessages).toFixed(4)),
      completeness: "complete",
      gaps: []
    }));

  return {
    projectId: "team",
    range: input.range,
    totalSessions,
    totalMessages,
    shares: shareList,
    roundingDifference: shareList.length > 1 && Math.abs(shareList.reduce((sum, entry) => sum + entry.share, 0) - 1) > 0.00001
  };
}