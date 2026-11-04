import type {
  ActivityCategory,
  Confidence,
  MessageRole,
  SessionId,
  SourceTool
} from "../domain/types.js";

export type RulePriority = "manual" | "manual-rule" | "configured-rule" | "structured-feature" | "default";

export const RULE_PRIORITY_RANK: Readonly<Record<RulePriority, number>> = {
  manual: 0,
  "manual-rule": 1,
  "configured-rule": 2,
  "structured-feature": 3,
  default: 4
};

export interface ClassificationRule {
  readonly id: string;
  readonly name: string;
  readonly priority: RulePriority;
  readonly workDirPrefix?: string;
  readonly titleContains?: string;
  readonly keyword?: string;
  readonly repoName?: string;
  readonly sourceTool?: SourceTool;
  readonly projectId?: string;
  readonly category?: ActivityCategory;
}

export interface ClassificationSignal {
  readonly sessionId: SessionId;
  readonly sourceTool: SourceTool;
  readonly workDir?: string;
  readonly title?: string;
  readonly filePaths?: readonly string[];
  readonly messages: readonly { readonly role: MessageRole; readonly text?: string }[];
}

export type ProjectRef = string | "cross-project" | "unassigned";

export interface ClassifiedSession {
  readonly sessionId: SessionId;
  readonly projectId: ProjectRef;
  readonly category: ActivityCategory;
  readonly pureConversationKind?:
    | "coordination"
    | "knowledge-qa"
    | "discussion"
    | "status-sync"
    | "chitchat"
    | "no-action";
  readonly secondaryCategories: readonly ActivityCategory[];
  readonly basis: RulePriority;
  readonly confidence: Confidence;
  readonly locked: boolean;
  readonly pending: boolean;
  readonly reasons: readonly string[];
}

export interface ManualOverride {
  readonly sessionId: SessionId;
  readonly projectId?: string;
  readonly category?: ActivityCategory;
}

export interface ClassifyConfig {
  readonly rules?: readonly ClassificationRule[];
  readonly manualOverrides?: readonly ManualOverride[];
  readonly threshold?: number;
}

export interface ConsistencyReport {
  readonly totalSessions: number;
  readonly projectCounts: Readonly<Record<string, number>>;
  readonly categoryCounts: Readonly<Record<string, number>>;
  readonly projectSum: number;
  readonly categorySum: number;
  readonly consistent: boolean;
  readonly conflicts: readonly string[];
}