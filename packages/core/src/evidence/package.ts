import { createHash } from "node:crypto";
import type { ClassifiedSession } from "../classify/types.js";
import type {
  AdoptionDecision,
  SubmissionLike
} from "../adoption/engine.js";
import type { ResearchFinding } from "../adoption/research.js";
import type { ParsedSession } from "../ingest/types.js";
import type { CompletenessDeclaration, EvidenceRef, TestFact } from "../domain/models.js";
import type { PlainDate, SourceTool } from "../domain/types.js";
import { WorkWeaveError } from "../domain/errors.js";
import { isNoiseText } from "../facts/noise.js";
import { redact, totalHits } from "../infra/sanitizer/index.js";

export type EvidenceCategoryKey =
  | "sessions"
  | "messages"
  | "projects"
  | "activities"
  | "tests"
  | "submissions"
  | "adoption"
  | "research"
  | "pending";

export interface EvidenceItem {
  readonly id: string;
  readonly kind: EvidenceCategoryKey;
  readonly ref?: EvidenceRef;
  readonly text?: string;
  readonly meta?: Readonly<Record<string, string | number | boolean>>;
}

export interface EvidenceCategory {
  readonly key: EvidenceCategoryKey;
  readonly present: boolean;
  readonly reason?: string;
  readonly items: readonly EvidenceItem[];
}

export interface EvidencePackageMeta {
  readonly entryCount: number;
  readonly serializedBytes: number;
  readonly trimmed: boolean;
  readonly removedCount: number;
  readonly redactionHits: number;
  readonly excludedBlockCount: number;
}

export interface StructuredEvidencePackage {
  readonly packageId: string;
  readonly dataVersion: string;
  readonly range: { readonly from: PlainDate; readonly to: PlainDate };
  readonly sources: readonly SourceTool[];
  readonly completeness: CompletenessDeclaration;
  readonly categories: readonly EvidenceCategory[];
  readonly meta: EvidencePackageMeta;
  readonly trimmed: boolean;
}

export interface EvidencePackageInput {
  readonly dataVersion: string;
  readonly range: { readonly from: PlainDate; readonly to: PlainDate };
  readonly scopeKey?: string;
  readonly sessions: readonly ParsedSession[];
  readonly classifications: readonly ClassifiedSession[];
  readonly tests: readonly TestFact[];
  readonly submissions: readonly SubmissionLike[];
  readonly adoption: readonly AdoptionDecision[];
  readonly research: readonly ResearchFinding[];
  readonly pending: readonly string[];
  readonly completeness: CompletenessDeclaration;
  readonly excludedBlockCount?: number;
  readonly maxEntries?: number;
  readonly maxBytes?: number;
}

export const DEFAULT_MAX_ENTRIES = 2000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
export const TRIM_PRIORITY: readonly EvidenceCategoryKey[] = [
  "pending",
  "tests",
  "submissions",
  "adoption",
  "research",
  "messages",
  "sessions",
  "projects",
  "activities"
];

function clip(text: string, limit = 200): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function redacted(surface: string): { text: string; hits: number } {
  const result = redact(surface, "evidence");
  return { text: clip(result.text), hits: totalHits(result) };
}

function category(
  key: EvidenceCategoryKey,
  items: readonly EvidenceItem[],
  reason: string
): EvidenceCategory {
  return items.length === 0
    ? { key, present: false, reason, items: [] }
    : { key, present: true, items };
}

function packageIdOf(input: EvidencePackageInput): string {
  const hash = createHash("sha256");
  hash.update(input.dataVersion);
  hash.update(`|${input.range.from}|${input.range.to}`);
  hash.update(`|${input.scopeKey ?? "default"}`);
  hash.update(`|${[...new Set(input.sessions.map((session) => session.sourceTool))].sort().join(",")}`);
  return hash.digest("hex").slice(0, 24);
}

