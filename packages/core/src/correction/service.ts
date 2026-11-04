import { createHash } from "node:crypto";
import { WorkWeaveError } from "../domain/errors.js";
import type { SourceTool } from "../domain/types.js";

export type CorrectionField = "project" | "category" | "test" | "adoption" | "research";
export type CorrectionScope = "once" | "future";

export interface CorrectionRequest {
  readonly actorId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly workDir?: string;
  readonly sourceTool?: SourceTool;
  readonly field: CorrectionField;
  readonly before: string;
  readonly value: string;
  readonly scope: CorrectionScope;
  readonly reason?: string;
  readonly at?: Date;
}

export interface CorrectionRecord {
  readonly id: string;
  readonly at: string;
  readonly actorId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly field: CorrectionField;
  readonly before: string;
  readonly after: string;
  readonly scope: CorrectionScope;
  readonly reason?: string;
}

export interface CorrectionRule {
  readonly id: string;
  readonly field: CorrectionField;
  readonly value: string;
  readonly workDirPrefix?: string;
  readonly sourceTool?: SourceTool;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface CorrectionSignal {
  readonly workDir?: string;
  readonly sourceTool?: SourceTool;
}

function idOf(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export class CorrectionService {
  private readonly history: CorrectionRecord[] = [];
  private readonly rules: CorrectionRule[] = [];

  correct(request: CorrectionRequest): { readonly record: CorrectionRecord; readonly rule?: CorrectionRule } {
    if (request.before === request.value) {
      throw new WorkWeaveError("E-FIX-002", "correction value equals current value");
    }

    const at = (request.at ?? new Date()).toISOString();
    const record: CorrectionRecord = {
      id: idOf(`${request.tenantId}:${request.sessionId}:${request.field}:${at}:${request.value}`),
      at,
      actorId: request.actorId,
      tenantId: request.tenantId,
      sessionId: request.sessionId,
      field: request.field,
      before: request.before,
      after: request.value,
      scope: request.scope,
      ...(request.reason !== undefined ? { reason: request.reason } : {})
    };
    this.history.push(record);

    if (request.scope === "once") {
      return { record };
    }

    const conflicting = this.rules.find(
      (rule) =>
        rule.field === request.field &&
        rule.workDirPrefix === request.workDir &&
        rule.sourceTool === request.sourceTool &&
        rule.value !== request.value
    );
    if (conflicting !== undefined) {
      throw new WorkWeaveError("E-FIX-002", "conflicting correction rule requires explicit priority");
    }

    const rule: CorrectionRule = {
      id: idOf(`${request.tenantId}:${request.field}:${request.workDir ?? "*"}:${request.sourceTool ?? "*"}:${request.value}`),
      field: request.field,
      value: request.value,
      ...(request.workDir !== undefined ? { workDirPrefix: request.workDir } : {}),
      ...(request.sourceTool !== undefined ? { sourceTool: request.sourceTool } : {}),
      createdBy: request.actorId,
      createdAt: at
    };
    this.rules.push(rule);
    return { record, rule };
  }

  matchRules(signal: CorrectionSignal): readonly CorrectionRule[] {
    return this.rules.filter((rule) => {
      if (rule.sourceTool !== undefined && rule.sourceTool !== signal.sourceTool) return false;
      if (rule.workDirPrefix !== undefined) {
        if (signal.workDir === undefined || !signal.workDir.startsWith(rule.workDirPrefix)) return false;
      }
      return true;
    });
  }

  historyFor(sessionId: string): readonly CorrectionRecord[] {
    return this.history.filter((record) => record.sessionId === sessionId);
  }

  allRules(): readonly CorrectionRule[] {
    return [...this.rules];
  }

  removeRule(ruleId: string): boolean {
    const index = this.rules.findIndex((rule) => rule.id === ruleId);
    if (index < 0) return false;
    this.rules.splice(index, 1);
    return true;
  }
}