import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { analyzeIntegrity, WorkWeaveError } from "@workweave/core";
import type { Message, ParsedSession, SourceAdapter } from "@workweave/core";
import { asInstant, asMessageId, asSessionId } from "@workweave/core";
import { decompressZstdFrames } from "../zstd-frames.js";

interface DshFrame {
  readonly type?: string;
  readonly seq?: number;
  readonly time?: number;
  readonly data?: Record<string, unknown>;
}

const KNOWN_TYPES = new Set([
  "session",
  "session/title",
  "user/message",
  "assistant/message",
  "system/message",
  "tool/call",
  "tool/result",
  "turn/start",
  "turn/end",
  "step/start",
  "step/end",
  "permission/preset",
  "sandbox/mode",
  "approval/policy",
  "command/run",
  "command/done",
  "agent/inbox/spliced",
  "session-log-deepseek/delivery-accepted",
  "assistant/attempt",
  "request/header",
  "request/context",
  "model/selection",
  "todo/write",
  "compaction/start",
  "compaction/summary",
  "compaction/end",
  "compaction/prune",
  "deliverables/presented",
  "subagent/catalog",
  "session/end-seed",
  "web/deepseek-search-llm-request",
  "session/title-llm-request"
]);

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content.map((item) => textOfContent(item)).filter((part) => part.length > 0);
    return parts.join("\n");
  }
  if (typeof content === "object" && content !== null) {
    const record = content as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (record.content !== undefined) return textOfContent(record.content);
  }
  return "";
}

function timestampOf(value: unknown, fallback: string): { readonly iso: string; readonly anomalous: boolean } {
  if (typeof value === "number" && value >= 1e12 && value < 1e13) {
    return { iso: new Date(value).toISOString(), anomalous: false };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { iso: fallback, anomalous: true };
  }
  return { iso: fallback, anomalous: true };
}

async function* walkSessionFiles(dir: string): AsyncGenerator<string> {
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
      yield* walkSessionFiles(full);
    } else if (entry.isFile() && /^session\.v\d+\.jsonl\.zstd$/.test(entry.name)) {
      yield full;
    }
  }
}

export class DshAdapter implements SourceAdapter {
  readonly source = "dsh" as const;

  async *scan(root: string): AsyncGenerator<string> {
    yield* walkSessionFiles(join(root, "sessions"));
  }

