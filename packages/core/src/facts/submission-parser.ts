import { createHash } from "node:crypto";
import type { SubmissionFact } from "../domain/models.js";
import type { SessionId } from "../domain/types.js";

export interface SubmissionParseInput {
  readonly sessionId: SessionId;
  readonly command: string;
  readonly output: string;
  readonly evidenceIds?: readonly string[];
}

const COMMIT_SHA = /\b[0-9a-f]{7,40}\b/i;

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function dedupKey(kind: string, sha: string | undefined, fallback: string): string {
  return `${kind}:${sha ?? fingerprint(fallback)}`;
}

export function parseSubmissionFacts(input: SubmissionParseInput): readonly SubmissionFact[] {
  const text = `${input.command}\n${input.output}`;
  const evidenceIds = input.evidenceIds ?? [];
  const facts: SubmissionFact[] = [];
  const seen = new Set<string>();

  const add = (kind: SubmissionFact["kind"], key: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    facts.push({ dedupKey: key, sessionId: input.sessionId, kind, evidenceIds });
  };

  if (/git\s+commit|commit\s+[0-9a-f]{7,40}|\[[^\]]+\s+([0-9a-f]{7,40})\]/i.test(text)) {
    const sha = text.match(COMMIT_SHA)?.[0];
    add("commit", dedupKey("commit", sha, input.command));
  }

  if (/git\s+revert|revert\s+[0-9a-f]{7,40}|\[[^\]]+\s+revert/i.test(text)) {
    const sha = text.match(COMMIT_SHA)?.[0];
    add("revert", dedupKey("revert", sha, input.command));
  }

  if (/^[ \t]*(M|A|D|R)\s+\S+/m.test(input.output) || /file[ -]change|modified:|deleted:/i.test(text)) {
    add("file-change", dedupKey("file-change", undefined, text));
  }

  return facts;
}