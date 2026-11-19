import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  CryptoProvider,
  SqliteFactStore,
  WorkWeaveError,
  asInstant,
  asMessageId,
  asPlainDate,
  asSessionId,
  bumpVersion,
  reportFingerprint,
  runMigrations
} from "@workweave/core";
import type { Session } from "@workweave/core";

test("迁移可重复执行且版本单调递增", () => {
  const db = new DatabaseSync(":memory:");
  const first = runMigrations(db);
  assert.equal(first.currentVersion, 2);
  assert.deepEqual(first.applied, [1, 2]);

  const second = runMigrations(db);
  assert.equal(second.currentVersion, 2);
  assert.deepEqual(second.applied, []);
});

test("迁移失败时回滚，不推进版本", () => {
  const db = new DatabaseSync(":memory:");
  assert.throws(() =>
    runMigrations(db, [
      { version: 1, name: "ok", up: "CREATE TABLE a (x INTEGER);" },
      { version: 2, name: "broken", up: "CREATE TABLE broken (" },
      { version: 3, name: "later", up: "CREATE TABLE b (x INTEGER);" }
    ])
  );

  const version = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get() as { version: number };
  assert.equal(version.version, 1);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as { name: string }[];
  assert.ok(tables.some((table) => table.name === "a"));
  assert.equal(tables.some((table) => table.name === "b"), false);
});

test("会话与消息幂等落库并可回读", () => {
  const store = SqliteFactStore.open();
  runMigrations(store.database);
  const sessionId = asSessionId("s1");
  const session: Session = {
    sessionId,
    sourceTool: "codex",
    startedAt: asInstant("2026-11-04T08:00:00.000Z"),
    workDir: "/work/project-a",
    title: "修复登录",
    messages: [
      {
        messageId: asMessageId("m1"),
        sessionId,
        sourceTool: "codex",
        role: "user",
        timestamp: asInstant("2026-11-04T08:01:00.000Z"),
        text: "修复 bug"
      },
      {
        messageId: asMessageId("m2"),
        sessionId,
        sourceTool: "codex",
        role: "assistant",
        timestamp: asInstant("2026-11-04T08:02:00.000Z"),
        text: "已修复"
      }
    ]
  };

  store.upsertSession(session);
  store.upsertSession(session);
  assert.equal(store.countMessages(), 2);

  const loaded = store.getSession("codex", "s1");
  assert.equal(loaded?.title, "修复登录");
  assert.equal(loaded?.messages.length, 2);
  assert.equal(loaded?.messages[0]?.text, "修复 bug");
});

test("会话列表按来源、日期和项目筛选并支持稳定分页", () => {
  const store = SqliteFactStore.open();
  runMigrations(store.database);
  const makeSession = (sourceTool: Session["sourceTool"], sessionId: string, startedAt: string, projectId: string): Session => ({
    sessionId: asSessionId(sessionId),
    sourceTool,
    startedAt: asInstant(startedAt),
    projectId: projectId as Session["projectId"],
    title: `${sourceTool}-${sessionId}`,
    messages: []
  });

  store.upsertSession(makeSession("codex", "same", "2026-11-04T08:00:00.000Z", "project-a"));
  store.upsertSession(makeSession("dsh", "same", "2026-11-04T09:00:00.000Z", "project-a"));
  store.upsertSession(makeSession("codex", "later", "2026-11-05T08:00:00.000Z", "project-b"));

  const firstPage = store.listSessions({ dayFrom: "2026-11-04", dayTo: "2026-11-04", projectId: "project-a", limit: 1 });
  const secondPage = store.listSessions({ dayFrom: "2026-11-04", dayTo: "2026-11-04", projectId: "project-a", limit: 1, offset: 1 });
  assert.equal(firstPage.total, 2);
  assert.equal(secondPage.total, 2);
  assert.equal(firstPage.items.length, 1);
  assert.equal(secondPage.items.length, 1);
  assert.notEqual(firstPage.items[0]?.sourceTool, secondPage.items[0]?.sourceTool);

  const codexOnly = store.listSessions({ sourceTool: "codex", limit: 10 });
  assert.deepEqual(codexOnly.items.map((item) => item.sessionId), ["later", "same"]);
});

test("全文检索返回命中消息及来源引用", () => {
  const store = SqliteFactStore.open();
  runMigrations(store.database);
  const sessionId = asSessionId("search-session");
  store.upsertSession({
    sessionId,
    sourceTool: "codex",
    startedAt: asInstant("2026-11-04T08:00:00.000Z"),
    projectId: "project-a" as Session["projectId"],
    messages: [
      {
        messageId: asMessageId("search-message"),
        sessionId,
        sourceTool: "codex",
        role: "user",
        timestamp: asInstant("2026-11-04T08:01:00.000Z"),
        text: "实现本地 SQLite 全文搜索"
      }
    ]
  });

  const result = store.searchMessages({ query: "SQLite", limit: 5 });
  assert.equal(result.total, 1);
  assert.deepEqual(result.items[0], {
    sourceTool: "codex",
    sessionId: "search-session",
    messageId: "search-message",
    role: "user",
    timestamp: "2026-11-04T08:01:00.000Z",
    text: "实现本地 SQLite 全文搜索",
    projectId: "project-a"
  });
});

