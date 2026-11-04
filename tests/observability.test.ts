import assert from "node:assert/strict";
import test from "node:test";
import {
  AuditLog,
  MetricsRegistry,
  buildDiagnostics,
  formatLog
} from "@workweave/core";

test("审计事件形成哈希链且可校验", () => {
  const log = new AuditLog();
  const first = log.append({
    actorId: "u1",
    tenantId: "t1",
    action: "login",
    resource: "app",
    at: new Date("2026-11-04T00:00:00.000Z")
  });
  const second = log.append({
    actorId: "u1",
    tenantId: "t1",
    action: "export",
    resource: "report.md",
    at: new Date("2026-11-04T00:01:00.000Z")
  });

  assert.equal(log.verify().ok, true);
  assert.equal(second.prevHash, first.hash);
  assert.equal(log.snapshot().length, 2);
});

test("审计链被篡改时校验失败并定位事件", () => {
  const log = new AuditLog();
  const event = log.append({
    actorId: "u1",
    tenantId: "t1",
    action: "tool-call",
    resource: "ww_source_probe",
    at: new Date("2026-11-04T00:00:00.000Z")
  });
  (event as unknown as { resource: string }).resource = "tampered";
  const verification = log.verify();
  assert.equal(verification.ok, false);
  assert.equal(verification.brokenAt, 0);
});

test("审计保留期不少于 180 天", () => {
  const log = new AuditLog();
  log.append({
    actorId: "u1",
    tenantId: "t1",
    action: "login",
    resource: "app",
    at: new Date("2026-01-01T00:00:00.000Z")
  });
  log.append({
    actorId: "u1",
    tenantId: "t1",
    action: "login",
    resource: "app",
    at: new Date("2026-11-04T00:00:00.000Z")
  });

  assert.equal(log.retain(180, new Date("2026-11-04T12:00:00.000Z")), 1);
  assert.throws(() => log.retain(30), RangeError);
});

test("指标注册表同时记录计数、量表与观测均值", () => {
  const metrics = new MetricsRegistry();
  metrics.increment("probe.ok");
  metrics.increment("probe.ok");
  metrics.setGauge("probe.sources", 4);
  metrics.observe("report.durationMs", 100);
  metrics.observe("report.durationMs", 200);

  const snapshot = metrics.snapshot();
  assert.equal(snapshot["probe.ok"], 2);
  assert.equal(snapshot["probe.sources"], 4);
  assert.equal(snapshot["report.durationMs.count"], 2);
  assert.equal(snapshot["report.durationMs.avg"], 150);
});

test("结构化日志只输出摘要字段，不包含正文与凭据", () => {
  const line = formatLog({
    timestamp: "2026-11-04T00:00:00.000Z",
    callId: "call-1",
    stage: "ingest",
    sourceTool: "codex",
    resultCode: "OK",
    durationMs: 42,
    completenessStatus: "complete",
    contentDigest: "sha256:abc"
  });
  const parsed = JSON.parse(line) as Record<string, unknown>;

  assert.equal(parsed.contentDigest, "sha256:abc");
  for (const key of ["text", "body", "content", "message", "arguments", "token", "password"]) {
    assert.equal(key in parsed, false, `unexpected log field: ${key}`);
  }
});

test("诊断包遮罩用户目录并脱敏错误信息", () => {
  const diagnostics = buildDiagnostics({
    day: "2026-11-04",
    sources: ["codex", "claude"],
    stageTimings: { probe: 12, ingest: 30 },
    errors: ["failed with sk-abcdefghijklmnopqrstuvwxyz123456"],
    probeCandidatePaths: ["C:\\Users\\me\\.codex\\sessions"],
    gaps: ["claude:source-type-missing:claude-desktop"],
    homeDir: "C:\\Users\\me"
  });

  assert.equal(diagnostics.candidatePaths[0], "<profile>\\.codex\\sessions");
  assert.equal(diagnostics.errors[0]?.includes("sk-"), false);
  assert.ok(diagnostics.errors[0]?.includes("[REDACTED:OPENAI_KEY]"));
});