import { createHash } from "node:crypto";
import type { Message } from "../domain/models.js";
import type { DataVersion, SessionId } from "../domain/types.js";
import type {
  CollectDayInput,
  CollectDayResult,
  CollectFailure,
  ParsedSession,
  SourceAdapter
} from "./types.js";

interface SessionAccumulator {
  session: ParsedSession;
  messages: Map<string, Message>;
}

function dayOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function computeDataVersion(day: string, sessions: readonly ParsedSession[]): DataVersion {
  const hash = createHash("sha256");
  hash.update(day);
  for (const session of [...sessions].sort((a, b) => a.sessionId.localeCompare(b.sessionId))) {
    hash.update(`|${session.sessionId}`);
    for (const message of session.messages) {
      hash.update(`|${message.messageId}`);
    }
  }
  return hash.digest("hex").slice(0, 16) as DataVersion;
}

export async function collectDay(input: CollectDayInput): Promise<CollectDayResult> {
  const adapter: SourceAdapter = input.adapter;
  const accumulators = new Map<string, SessionAccumulator>();
  const failures: CollectFailure[] = [];
  let duplicateSessionCount = 0;
  let unknownTypeCount = 0;

  for await (const file of adapter.scan(input.root)) {
    let parsed: ParsedSession;
    try {
      parsed = await adapter.parse(file);
    } catch (error) {
      failures.push({ file, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }

    const dailyMessages = parsed.messages.filter((message) => dayOf(message.timestamp) === input.day);
    if (dailyMessages.length === 0) continue;

    unknownTypeCount += parsed.unknownTypeCount;
    const existing = accumulators.get(parsed.sessionId);
    if (existing !== undefined) {
      duplicateSessionCount += 1;
      for (const message of dailyMessages) {
        existing.messages.set(message.messageId, message);
      }
      continue;
    }

    accumulators.set(parsed.sessionId, {
      session: parsed,
      messages: new Map(dailyMessages.map((message) => [message.messageId, message]))
    });
  }

  const sessions: ParsedSession[] = [...accumulators.values()].map((accumulator) => ({
    ...accumulator.session,
    messages: [...accumulator.messages.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }));

  const sessionCount = sessions.length;
  const messageCount = sessions.reduce((sum, session) => sum + session.messages.length, 0);
  const warnings: string[] = [];
  if (input.maxSessions !== undefined && sessionCount > input.maxSessions) {
    warnings.push("E-CAP-002");
  }

  return {
    dataVersion: computeDataVersion(input.day, sessions),
    sessions,
    sessionCount,
    messageCount,
    duplicateSessionCount,
    unknownTypeCount,
    failures,
    warnings
  };
}

export function sessionIds(result: CollectDayResult): readonly SessionId[] {
  return result.sessions.map((session) => session.sessionId);
}