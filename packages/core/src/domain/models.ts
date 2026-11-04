import type {
  ActivityCategory,
  AdoptionStatus,
  CandidateHitState,
  CandidateValidationState,
  CompletenessGapType,
  CompletenessStatus,
  Confidence,
  DataVersion,
  Instant,
  MessageId,
  MessageRole,
  PackageId,
  PlainDate,
  Platform,
  ProbeLayer,
  ProbeStatus,
  ProjectId,
  ResearchConclusionStatus,
  SessionId,
  SourceTool,
  TestStatus
} from "./types.js";

export interface Message {
  readonly messageId: MessageId;
  readonly sessionId: SessionId;
  readonly sourceTool: SourceTool;
  readonly role: MessageRole;
  readonly timestamp: Instant;
  readonly ordinal?: number;
  readonly text?: string;
}

export interface Session {
  readonly sessionId: SessionId;
  readonly sourceTool: SourceTool;
  readonly startedAt: Instant;
  readonly endedAt?: Instant;
  readonly workDir?: string;
  readonly title?: string;
  readonly messages: readonly Message[];
}

export interface Classification {
  readonly sessionId: SessionId;
  readonly projectId: ProjectId | "cross-project" | "unassigned";
  readonly category: ActivityCategory;
  readonly secondaryCategories: readonly ActivityCategory[];
  readonly basis: "manual" | "manual-rule" | "configured-rule" | "structured-feature" | "default";
  readonly confidence: Confidence;
  readonly locked: boolean;
  readonly pending: boolean;
}

export interface TestFact {
  readonly sessionId: SessionId;
  readonly projectId: ProjectId;
  readonly type: string;
  readonly command: string;
  readonly environment?: string;
  readonly status: TestStatus;
  readonly failureReason?: string;
  readonly evidenceIds: readonly string[];
}

export interface SubmissionFact {
  readonly dedupKey: string;
  readonly sessionId: SessionId;
  readonly kind: "commit" | "revert" | "file-change";
  readonly evidenceIds: readonly string[];
}

export interface AdoptionFact {
  readonly interactionId: string;
  readonly sessionId: SessionId;
  readonly questionMessageIds: readonly MessageId[];
  readonly answerMessageIds: readonly MessageId[];
  readonly status: AdoptionStatus;
  readonly confidence: Confidence;
  readonly observationWindow: { readonly from: Instant; readonly to: Instant };
  readonly submissionKeys: readonly string[];
  readonly reworkCount: number;
}

export interface ResearchFact {
  readonly researchId: string;
  readonly sessionId: SessionId;
  readonly projectId: ProjectId;
  readonly topic: string;
  readonly question: string;
  readonly method: "literature" | "comparison" | "validation" | "search" | "other";
  readonly findings: readonly { readonly text: string; readonly evidenceIds: readonly string[] }[];
  readonly conclusion: ResearchConclusionStatus;
  readonly reason?: string;
  readonly day: PlainDate;
  readonly crossDay: boolean;
}

export interface EvidenceRef {
  readonly evidenceId: string;
  readonly sessionId: SessionId;
  readonly messageId?: MessageId;
  readonly sourceTool: SourceTool;
  readonly timestamp: Instant;
  readonly snippet?: string;
  readonly redacted: boolean;
}

export interface ProbeCandidate {
  readonly source: SourceTool;
  readonly layer: ProbeLayer;
  readonly path: string;
  readonly platform?: Platform;
  readonly rank: number;
  readonly validation: CandidateValidationState;
  readonly hit: CandidateHitState;
  readonly detail?: string;
}

export interface EnvCandidateState {
  readonly variable: string;
  readonly state: "set" | "unset" | "empty" | "relative" | "placeholder" | "file" | "missing" | "ok";
  readonly detail?: string;
}

export interface CompletenessGap {
  readonly type: CompletenessGapType;
  readonly source: SourceTool;
  readonly scope: string;
  readonly affectedCount?: number;
  readonly basis: string;
}

export interface CompletenessDeclaration {
  readonly status: CompletenessStatus;
  readonly gaps: readonly CompletenessGap[];
  readonly undetermined: boolean;
}

export interface ProbeSourceResult {
  readonly source: SourceTool;
  readonly status: ProbeStatus;
  readonly adoptedPath?: string;
  readonly candidates: readonly ProbeCandidate[];
  readonly env: EnvCandidateState;
  readonly completeness: CompletenessDeclaration;
  readonly warnings: readonly string[];
  readonly probedAt: Instant;
  readonly fromCache: boolean;
  readonly degradedReason?: string;
}

export interface SourceShare {
  readonly source: SourceTool;
  readonly sessions: number;
  readonly messages: number;
  readonly share: number;
  readonly completeness: CompletenessStatus;
  readonly gaps: readonly CompletenessGapType[];
}

export interface SourceDistribution {
  readonly projectId: ProjectId | "cross-project" | "unassigned" | "team";
  readonly range: { readonly from: PlainDate; readonly to: PlainDate };
  readonly totalSessions: number;
  readonly totalMessages: number;
  readonly shares: readonly SourceShare[];
  readonly roundingDifference: boolean;
}

export interface ReportMetadata {
  readonly reportType: "daily" | "weekly";
  readonly range: { readonly from: PlainDate; readonly to: PlainDate };
  readonly dataVersion: DataVersion;
  readonly completeness: CompletenessDeclaration;
  readonly generatedAt: Instant;
}

export interface EvidencePackage {
  readonly packageId: PackageId;
  readonly dataVersion: DataVersion;
  readonly range: { readonly from: PlainDate; readonly to: PlainDate };
  readonly sources: readonly SourceTool[];
  readonly completeness: CompletenessDeclaration;
  readonly evidence: readonly EvidenceRef[];
  readonly trimmed: boolean;
  readonly serializedBytes: number;
}