  async parse(filePath: string): Promise<ParsedSession> {
    const compressed = await readFile(filePath);
    const decompressed = decompressZstdFrames(compressed);
    const lines = decompressed.text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const frames: DshFrame[] = [];
    let unknownTypeCount = decompressed.corrupt;

    for (const line of lines) {
      let frame: DshFrame;
      try {
        frame = JSON.parse(line) as DshFrame;
      } catch {
        unknownTypeCount += 1;
        continue;
      }
      if (frame.type !== undefined && !KNOWN_TYPES.has(frame.type)) {
        unknownTypeCount += 1;
      }
      frames.push(frame);
    }

    const sessionFrame = frames.find((frame) => frame.type === "session");
    const version = sessionFrame?.data?.version;
    if (typeof version === "number" && version > 4) {
      throw new WorkWeaveError("E-SRC-002", `unsupported dsh schema version: ${version}`);
    }

    const sessionId = asSessionId(
      typeof sessionFrame?.data?.id === "string"
        ? sessionFrame.data.id
        : basename(dirname(filePath))
    );
    const cwd = typeof sessionFrame?.data?.cwd === "string" ? sessionFrame.data.cwd : undefined;
    const titleFrame = frames.find((frame) => frame.type === "session/title");
    const title = typeof titleFrame?.data?.title === "string" ? titleFrame.data.title : undefined;

    const messages: Message[] = [];
    const messageSeqs: number[] = [];
    const anomalies: string[] = [];
    let fallback = new Date(0).toISOString();

    for (const frame of frames) {
      let role: Message["role"] | undefined;
      let content: unknown;
      let messageId: string | undefined;
      let baseSeq = frame.seq;

      if (frame.type === "user/message") {
        role = "user";
        content = frame.data?.content;
        messageId = typeof frame.data?.id === "string" ? frame.data.id : undefined;
      } else if (frame.type === "assistant/message") {
        const message = frame.data?.message as Record<string, unknown> | undefined;
        role = "assistant";
        content = message?.content;
        messageId = typeof message?.id === "string" ? message.id : undefined;
      } else if (frame.type === "system/message") {
        const message = frame.data?.message as Record<string, unknown> | undefined;
        role = "system";
        content = message?.content;
        messageId = typeof message?.id === "string" ? message.id : undefined;
      } else if (frame.type === "tool/call") {
        role = "tool";
        content = `${String(frame.data?.name ?? "tool")} ${String(frame.data?.arguments ?? "")}`;
        messageId = typeof frame.data?.callId === "string" ? frame.data.callId : undefined;
      } else if (frame.type === "tool/result") {
        const message = frame.data?.message as Record<string, unknown> | undefined;
        role = "tool";
        content = message?.content;
        messageId = typeof message?.id === "string" ? message.id : undefined;
      } else {
        continue;
      }

      if (role === undefined) continue;
      const time = timestampOf(frame.time, fallback);
      if (time.anomalous) anomalies.push(`anomalous timestamp at seq ${String(baseSeq)}`);
      fallback = time.iso;
      if (baseSeq !== undefined) messageSeqs.push(baseSeq);
      baseSeq = baseSeq ?? messages.length;
      messages.push({
        messageId: asMessageId(messageId ?? `${sessionId}-${baseSeq}`),
        sessionId,
        sourceTool: "dsh",
        role,
        timestamp: asInstant(time.iso),
        ...(baseSeq !== undefined ? { ordinal: baseSeq } : {}),
        text: textOfContent(content)
      });
    }

    const sorted = [...messages].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
    const startedAt = asInstant(
      typeof sessionFrame?.data?.createdAt === "number"
        ? new Date(sessionFrame.data.createdAt).toISOString()
        : sorted[0]?.timestamp ?? new Date(0).toISOString()
    );
    const endedAt = sorted.at(-1)?.timestamp;

    const gaps = analyzeIntegrity({
      source: "dsh",
      rootExists: true,
      rootReadable: true,
      messageOrdinals: messageSeqs,
      messageTimestamps: sorted.map((message) => message.timestamp),
      emptyBodyMessageCount: sorted.filter((message) => (message.text ?? "").length === 0).length,
      hasAnyReadableRecord: sorted.length > 0
    }).gaps;

    return {
      sessionId,
      sourceTool: "dsh",
      startedAt,
      ...(endedAt !== undefined ? { endedAt } : {}),
      ...(cwd !== undefined ? { workDir: cwd } : {}),
      ...(title !== undefined ? { title } : {}),
      messages: sorted,
      unknownTypeCount,
      gaps: [
        ...gaps,
        ...(anomalies.length > 0
          ? [{ type: "time-gap" as const, source: "dsh" as const, scope: "frames", affectedCount: anomalies.length, basis: "anomalous non-millisecond timestamps" }]
          : [])
      ],
      sourceFile: filePath
    };
  }

  async enumerableSessionIds(root: string): Promise<readonly string[]> {
    const ids: string[] = [];
    for await (const file of this.scan(root)) {
      ids.push(basename(dirname(file)));
    }
    return ids;
  }
}

export function decodeDshProjectSlug(slug: string): string {
  let value = slug;
  if (value.startsWith("--")) value = value.slice(2);
  if (value.endsWith("--")) value = value.slice(0, -2);
  value = value.replace(/~([0-9A-Fa-f]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));

  const segments = value.split("-").filter((segment) => segment.length > 0);
  if (segments.length === 0) return slug;
  if (/^[A-Za-z]$/.test(segments[0] ?? "")) segments[0] = `${segments[0]}:`;
  return segments.join("\\");
}