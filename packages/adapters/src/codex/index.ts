import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { zstdDecompress } from "node:zlib";
import { analyzeIntegrity } from "@workweave/core";
import type { Message, ParsedSession, SourceAdapter } from "@workweave/core";
import { asInstant, asMessageId, asSessionId } from "@workweave/core";

const decompress = promisify(zstdDecompress);

interface CodexLine {
  readonly timestamp?: string;
  readonly ordinal?: number;
  readonly type?: string;
  readonly payload?: Record<string, unknown>;
}

const KNOWN_LINE_TYPES = new Set(["session_meta", "event_msg", "response_item"]);

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
  if (value === "user" || value === "assistant" || value === "system" || value === "tool" || value === "developer") {
    return value;
  }
  return undefined;
}

async function readText(filePath: string): Promise<string> {
  if (filePath.endsWith(".zst")) {
    return (await decompress(await readFile(filePath))).toString("utf8");
  }
  return readFile(filePath, "utf8");
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
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
      yield* walkFiles(full);
    } else if (entry.isFile() && /\.jsonl(\.zst)?$/.test(entry.name)) {
      yield full;
    }
  }
}

export class CodexAdapter implements SourceAdapter {
  readonly source = "codex" as const;

  async *scan(root: string): AsyncGenerator<string> {
    for (const sub of ["sessions", "archived_sessions"]) {
      yield* walkFiles(join(root, sub));
    }
  }

  async parse(filePath: string): Promise<ParsedSession> {
    const text = await readText(filePath);
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const parsedLines: CodexLine[] = [];
    let unknownTypeCount = 0;

    for (const line of lines) {
      let record: CodexLine;
      try {
        record = JSON.parse(line) as CodexLine;
      } catch {
        unknownTypeCount += 1;
        continue;
      }
      if (record.type !== undefined && !KNOWN_LINE_TYPES.has(record.type)) {
        unknownTypeCount += 1;
      }
      parsedLines.push(record);
    }

    const meta = parsedLines.find((line) => line.type === "session_meta");
    const payload = meta?.payload ?? ({} as Record<string, unknown>);
    const sessionId = asSessionId(
      typeof payload.session_id === "string"
        ? payload.session_id
        : (filePath.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? "unknown")
    );
    const workDir = typeof payload.cwd === "string" ? payload.cwd : undefined;
    const title = typeof payload.thread_name === "string" ? payload.thread_name : undefined;
    const messages: Message[] = [];
    const ordinals: number[] = [];

    for (const line of parsedLines) {
      if (line.type !== "response_item") continue;
      const item = line.payload ?? {};
      if (item.type !== "message") continue;
      const role = roleOf(item.role);
      if (role === undefined) continue;
      const timestamp = asInstant(line.timestamp ?? meta?.timestamp ?? new Date(0).toISOString());
      const ordinal = typeof line.ordinal === "number" ? line.ordinal : undefined;
      if (ordinal !== undefined) ordinals.push(ordinal);
      messages.push({
        messageId: asMessageId(
          typeof item.id === "string" ? item.id : `${sessionId}-${ordinal ?? messages.length}`
        ),
        sessionId,
        sourceTool: "codex",
        role,
        timestamp,
        ...(ordinal !== undefined ? { ordinal } : {}),
        text: textOfContent(item.content)
      });
    }

    const startedAt = asInstant(meta?.timestamp ?? messages[0]?.timestamp ?? new Date(0).toISOString());
    const endedAt = messages.at(-1)?.timestamp;

    const gaps = analyzeIntegrity({
      source: "codex",
      rootExists: true,
      rootReadable: true,
      messageOrdinals: ordinals,
      messageTimestamps: messages.map((message) => message.timestamp),
      hasAnyReadableRecord: messages.length > 0
    }).gaps;

    return {
      sessionId,
      sourceTool: "codex",
      startedAt,
      ...(endedAt !== undefined ? { endedAt } : {}),
      ...(workDir !== undefined ? { workDir } : {}),
      ...(title !== undefined ? { title } : {}),
      messages,
      unknownTypeCount,
      gaps,
      sourceFile: filePath
    };
  }

  async enumerableSessionIds(root: string): Promise<readonly string[]> {
    try {
      const index = await readFile(join(root, "session_index.jsonl"), "utf8");
      return index
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .flatMap((line) => {
          try {
            const record = JSON.parse(line) as Record<string, unknown>;
            return typeof record.id === "string" ? [record.id] : [];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }
}