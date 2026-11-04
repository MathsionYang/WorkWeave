import { createHash } from "node:crypto";

export type AuditAction =
  | "login"
  | "tool-call"
  | "view-raw"
  | "export"
  | "permission-change"
  | "policy-change";

export interface AuditEventInput {
  readonly actorId: string;
  readonly tenantId: string;
  readonly action: AuditAction;
  readonly resource: string;
  readonly detail?: string;
  readonly at?: Date;
}

export interface AuditEvent {
  readonly seq: number;
  readonly at: string;
  readonly actorId: string;
  readonly tenantId: string;
  readonly action: AuditAction;
  readonly resource: string;
  readonly detail?: string;
  readonly prevHash: string;
  readonly hash: string;
}

export interface AuditVerification {
  readonly ok: boolean;
  readonly brokenAt?: number;
}

const GENESIS = "GENESIS";
const MIN_RETENTION_DAYS = 180;

function hashOf(event: Omit<AuditEvent, "hash">): string {
  return createHash("sha256")
    .update(
      [
        event.prevHash,
        String(event.seq),
        event.at,
        event.actorId,
        event.tenantId,
        event.action,
        event.resource,
        event.detail ?? ""
      ].join("|")
    )
    .digest("hex");
}

export class AuditLog {
  private events: AuditEvent[] = [];

  append(input: AuditEventInput): AuditEvent {
    const seq = this.events.length;
    const prevHash = seq === 0 ? GENESIS : (this.events[seq - 1]?.hash ?? GENESIS);
    const base = {
      seq,
      at: (input.at ?? new Date()).toISOString(),
      actorId: input.actorId,
      tenantId: input.tenantId,
      action: input.action,
      resource: input.resource,
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
      prevHash
    };
    const event: AuditEvent = { ...base, hash: hashOf(base) };
    this.events.push(event);
    return event;
  }

  verify(): AuditVerification {
    let previous = GENESIS;
    for (const event of this.events) {
      const { hash: _hash, ...base } = event;
      if (event.prevHash !== previous || hashOf(base) !== event.hash) {
        return { ok: false, brokenAt: event.seq };
      }
      previous = event.hash;
    }
    return { ok: true };
  }

  retain(days: number = MIN_RETENTION_DAYS, now: Date = new Date()): number {
    if (days < MIN_RETENTION_DAYS) {
      throw new RangeError(`audit retention must be at least ${MIN_RETENTION_DAYS} days`);
    }
    const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
    const before = this.events.length;
    this.events = this.events.filter((event) => Date.parse(event.at) >= cutoff);
    return before - this.events.length;
  }

  snapshot(): readonly AuditEvent[] {
    return [...this.events];
  }
}