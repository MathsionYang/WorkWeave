import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProbeService } from "@workweave/core";

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ww-v-probe-"));
}

test("V-01 自定义 CODEX_HOME 优先生效", async () => {
  const dir = await home();
  await mkdir(join(dir, "custom-codex", "sessions"), { recursive: true });
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

test("V-02 环境变量为空串时回退平台默认路径", async () => {
  const dir = await home();
  await mkdir(join(dir, ".codex", "sessions"), { recursive: true });
  const service = new ProbeService();
  const result = await service.probe({
    source: "codex",
    platform: "linux",
    homeDir: dir,
    env: { CODEX_HOME: "   " }
  });
  assert.equal(result.status, "discovered");
  assert.equal(result.env.state, "empty");
  assert.ok(result.adoptedPath?.endsWith(".codex"));
});

test("V-03 环境变量指向文件时不当作目录采集", async () => {
  const dir = await home();
  const file = join(dir, "home.txt");
  await writeFile(file, "x", "utf8");
  const service = new ProbeService();
  const result = await service.probe({
    source: "codex",
    platform: "linux",
    homeDir: dir,
    env: { CODEX_HOME: file }
  });
  assert.equal(result.env.state, "file");
  assert.equal(result.status, "not-found");
});

test("V-04 环境变量指向非来源目录时判格式不支持", async () => {
  const dir = await home();
  await mkdir(join(dir, "random"), { recursive: true });
  const service = new ProbeService();
  const result = await service.probe({
    source: "codex",
    platform: "linux",
    homeDir: dir,
    env: { CODEX_HOME: join(dir, "random") }
  });
  assert.equal(result.status, "unsupported-format");
});

test("V-05 人工指定路径优先于环境变量", async () => {
  const dir = await home();
  await mkdir(join(dir, "manual", "sessions"), { recursive: true });
  await mkdir(join(dir, "env", "sessions"), { recursive: true });
  const service = new ProbeService();
  const result = await service.probe({
    source: "codex",
    platform: "linux",
    homeDir: dir,
    env: { CODEX_HOME: join(dir, "env") },
    manualPath: join(dir, "manual")
  });
  assert.ok(result.adoptedPath?.endsWith("manual"));
});

test("V-06 人工路径失效时不静默覆盖，回退候选并保留失效记录", async () => {
  const dir = await home();
  await mkdir(join(dir, "env", "sessions"), { recursive: true });
  const service = new ProbeService();
  const result = await service.probe({
    source: "codex",
    platform: "linux",
    homeDir: dir,
    env: { CODEX_HOME: join(dir, "env") },
    manualPath: join(dir, "missing")
  });
  assert.ok(result.adoptedPath?.endsWith("env"));
  const manual = result.candidates.find((candidate) => candidate.layer === "manual");
  assert.equal(manual?.validation, "missing");
});

test("V-07 环境变量变化使探测缓存失效", async () => {
  const dir = await home();
  await mkdir(join(dir, "a", "sessions"), { recursive: true });
  await mkdir(join(dir, "b", "sessions"), { recursive: true });
  const service = new ProbeService();
  const first = await service.probe({
    source: "codex",
    platform: "linux",
    homeDir: dir,
    env: { CODEX_HOME: join(dir, "a") }
  });
  const second = await service.probe({
    source: "codex",
    platform: "linux",
    homeDir: dir,
    env: { CODEX_HOME: join(dir, "b") }
  });
  assert.ok(first.adoptedPath?.endsWith("a"));
  assert.ok(second.adoptedPath?.endsWith("b"));
  assert.equal(second.fromCache, false);
});

test("V-08 相同配置命中缓存并标注 fromCache", async () => {
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
});