export function buildEvidencePackage(input: EvidencePackageInput): StructuredEvidencePackage {
  let hits = 0;
  const sessions = input.sessions.map<EvidenceItem>((session) => ({
    id: `session:${session.sourceTool}:${session.sessionId}`,
    kind: "sessions",
    meta: {
      source: session.sourceTool,
      startedAt: session.startedAt,
      messages: session.messages.length,
      ...(session.workDir !== undefined ? { workDir: session.workDir } : {})
    }
  }));

  const messages = input.sessions.flatMap<EvidenceItem>((session) =>
    session.messages
      .filter((message) => (message.text ?? "").length > 0 && !isNoiseText(message.text))
      .map((message) => {
        const safe = redacted(message.text ?? "");
        hits += safe.hits;
        return {
          id: `message:${session.sourceTool}:${message.messageId}`,
          kind: "messages" as const,
          ref: {
            evidenceId: `message:${session.sourceTool}:${message.messageId}`,
            sessionId: session.sessionId,
            messageId: message.messageId,
            sourceTool: session.sourceTool,
            timestamp: message.timestamp,
            snippet: safe.text,
            redacted: safe.hits > 0
          }
        };
      })
  );

  const projects = input.classifications.map<EvidenceItem>((classification) => ({
    id: `project:${classification.sessionId}`,
    kind: "projects",
    meta: { projectId: classification.projectId, sessionId: classification.sessionId }
  }));

  const activities = input.classifications.map<EvidenceItem>((classification) => ({
    id: `activity:${classification.sessionId}`,
    kind: "activities",
    meta: { category: classification.category, confidence: classification.confidence, basis: classification.basis }
  }));

  const tests = input.tests.map<EvidenceItem>((test) => ({
    id: `test:${test.sessionId}:${test.command}`,
    kind: "tests",
    meta: {
      status: test.status,
      type: test.type,
      command: test.command,
      ...(test.failureReason !== undefined ? { failureReason: test.failureReason } : {})
    }
  }));

  const submissions = input.submissions.map<EvidenceItem>((submission) => ({
    id: `submission:${submission.dedupKey}`,
    kind: "submissions",
    meta: {
      kind: submission.kind,
      dedupKey: submission.dedupKey,
      ...(submission.timestamp !== undefined ? { timestamp: submission.timestamp } : {})
    }
  }));

  const adoption = input.adoption.map<EvidenceItem>((decision) => ({
    id: `adoption:${decision.interactionId}`,
    kind: "adoption",
    meta: {
      status: decision.status,
      observationPending: decision.observationPending,
      reworkCount: decision.reworkCount
    }
  }));

  const research = input.research.map<EvidenceItem>((finding, index) => ({
    id: `research:${finding.sessionId}:${index}`,
    kind: "research",
    meta: {
      topic: finding.topic,
      conclusion: finding.conclusion,
      ...(finding.reason !== undefined ? { reason: finding.reason } : {})
    }
  }));

  const pending = input.pending.map<EvidenceItem>((item, index) => ({
    id: `pending:${index}`,
    kind: "pending",
    meta: { reason: item }
  }));

  const categories: readonly EvidenceCategory[] = [
    category("sessions", sessions, "range has no sessions"),
    category("messages", messages, "range has no readable message snippets"),
    category("projects", projects, "range has no project classifications"),
    category("activities", activities, "range has no activity classifications"),
    category("tests", tests, "range has no test results"),
    category("submissions", submissions, "range has no submission facts"),
    category("adoption", adoption, "range has no AI interactions"),
    category("research", research, "range has no research records"),
    category("pending", pending, "range has no pending items")
  ];

  const trimmedResult = trimCategories(categories, input.maxEntries ?? DEFAULT_MAX_ENTRIES, input.maxBytes ?? DEFAULT_MAX_BYTES);

  return {
    packageId: packageIdOf(input),
    dataVersion: input.dataVersion,
    range: input.range,
    sources: [...new Set(input.sessions.map((session) => session.sourceTool))],
    completeness: input.completeness,
    categories: trimmedResult.categories,
    meta: {
      entryCount: trimmedResult.entryCount,
      serializedBytes: trimmedResult.bytes,
      trimmed: trimmedResult.trimmed,
      removedCount: trimmedResult.removed,
      redactionHits: hits,
      excludedBlockCount: input.excludedBlockCount ?? 0
    },
    trimmed: trimmedResult.trimmed
  };
}

function trimCategories(
  categories: readonly EvidenceCategory[],
  maxEntries: number,
  maxBytes: number
): { categories: readonly EvidenceCategory[]; entryCount: number; bytes: number; trimmed: boolean; removed: number } {
  const byKey = new Map(categories.map((entry) => [entry.key, [...entry.items]]));
  const itemBytes = new Map<string, number>();
  for (const entry of categories) {
    for (const item of entry.items) {
      itemBytes.set(item.id, Buffer.byteLength(JSON.stringify(item), "utf8") + 1);
    }
  }

  let entryCount = categories.reduce((sum, entry) => sum + entry.items.length, 0);
  let bytes = Buffer.byteLength(JSON.stringify(categories), "utf8");
  let removed = 0;

  if (entryCount > maxEntries || bytes > maxBytes) {
    for (const key of TRIM_PRIORITY) {
      while (entryCount > maxEntries || bytes > maxBytes) {
        const items = byKey.get(key);
        if (items === undefined || items.length === 0) break;
        const removedItem = items.pop();
        entryCount -= 1;
        removed += 1;
        if (removedItem !== undefined) {
          bytes -= itemBytes.get(removedItem.id) ?? Buffer.byteLength(JSON.stringify(removedItem), "utf8") + 1;
        }
      }
      if (entryCount <= maxEntries && bytes <= maxBytes) break;
    }
  }

  const result = categories.map((entry) => {
    const items = byKey.get(entry.key) ?? [];
    return items.length === 0
      ? { key: entry.key, present: false, reason: entry.reason ?? "trimmed to empty", items: [] }
      : { key: entry.key, present: true, items };
  });

  return {
    categories: result,
    entryCount,
    bytes: Buffer.byteLength(JSON.stringify(result), "utf8"),
    trimmed: removed > 0,
    removed
  };
}

export function resolveEvidence(pkg: StructuredEvidencePackage, evidenceId: string): EvidenceItem {
  for (const categoryEntry of pkg.categories) {
    const item = categoryEntry.items.find((candidate) => candidate.id === evidenceId);
    if (item !== undefined) return item;
  }
  throw new WorkWeaveError("E-PKG-002", `evidence reference not found: ${evidenceId}`);
}