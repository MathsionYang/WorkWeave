import type { ActivityCategory, CompletenessStatus, PlainDate, SourceTool } from "../domain/types.js";

export type Role = "member" | "lead" | "admin" | "auditor" | "plugin-admin";

export type AuthzAction = "view-own" | "view-team" | "view-raw" | "export" | "manage" | "audit";

export interface Principal {
  readonly memberId: string;
  readonly tenantId: string;
  readonly roles: readonly Role[];
  readonly visibleProjectIds?: readonly string[];
}

export interface AuthzResource {
  readonly tenantId: string;
  readonly memberId?: string;
  readonly projectId?: string;
}

export interface TeamSessionSignal {
  readonly sessionId: string;
  readonly sourceTool: SourceTool;
  readonly memberId: string;
  readonly projectId: string | "cross-project" | "unassigned";
  readonly category: ActivityCategory;
  readonly messages: number;
}

export interface TeamShare {
  readonly source: SourceTool;
  readonly sessions: number;
  readonly messages: number;
  readonly share: number;
}

export interface TeamProjectRecord {
  readonly projectId: string;
  readonly sessions: number;
  readonly messages: number;
  readonly shares: readonly TeamShare[];
}

export type TeamGroupKey = "project-work" | "cross-and-unassigned" | "pure-conversation";

export interface TeamGroupSummary {
  readonly group: TeamGroupKey;
  readonly sessions: number;
  readonly messages: number;
  readonly shares: readonly TeamShare[];
}

export interface TeamCompleteness {
  readonly status: CompletenessStatus;
  readonly disabledSources: readonly SourceTool[];
  readonly gaps: readonly string[];
}

export interface TeamAggregateInput {
  readonly range: { readonly from: PlainDate; readonly to: PlainDate };
  readonly sessions: readonly TeamSessionSignal[];
  readonly disabledSources?: readonly SourceTool[];
  readonly completenessBySource?: Readonly<Partial<Record<SourceTool, { readonly status: CompletenessStatus; readonly gaps: readonly string[] }>>>;
}

export interface TeamAggregate {
  readonly range: { readonly from: PlainDate; readonly to: PlainDate };
  readonly projects: readonly TeamProjectRecord[];
  readonly groups: readonly TeamGroupSummary[];
  readonly teamShares: readonly TeamShare[];
  readonly totalSessions: number;
  readonly totalMessages: number;
  readonly completeness: TeamCompleteness;
  readonly consistent: boolean;
}