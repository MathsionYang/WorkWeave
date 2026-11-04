import assert from "node:assert/strict";
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
  assert.equal(first.currentVersion, 1);
  assert.deepEqual(first.applied, [1]);

  const second = runMigrations(db);
  assert.equal(second.currentVersion, 1);
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