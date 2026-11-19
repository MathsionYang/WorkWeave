import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { asInstant, asMessageId, asSessionId } from "@workweave/core";
import type { ParsedSession, SourceAdapter } from "@workweave/core";
import { WorkWeaveRuntime } from "@workweave/mcp";

const DAY = "2026-11-04";

function fixtureSession(id: string, sourceFile: string, day = DAY): ParsedSession {
  return {
    sessionId: asSessionId(id), sourceTool: "codex", startedAt: asInstant(`${day}T08:00:00.000Z`),
    sourceFile, unknownTypeCount: 0, gaps: [],
    messages: [{ messageId: asMessageId(`${id}-m1`), sessionId: asSessionId(id), sourceTool: "codex",
      role: "user", timestamp: asInstant(`${day}T08:01:00.000Z`), text: `work ${id}` }]
  };
}

function adapterFor(files: readonly string[], shouldFail: (file: string) => boolean): SourceAdapter {
  return {
    source: "codex",
    async *scan() { for (const file of files) yield file; },
    async parse(file) {
      if (shouldFail(file)) throw Object.assign(new Error("temporary I/O"), { code: "EIO" });
      const id = file.split(/[\\/]/).at(-1)?.replace(/\.jsonl$/, "") ?? "session";
      return fixtureSession(id === "empty" ? "empty" : id, file, id === "empty" ? "2026-11-03" : DAY);
    },
    async enumerableSessionIds() { return files.map((file) => file); }
  };
}

test("?????????????????????????", async () => {
  const home = await mkdtemp(join(tmpdir(), "ww-ingest-resume-"));
  const root = join(home, "source");
  await mkdir(root, { recursive: true });
  const files = ["one.jsonl", "two.jsonl", "empty.jsonl"].map((name) => join(root, name));
  for (const file of files) await writeFile(file, file, "utf8");
  const dbPath = join(home, "workweave.sqlite");

  const first = new WorkWeaveRuntime({ homeDir: home, platform: "linux", env: {}, sources: ["codex"],
    dbPath, sourceRoots: { codex: root }, adapters: { codex: adapterFor(files, (file) => file === files[1]) } });
  const firstResult = await first.ingest(DAY, ["codex"]);
  assert.equal(firstResult.completedFiles, 2);
  assert.equal(firstResult.failedFiles, 1);
  assert.equal(firstResult.sessionCount, 1);
  first.close();

  const resumed = new WorkWeaveRuntime({ homeDir: home, platform: "linux", env: {}, sources: ["codex"],
    dbPath, sourceRoots: { codex: root }, adapters: { codex: adapterFor(files, () => false) } });
  const resumeResult = await resumed.ingest(DAY, ["codex"], true);
  assert.equal(resumeResult.resumedFiles, 2);
  assert.equal(resumeResult.completedFiles, 1);
  assert.equal(resumeResult.failedFiles, 0);
  assert.equal(resumeResult.sessionCount, 2);
  assert.equal(resumeResult.messageCount, 2);
  assert.equal(resumed.listSessions({ dayFrom: DAY, dayTo: DAY, sourceTool: "codex" }).total, 2);
  resumed.close();
});

test("?????????????", async () => {
  const home = await mkdtemp(join(tmpdir(), "ww-ingest-retry-"));
  const root = join(home, "source");
  await mkdir(root, { recursive: true });
  const file = join(root, "retry.jsonl");
  await writeFile(file, "retry", "utf8");
  let attempts = 0;
  const adapter = adapterFor([file], () => ++attempts < 3);
  const runtime = new WorkWeaveRuntime({ homeDir: home, platform: "linux", env: {}, sources: ["codex"],
    dbPath: join(home, "db.sqlite"), sourceRoots: { codex: root }, adapters: { codex: adapter } });
  const result = await runtime.ingest(DAY, ["codex"]);
  assert.equal(attempts, 3);
  assert.equal(result.failedFiles, 0);
  assert.equal(result.sessionCount, 1);
  runtime.close();
});


test("????????????????????????", async () => {
  const home = await mkdtemp(join(tmpdir(), "ww-ingest-range-"));
  const root = join(home, "source");
  await mkdir(root, { recursive: true });
  const file = join(root, "range.jsonl");
  await writeFile(file, "range", "utf8");
  const multiDayAdapter: SourceAdapter = {
    source: "codex",
    async *scan() { yield file; },
    async parse() {
      const sessionId = asSessionId("multi-day");
      return {
        sessionId, sourceTool: "codex", startedAt: asInstant("2026-11-01T23:59:00.000Z"),
        sourceFile: file, unknownTypeCount: 0, gaps: [],
        messages: ["2026-11-01", "2026-11-02", "2026-11-03"].map((date, index) => ({
          messageId: asMessageId(`m${index}`), sessionId, sourceTool: "codex" as const, role: "user" as const,
          timestamp: asInstant(`${date}T00:01:00.000Z`), text: `message ${date}`
        }))
      };
    },
    async enumerableSessionIds() { return ["multi-day"]; }
  };
  const runtime = new WorkWeaveRuntime({ homeDir: home, platform: "linux", env: {}, sources: ["codex"],
    dbPath: join(home, "db.sqlite"), sourceRoots: { codex: root }, adapters: { codex: multiDayAdapter } });
  const result = await runtime.ingestRange("2026-11-01", "2026-11-02", ["codex"]);
  assert.equal(result.sessionCount, 1);
  assert.equal(result.messageCount, 2);
  assert.equal(runtime.listSessions({ dayFrom: "2026-11-01", dayTo: "2026-11-02", sourceTool: "codex" }).total, 1);
  runtime.close();
});
