import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  analyzeIntegrity,
  platformCandidates,
  readEnvCandidate,
  resolveCandidates
} from "@workweave/core";
import type { ProbeCandidate } from "@workweave/core";

test("三平台候选互不复用且顺序稳定", () => {
  const win = platformCandidates("claude", { platform: "win32", homeDir: "C:\\Users\\me" });
  const mac = platformCandidates("claude", { platform: "darwin", homeDir: "/Users/me" });
  const linux = platformCandidates("claude", { platform: "linux", homeDir: "/home/me" });
  assert.equal(win.length, 3);
  assert.equal(mac.length, 2);
  assert.equal(linux.length, 2);
  assert.ok(win[0]?.path.endsWith(".claude"));
  assert.ok(mac[0]?.path.endsWith(".claude"));
  assert.ok(linux[0]?.path.endsWith(".claude"));
});

test("环境变量空串按未设置处理，不回落工作目录", async () => {
  const state = await readEnvCandidate({
    source: "codex",
    env: { CODEX_HOME: "   " },
    homeDir: "/home/me"
  });
  assert.equal(state.state, "empty");
});

test("环境变量指向文件时判为 file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ww-env-"));
  const file = join(dir, "home.txt");
  await writeFile(file, "x", "utf8");
  const state = await readEnvCandidate({
    source: "codex",
    env: { CODEX_HOME: file },
    homeDir: dir
  });
  assert.equal(state.state, "file");
});

test("候选裁决按优先级取用并记录人工失效待切换", () => {
  const candidates: ProbeCandidate[] = [
    { source: "codex", layer: "env", path: "env", rank: 2, validation: "valid", hit: "adopted" },
    { source: "codex", layer: "manual", path: "manual", rank: 0, validation: "missing", hit: "invalid" }
  ];
  const resolution = resolveCandidates(candidates);
  assert.equal(resolution.adopted?.path, "env");
  assert.equal(resolution.pendingSwitch, true);
  assert.equal(resolution.ignored.length, 1);
});

test("Claude 仅有 Code 记录时判部分可用并记录来源类型缺失", () => {
  const declaration = analyzeIntegrity({
    source: "claude",
    rootExists: true,
    rootReadable: true,
    readableTypes: ["code"],
    hasAnyReadableRecord: true,
    hasAnyCompletenessBasis: false
  });
  assert.equal(declaration.status, "possibly-incomplete");
  assert.ok(declaration.gaps.some((gap) => gap.type === "source-type-missing"));
  assert.equal(declaration.undetermined, false);
});

test("根目录可读但完全无可读记录且无依据时 undetermined", () => {
  const declaration = analyzeIntegrity({
    source: "claude",
    rootExists: true,
    rootReadable: true,
    readableTypes: [],
    hasAnyReadableRecord: false,
    hasAnyCompletenessBasis: false
  });
  assert.equal(declaration.status, "possibly-incomplete");
  assert.equal(declaration.undetermined, true);
});

test("消息序号不连续与时间断档均产生缺口", () => {
  const declaration = analyzeIntegrity({
    source: "codex",
    rootExists: true,
    rootReadable: true,
    messageOrdinals: [0, 1, 4],
    messageTimestamps: ["2026-11-04T00:00:00.000Z", "2026-11-04T08:00:00.000Z"],
    hasAnyReadableRecord: true
  });
  assert.ok(declaration.gaps.some((gap) => gap.type === "message-discontinuity"));
  assert.ok(declaration.gaps.some((gap) => gap.type === "time-gap"));
});