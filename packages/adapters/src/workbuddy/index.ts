import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { analyzeIntegrity } from "@workweave/core";
import type { Message, ParsedSession, SourceAdapter } from "@workweave/core";
import { asInstant, asMessageId, asSessionId } from "@workweave/core";

interface WorkBuddyLine {
  readonly type?: string;
  readonly id?: string;
  readonly timestamp?: number | string;
  readonly role?: string;
  readonly content?: unknown;
  readonly cwd?: string;
  readonly sessionId?: string;
  readonly aiTitle?: string;
  readonly snapshot?: {
    readonly cwd?: string;
    readonly messageId?: string;
    readonly trackedFileBackups?: unknown;
  };
}

const KNOWN_LINE_TYPES = new Set(["message", "file-history-snapshot", "ai-title"]);
const IDENTITY_BLOCK = /(^|\n)\s*(#\s*)?(SOUL|USER|IDENTITY)\.md\b/i;

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.text === "string") parts.push(record.text);
  }
  return parts.join("\n");
}

function roleOf(value: unknown): Message["role"] | undefined {
  if (value === "user" || value === "assistant" || value === "system" || value === "tool") return value;
  if (value === "developer") return "developer";
  return undefined;
}

function normalizeTimestamp(value: unknown, fallback: string, anomalies: string[]): string {
  if (typeof value === "number") {
    if (value >= 1e12 && value < 1e13) return new Date(value).toISOString();
    anomalies.push(`timestamp out of millisecond range: ${value}`);
    return fallback;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  anomalies.push("timestamp missing or invalid");
  return fallback;
}

async function* walkJsonl(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonl(full);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      yield full;
    }
  }
}

export class WorkBuddyAdapter implements SourceAdapter {
  readonly source = "workbuddy" as const;

  async *scan(root: string): AsyncGenerator<string> {
    yield* walkJsonl(join(root, "projects"));
    yield* walkJsonl(join(root, "sessions"));
  }

  async parse(filePath: string): Promise<ParsedSession> {
    const raw = await readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const records: WorkBuddyLine[] = [];
    let unknownTypeCount = 0;

    for (const line of lines) {
      let record: WorkBuddyLine;
      try {
        record = JSON.parse(line) as WorkBuddyLine;
      } catch {
        unknownTypeCount += 1;
        continue;
      }
      if (record.type !== undefined && !KNOWN_LINE_TYPES.has(record.type)) {
        unknownTypeCount += 1;
      }
      records.push(record);
    }

    const titleRecord = records.find((record) => record.type === "ai-title");
    const sessionId = asSessionId(
      titleRecord?.sessionId ??
        basename(filePath).replace(/\.jsonl$/, "")
    );
    const messageRecords = records.filter((record) => record.type === "message");
    const cwd =
      messageRecords.find((record) => typeof record.cwd === "string")?.cwd ??
      titleRecord?.cwd ??
      records.find((record) => typeof record.snapshot?.cwd === "string")?.snapshot?.cwd;

    const anomalies: string[] = [];
    const messages: Message[] = [];
    let redactedBlockCount = 0;
    let fallbackTime = records.find((record) => record.type === "ai-title")?.timestamp;

    for (const record of messageRecords) {
      const text = textOfContent(record.content);
      if (IDENTITY_BLOCK.test(text)) {
        redactedBlockCount += 1;
        continue;
      }
      const previous = messages.at(-1)?.timestamp ?? new Date(0).toISOString();
      const timestamp = normalizeTimestamp(record.timestamp ?? fallbackTime, previous, anomalies);
      fallbackTime = timestamp;
      const role = roleOf(record.role);
      if (role === undefined) {
        unknownTypeCount += 1;
        continue;
      }
      messages.push({
        messageId: asMessageId(typeof record.id === "string" ? record.id : `${sessionId}-${messages.length}`),
        sessionId,
        sourceTool: "workbuddy",
        role,
        timestamp: asInstant(timestamp),
        text
      });
    }

    const startedAt = asInstant(
      messages[0]?.timestamp ?? normalizeTimestamp(fallbackTime, new Date(0).toISOString(), anomalies)
    );
    const endedAt = messages.at(-1)?.timestamp;

    const gaps = analyzeIntegrity({
      source: "workbuddy",
      rootExists: true,
      rootReadable: true,
      messageTimestamps: messages.map((message) => message.timestamp),
      emptyBodyMessageCount: messages.filter((message) => (message.text ?? "").length === 0).length,
      hasAnyReadableRecord: messages.length > 0
    }).gaps;

    return {
      sessionId,
      sourceTool: "workbuddy",
      startedAt,
      ...(endedAt !== undefined ? { endedAt } : {}),
      ...(cwd !== undefined ? { workDir: cwd } : {}),
      ...(titleRecord?.aiTitle !== undefined ? { title: titleRecord.aiTitle } : {}),
      messages,
      unknownTypeCount,
      gaps,
      sourceFile: filePath,
      redactedBlockCount
    };
  }

  async enumerableSessionIds(root: string): Promise<readonly string[]> {
    const ids: string[] = [];
    for await (const file of this.scan(root)) {
      ids.push(basename(file).replace(/\.jsonl$/, ""));
    }
    return ids;
  }
}