test("单会话读取分页且限制单次消息数", () => {
  const store = SqliteFactStore.open();
  runMigrations(store.database);
  const sessionId = asSessionId("paged-session");
  store.upsertSession({
    sessionId,
    sourceTool: "codex",
    startedAt: asInstant("2026-11-04T08:00:00.000Z"),
    messages: [1, 2, 3].map((index) => ({
      messageId: asMessageId(`message-${index}`),
      sessionId,
      sourceTool: "codex",
      role: index === 1 ? "user" as const : "assistant" as const,
      timestamp: asInstant(`2026-11-04T08:0${index}:00.000Z`),
      ordinal: index,
      text: `消息 ${index}`
    }))
  });

  const first = store.readSessionPage("codex", "paged-session", { limit: 2 });
  const second = store.readSessionPage("codex", "paged-session", { limit: 2, offset: 2 });
  assert.equal(first?.totalMessages, 3);
  assert.deepEqual(first?.messages.map((message) => message.messageId), ["message-1", "message-2"]);
  assert.equal(first?.hasMore, true);
  assert.deepEqual(second?.messages.map((message) => message.messageId), ["message-3"]);
  assert.equal(second?.hasMore, false);
  assert.equal(store.readSessionPage("codex", "missing", { limit: 2 }), undefined);
});

test("分批 upsert 同一会话时保留已落库消息", () => {
  const store = SqliteFactStore.open();
  runMigrations(store.database);
  const sessionId = asSessionId("incremental-session");
  const base: Session = {
    sessionId,
    sourceTool: "codex",
    startedAt: asInstant("2026-11-04T08:00:00.000Z"),
    messages: [{
      messageId: asMessageId("first"),
      sessionId,
      sourceTool: "codex",
      role: "user",
      timestamp: asInstant("2026-11-04T08:01:00.000Z"),
      text: "first batch"
    }]
  };
  store.upsertSession(base);
  store.upsertSession({
    ...base,
    messages: [{
      messageId: asMessageId("second"),
      sessionId,
      sourceTool: "codex",
      role: "assistant",
      timestamp: asInstant("2026-11-04T08:02:00.000Z"),
      text: "second batch"
    }]
  });

  assert.deepEqual(store.getSession("codex", "incremental-session")?.messages.map((message) => message.messageId), ["first", "second"]);
  assert.equal(store.searchMessages({ query: "first", limit: 5 }).total, 1);
});

test("采集 checkpoint 可在 SQLite 关闭并重开后续读", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workweave-checkpoint-"));
  const databasePath = join(directory, "sessions.sqlite");
  try {
    const first = SqliteFactStore.open(databasePath);
    runMigrations(first.database);
    first.beginIngestRun("run-1", "2026-11-04", "codex");
    first.saveIngestCheckpoint({
      runId: "run-1",
      sourceTool: "codex",
      sourcePath: "sessions/session.jsonl",
      fingerprint: "sha256:abc",
      status: "completed",
      attempts: 1
    });
    first.finishIngestRun("run-1");
    first.close();

    const restarted = SqliteFactStore.open(databasePath);
    runMigrations(restarted.database);
    assert.deepEqual(restarted.getIngestCheckpoint("run-1", "codex", "sessions/session.jsonl"), {
      runId: "run-1",
      sourceTool: "codex",
      sourcePath: "sessions/session.jsonl",
      fingerprint: "sha256:abc",
      status: "completed",
      attempts: 1
    });
    restarted.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("个人模式加密不可用时降级，团队/企业模式阻止启动", () => {
  const personal = new CryptoProvider({ mode: "personal", available: false, secret: "s" });
  assert.deepEqual(personal.probe(), { available: false, degraded: true });
  assert.throws(
    () => personal.seal("x"),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-SEC-001"
  );

  for (const mode of ["team", "enterprise"] as const) {
    const provider = new CryptoProvider({ mode, available: false, secret: "s" });
    assert.throws(
      () => provider.probe(),
      (error: unknown) => error instanceof WorkWeaveError && error.code === "E-SEC-001"
    );
  }
});

test("可用加密提供者支持密封与解封", () => {
  const provider = new CryptoProvider({ mode: "personal", available: true, secret: "local-secret" });
  const sealed = provider.seal("敏感内容");
  assert.notEqual(sealed, "敏感内容");
  assert.equal(provider.open(sealed), "敏感内容");
});

test("版本递增与报告指纹稳定可复现", () => {
  const versions = {
    dataVersion: "1",
    configVersion: "1",
    ruleVersion: "1",
    templateVersion: "1",
    completenessVersion: "1"
  };
  const bumped = bumpVersion(versions, "ruleVersion");
  assert.equal(bumped.ruleVersion, "2");
  assert.equal(bumped.dataVersion, "1");

  const input = {
    reportType: "daily" as const,
    range: { from: asPlainDate("2026-11-04"), to: asPlainDate("2026-11-04") },
    versions,
    rendererVersion: "1"
  };
  assert.equal(reportFingerprint(input), reportFingerprint({ ...input }));
  assert.notEqual(reportFingerprint(input), reportFingerprint({ ...input, rendererVersion: "2" }));
});


test("????????????????????????", () => {
  const store = SqliteFactStore.open();
  runMigrations(store.database);
  const sessionId = asSessionId("cross-day");
  const session: Session = {
    sessionId, sourceTool: "codex", startedAt: asInstant("2026-10-31T23:59:00.000Z"),
    messages: ["2026-10-31", "2026-11-01", "2026-11-03"].map((date, index) => ({
      messageId: asMessageId(`cross-${index}`), sessionId, sourceTool: "codex", role: "user",
      timestamp: asInstant(`${date}T00:01:00.000Z`), text: `message ${date}`
    }))
  };
  store.upsertSession(session);
  const range = store.listSessions({ dayFrom: "2026-11-01", dayTo: "2026-11-02" });
  assert.equal(range.total, 1);
  assert.equal(range.items[0]?.messageCount, 1);
  store.close();
});
