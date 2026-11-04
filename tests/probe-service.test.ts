import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProbeService } from "@workweave/core";

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ww-probe-"));
}

test("Codex 存在 sessions 目录时判 discovered", async () => {
  const dir = await home();
  await mkdir(join(dir, ".codex", "sessions"), { recursive: true });
  const service = new ProbeService();
  const result = await service.probe({ source: "codex", platform: "linux", homeDir: dir, env: {} });
  assert.equal(result.status, "discovered");
  assert.equal(result.completeness.status, "complete");
  assert.ok(result.adoptedPath?.endsWith(".codex"));
});

test("根目录完全不存在时判 not-found", async () => {
  const dir = await home();
  const service = new ProbeService();
  const result = await service.probe({ source: "dsh", platform: "linux", homeDir: dir, env: {} });
  assert.equal(result.status, "not-found");
});

test("环境变量优先于平台默认路径", async () => {
  const dir = await home();
  await mkdir(join(dir, "custom-codex", "sessions"), { recursive: true });
  await mkdir(join(dir, ".codex", "sessions"), { recursive: true });
  const service = new ProbeService();
  const result = await service.probe({
    source: "codex",
    platform: "linux",
    homeDir: dir,
    env: { CODEX_HOME: join(dir, "custom-codex") }
  });
  assert.equal(result.status, "discovered");
  assert.ok(result.adoptedPath?.endsWith("custom-codex"));
});

test("人工配置失效时采用环境变量但标记待切换", async () => {
  const dir = await home();
  await mkdir(join(dir, "env-codex", "sessions"), { recursive: true });
  const service = new ProbeService();
  const result = await service.probe({
    source: "codex",
    platform: "linux",
    homeDir: dir,
    env: { CODEX_HOME: join(dir, "env-codex") },
    manualPath: join(dir, "missing-manual")
  });
  assert.equal(result.status, "discovered");
  assert.ok(result.adoptedPath?.endsWith("env-codex"));
  assert.ok(result.adoptedPath !== join(dir, "missing-manual"));
});

test("Claude 仅发现 Code 布局时判部分可用并带 E-SRC-003 警告", async () => {
  const dir = await home();
  await mkdir(join(dir, ".claude", "projects"), { recursive: true });
  const service = new ProbeService();
  const result = await service.probe({ source: "claude", platform: "linux", homeDir: dir, env: {} });
  assert.equal(result.status, "partially-available");
  assert.equal(result.completeness.status, "possibly-incomplete");
  assert.ok(result.warnings.includes("E-SRC-003"));
});

test("探测缓存命中返回同一结论并标注 fromCache", async () => {
  const dir = await home();
  await mkdir(join(dir, ".codex", "sessions"), { recursive: true });
  const service = new ProbeService();
  const now = new Date("2026-11-04T00:00:00.000Z");
  await service.probe({ source: "codex", platform: "linux", homeDir: dir, env: {}, now });
  const cached = await service.probe({
    source: "codex",
    platform: "linux",
    homeDir: dir,
    env: {},
    now: new Date("2026-11-04T01:00:00.000Z")
  });
  assert.equal(cached.fromCache, true);
  assert.equal(cached.status, "discovered");
});