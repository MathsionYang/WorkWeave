import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { asInstant, asMessageId, asSessionId } from "@workweave/core";
import type { ParsedSession, SourceAdapter } from "@workweave/core";
import { ContractGateway, WorkWeaveRuntime, createRuntimeHandlers } from "@workweave/mcp";

const auth = { hostId: "workbuddy", token: "local-token" };

test("MCP ww_source_ingest ?? dayFrom/dayTo ????", async () => {
  const home = await mkdtemp(join(tmpdir(), "ww-mcp-range-"));
  const root = join(home, "source");
  await mkdir(root, { recursive: true });
  const file = join(root, "range.jsonl");
  await writeFile(file, "fixture", "utf8");
  const sessionId = asSessionId("range-session");
  const adapter: SourceAdapter = {
    source: "codex",
    async *scan() { yield file; },
    async parse(): Promise<ParsedSession> {
      return {
        sessionId, sourceTool: "codex", startedAt: asInstant("2026-11-01T22:00:00.000Z"), sourceFile: file,
        unknownTypeCount: 0, gaps: [],
        messages: ["2026-11-01", "2026-11-02", "2026-11-03"].map((date, index) => ({
          messageId: asMessageId(`range-m${index}`), sessionId, sourceTool: "codex", role: "user",
          timestamp: asInstant(`${date}T08:00:00.000Z`), text: `range marker ${date}`
        }))
      };
    },
    async enumerableSessionIds() { return [sessionId]; }
  };
  const runtime = new WorkWeaveRuntime({ homeDir: home, platform: "linux", env: {}, sources: ["codex"],
    dbPath: join(home, "db.sqlite"), sourceRoots: { codex: root }, adapters: { codex: adapter } });
  const gateway = new ContractGateway({ expectedHostId: auth.hostId, expectedToken: auth.token, handlers: createRuntimeHandlers(runtime) });
  const result = await gateway.invoke({
    tool: "ww_source_ingest", callId: "range-ingest", auth,
    params: { dayFrom: "2026-11-01", dayTo: "2026-11-02", source: "codex" }
  });
  assert.equal(result.ok, true);
  assert.equal((result.data as { sessionCount: number }).sessionCount, 1);
  const listed = runtime.listSessions({ dayFrom: "2026-11-01", dayTo: "2026-11-02", sourceTool: "codex" });
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0]?.messageCount, 2);

  const invalid = await gateway.invoke({
    tool: "ww_source_ingest", callId: "range-ingest-invalid", auth,
    params: { dayFrom: "2026-11-02", source: "codex" }
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "E-MCP-003");
  runtime.close();
});


test("MCP ????????????????????", async () => {
  const home = await mkdtemp(join(tmpdir(), "ww-mcp-dedup-"));
  const codexRoot = join(home, "codex");
  const buddyRoot = join(home, "workbuddy");
  await mkdir(codexRoot, { recursive: true });
  await mkdir(buddyRoot, { recursive: true });
  const codexFile = join(codexRoot, "codex.jsonl");
  const buddyFile = join(buddyRoot, "buddy.jsonl");
  await writeFile(codexFile, "codex", "utf8");
  await writeFile(buddyFile, "workbuddy", "utf8");
  const makeAdapter = (sourceTool: "codex" | "workbuddy", file: string, sessionValue: string): SourceAdapter => ({
    source: sourceTool,
    async *scan() { yield file; },
    async parse() {
      const sessionId = asSessionId(sessionValue);
      return {
        sessionId, sourceTool, startedAt: asInstant("2026-11-04T08:00:00.000Z"), workDir: "/work/shared-project",
        sourceFile: file, unknownTypeCount: 0, gaps: [],
        messages: [{ messageId: asMessageId(`${sessionValue}-prompt`), sessionId, sourceTool, role: "user",
          timestamp: asInstant(sourceTool === "codex" ? "2026-11-04T08:00:00.000Z" : "2026-11-04T08:05:00.000Z"),
          text: "  Build the same feature\r\nnow  " }]
      };
    },
    async enumerableSessionIds() { return [sessionValue]; }
  });
  const runtime = new WorkWeaveRuntime({
    homeDir: home, platform: "linux", env: {}, sources: ["codex", "workbuddy"], dbPath: join(home, "db.sqlite"),
    sourceRoots: { codex: codexRoot, workbuddy: buddyRoot },
    adapters: { codex: makeAdapter("codex", codexFile, "codex-session"), workbuddy: makeAdapter("workbuddy", buddyFile, "buddy-session") }
  });
  await runtime.ingest("2026-11-04");
  await runtime.classify("2026-11-04");
  const results = runtime.searchSessions({ query: "Build the same feature" });
  assert.equal(results.items.length, 1);
  assert.equal(results.items[0]?.sources.length, 2);
  assert.deepEqual(new Set(results.items[0]?.sources.map((source) => source.sourceTool)), new Set(["codex", "workbuddy"]));
  assert.equal(runtime.listSessions({ dayFrom: "2026-11-04", dayTo: "2026-11-04" }).total, 2);
  runtime.close();
});
