import type { ParsedSession } from "../ingest/types.js";
import type { CompletenessDeclaration, CompletenessGap, EvidenceRef } from "../domain/models.js";
import { asInstant, type PlainDate, type SourceTool } from "../domain/types.js";
import { computeProjectDistribution } from "./distribution.js";
import { extractReportInsights, type ReportInsights } from "./insights.js";
import type {
  BuildFactReportInput,
  FactReport,
  OverviewMetrics,
  ProjectReportSection,
  PureConversationSummary,
  ReportCompleteness
} from "./types.js";

function declarationsOf(input: BuildFactReportInput): readonly CompletenessDeclaration[] {
  return Object.values(input.completenessBySource ?? {}).filter(
    (declaration): declaration is CompletenessDeclaration => declaration !== undefined
  );
}

function buildCompleteness(input: BuildFactReportInput): ReportCompleteness {
  const declarations = declarationsOf(input);
  const disabledSources = input.disabledSources ?? [];
  const incomplete =
    declarations.some((declaration) => declaration.status === "possibly-incomplete") ||
    disabledSources.length > 0;
  return {
    status: incomplete ? "possibly-incomplete" : "complete",
    declarations,
    disabledSources
  };
}

function buildOverview(input: BuildFactReportInput, insights: ReportInsights): OverviewMetrics {
  const projectIds = new Set(
    input.classifications
      .filter(
        (classification) =>
          classification.projectId !== "cross-project" &&
          classification.projectId !== "unassigned" &&
          classification.category !== "pure-conversation"
      )
      .map((classification) => classification.projectId)
  );
  return {
    sessions: input.sessions.length,
    projects: projectIds.size,
    tests: input.tests.length,
    failures: input.tests.filter((test) => test.status === "failed").length,
    optimizations: [...insights.projects.values()].reduce(
      (sum, project) => sum + project.optimizations.length,
      0
    ),
    aiAnswers: input.adoption.total,
    confirmed: input.adoption.confirmed,
    inferred: input.adoption.inferred,
    notAdopted: input.adoption.notAdopted,
    undeterminable: input.adoption.undeterminable,
    adoptionRate: input.adoption.rate,
    commits: input.adoption.commitCount,
    researchItems: input.research.length
  };
}

function buildProjects(
  input: BuildFactReportInput,
  range: { readonly from: PlainDate; readonly to: PlainDate },
  insights: ReportInsights
): readonly ProjectReportSection[] {
  const projectIds = new Set(
    input.classifications
      .map((classification) => classification.projectId)
      .filter((projectId): projectId is string => projectId !== "cross-project" && projectId !== "unassigned")
  );

  return [...projectIds].sort().map((projectId) => {
    const insight = insights.projects.get(projectId);
    const projectTests = input.tests.filter((test) => {
      const classification = input.classifications.find((item) => item.sessionId === test.sessionId);
      return (classification?.projectId ?? test.projectId) === projectId;
    });
    return {
      projectId,
      distribution: computeProjectDistribution({
        projectId,
        range,
        sessions: input.sessions,
        classifications: input.classifications,
        ...(input.completenessBySource !== undefined ? { completenessBySource: input.completenessBySource } : {}),
        ...(input.disabledSources !== undefined ? { disabledSources: input.disabledSources } : {})
      }),
      tasks: insight?.tasks ?? [],
      completions: insight?.completions ?? [],
      problems: insight?.problems ?? [],
      tests: projectTests,
      optimizations: insight?.optimizations ?? [],
      risks: insight?.risks ?? [],
      blockers: insight?.blockers ?? [],
      nextSteps: insight?.nextSteps ?? []
    };
  });
}

function buildPureConversation(input: BuildFactReportInput): readonly PureConversationSummary[] {
  const counts = new Map<string, number>();
  for (const classification of input.classifications) {
    if (classification.category !== "pure-conversation") continue;
    const kind = classification.pureConversationKind ?? "no-action";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  const sourceBySession = new Map(input.sessions.map((session) => [session.sessionId, session.sourceTool]));
  return [...counts.entries()].map(([kind, sessions]) => {
    const sources = new Map<SourceTool, number>();
    for (const classification of input.classifications) {
      if (classification.category !== "pure-conversation") continue;
      if ((classification.pureConversationKind ?? "no-action") !== kind) continue;
      const source = sourceBySession.get(classification.sessionId);
      if (source === undefined) continue;
      sources.set(source, (sources.get(source) ?? 0) + 1);
    }
    return {
      kind,
      sessions,
      sources: [...sources.entries()].map(([source, count]) => ({ source, sessions: count }))
    };
  });
}

function buildEvidenceIndex(input: BuildFactReportInput): readonly EvidenceRef[] {
  const sessionBySessionId = new Map(input.sessions.map((session) => [session.sessionId, session]));
  const refs: EvidenceRef[] = [];
  for (const test of input.tests) {
    const session = sessionBySessionId.get(test.sessionId);
    const sourceTool = session?.sourceTool ?? "codex";
    const timestamp = asInstant(session?.startedAt ?? "1970-01-01T00:00:00.000Z");
    for (const evidenceId of test.evidenceIds) {
      refs.push({ evidenceId, sessionId: test.sessionId, sourceTool, timestamp, redacted: false });
    }
  }
  return refs;
}

function buildPending(input: BuildFactReportInput): readonly string[] {
  const gaps: CompletenessGap[] = declarationsOf(input).flatMap((declaration) => [...declaration.gaps]);
  return gaps.map((gap) => `${gap.source}:${gap.type}:${gap.scope}`);
}

export function buildFactReport(input: BuildFactReportInput): FactReport {
  const range = input.range ?? { from: input.day, to: input.day };
  const insights = extractReportInsights({
    sessions: input.sessions,
    classifications: input.classifications,
    tests: input.tests,
    submissions: input.submissions,
    research: input.research
  });

  return {
    reportType: "daily",
    range,
    dataVersion: input.dataVersion,
    generatedAt: (input.now ?? new Date()).toISOString(),
    summary: insights.summary,
    nextSteps: insights.nextSteps,
    overview: buildOverview(input, insights),
    adoption: input.adoption,
    research: input.research,
    projects: buildProjects(input, range, insights),
    crossProject: input.classifications
      .filter(
        (classification) =>
          classification.projectId === "cross-project" || classification.projectId === "unassigned"
      )
      .map((classification) => classification.sessionId),
    pureConversation: buildPureConversation(input),
    pending: buildPending(input),
    evidenceIndex: buildEvidenceIndex(input),
    completeness: buildCompleteness(input)
  };
}

export function sourcesOf(sessions: readonly ParsedSession[]): readonly SourceTool[] {
  return [...new Set(sessions.map((session) => session.sourceTool))];
}