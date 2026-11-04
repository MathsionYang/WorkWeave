import type { ClassifiedSession } from "../classify/types.js";
import type {
  CompletenessDeclaration,
  EvidenceRef,
  SourceDistribution,
  TestFact
} from "../domain/models.js";
import type { SubmissionLike } from "../adoption/engine.js";
import type { AdoptionStats } from "../adoption/engine.js";
import type { ResearchFinding } from "../adoption/research.js";
import type { ParsedSession } from "../ingest/types.js";
import type { PlainDate, SourceTool } from "../domain/types.js";

export interface OverviewMetrics {
  readonly sessions: number;
  readonly projects: number;
  readonly tests: number;
  readonly failures: number;
  readonly optimizations: number;
  readonly aiAnswers: number;
  readonly confirmed: number;
  readonly inferred: number;
  readonly notAdopted: number;
  readonly undeterminable: number;
  readonly adoptionRate: number | null;
  readonly commits: number;
  readonly researchItems: number;
}

export interface ProjectReportSection {
  readonly projectId: string;
  readonly distribution: SourceDistribution;
  readonly completions: readonly string[];
  readonly problems: readonly string[];
  readonly tests: readonly TestFact[];
  readonly optimizations: readonly string[];
}

export interface PureConversationSummary {
  readonly kind: string;
  readonly sessions: number;
  readonly sources: readonly { readonly source: SourceTool; readonly sessions: number }[];
}

export interface ReportCompleteness {
  readonly status: "complete" | "possibly-incomplete";
  readonly declarations: readonly CompletenessDeclaration[];
  readonly disabledSources: readonly SourceTool[];
}

export interface FactReport {
  readonly reportType: "daily" | "weekly";
  readonly range: { readonly from: PlainDate; readonly to: PlainDate };
  readonly dataVersion: string;
  readonly generatedAt: string;
  readonly overview: OverviewMetrics;
  readonly adoption: AdoptionStats;
  readonly research: readonly ResearchFinding[];
  readonly projects: readonly ProjectReportSection[];
  readonly crossProject: readonly string[];
  readonly pureConversation: readonly PureConversationSummary[];
  readonly pending: readonly string[];
  readonly evidenceIndex: readonly EvidenceRef[];
  readonly completeness: ReportCompleteness;
}

export interface BuildFactReportInput {
  readonly day: PlainDate;
  readonly range?: { readonly from: PlainDate; readonly to: PlainDate };
  readonly dataVersion: string;
  readonly sessions: readonly ParsedSession[];
  readonly classifications: readonly ClassifiedSession[];
  readonly tests: readonly TestFact[];
  readonly submissions: readonly SubmissionLike[];
  readonly adoption: AdoptionStats;
  readonly research: readonly ResearchFinding[];
  readonly completenessBySource?: Readonly<Partial<Record<SourceTool, CompletenessDeclaration>>>;
  readonly disabledSources?: readonly SourceTool[];
  readonly now?: Date;
}