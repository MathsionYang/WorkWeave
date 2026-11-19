import type { MessageSearchHit } from "../infra/repo/sqlite-store.js";
import type { SourceTool } from "../domain/types.js";

export interface ExactPromptSource {
  readonly sourceTool: SourceTool;
  readonly sessionId: string;
  readonly messageId: string;
}

export type GroupedMessageSearchHit = MessageSearchHit & {
  readonly sources: readonly ExactPromptSource[];
};

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

function normalizedPrompt(text: string): string {
  return text.replace(/\r\n?/g, "\n").normalize("NFC").trim();
}

function references(hit: MessageSearchHit): readonly ExactPromptSource[] {
  return [{ sourceTool: hit.sourceTool, sessionId: hit.sessionId, messageId: hit.messageId }];
}

/** Group only exact user prompts from a known shared project within a ten-minute window. */
export function groupExactPromptHits(hits: readonly MessageSearchHit[]): readonly GroupedMessageSearchHit[] {
  const buckets = new Map<string, MessageSearchHit[]>();
  const passthrough: MessageSearchHit[] = [];
  for (const hit of hits) {
    const project = hit.projectId;
    const text = normalizedPrompt(hit.text);
    if (hit.role !== "user" || project === undefined || project === "unassigned" || project === "cross-project" || text.length === 0) {
      passthrough.push(hit);
      continue;
    }
    const key = `${project}\u0000${text}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(hit);
    buckets.set(key, bucket);
  }

  const groups: { readonly latestAt: number; readonly values: readonly MessageSearchHit[] }[] = passthrough.map((hit) => ({
    latestAt: Date.parse(hit.timestamp), values: [hit]
  }));
  for (const bucket of buckets.values()) {
    const sorted = [...bucket].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
    let cluster: MessageSearchHit[] = [];
    let firstAt = 0;
    const flush = (): void => {
      if (cluster.length === 0) return;
      const tools = new Set(cluster.map((hit) => hit.sourceTool));
      if (tools.size > 1) {
        groups.push({ latestAt: Date.parse(cluster[cluster.length - 1]?.timestamp ?? ""), values: cluster });
      } else {
        for (const hit of cluster) groups.push({ latestAt: Date.parse(hit.timestamp), values: [hit] });
      }
      cluster = [];
    };
    for (const hit of sorted) {
      const at = Date.parse(hit.timestamp);
      if (!Number.isFinite(at)) {
        flush();
        groups.push({ latestAt: Number.NEGATIVE_INFINITY, values: [hit] });
        continue;
      }
      if (cluster.length === 0 || at - firstAt <= DUPLICATE_WINDOW_MS) {
        if (cluster.length === 0) firstAt = at;
        cluster.push(hit);
      } else {
        flush();
        firstAt = at;
        cluster.push(hit);
      }
    }
    flush();
  }

  return groups
    .sort((left, right) => right.latestAt - left.latestAt)
    .flatMap(({ values }): GroupedMessageSearchHit[] => {
      const ordered = [...values].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
      const primary = ordered[0];
      if (primary === undefined) return [];
      const uniqueSources = new Map<string, ExactPromptSource>();
      for (const hit of ordered) {
        const reference = references(hit)[0];
        if (reference !== undefined) uniqueSources.set(`${reference.sourceTool}:${reference.sessionId}:${reference.messageId}`, reference);
      }
      return [{ ...primary, sources: [...uniqueSources.values()] }];
    });
}
