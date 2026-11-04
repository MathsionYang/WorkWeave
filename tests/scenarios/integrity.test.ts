import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ProbeService,
  analyzeIntegrity,
  asPlainDate,
  buildEvidencePackage,
  buildFactReport,
  renderMarkdown,
  aggregateAdoption
} from "@workweave/core";
import type { ParsedSession } from "@workweave/core";

const range = { from: asPlainDate("2026-11-04"), to: asPlainDate("2026-11-04") };

function session(): ParsedSession {
  return {
    sessionId: "s1" as never,
    sourceTool: "claude",
    startedAt: "2026-11-04T08:00:00.000Z" as never,
    messages: [],
    unknownTypeCount: 0,
    gaps: [],
    sourceFile: "/fixtures/s1.jsonl"
  };
}

test("V-16 Claude 仅有 Code 记录时判部分可用", () => {
  const declaration = analyzeIntegrity({
    source: "claude",
    rootExists: true,
    rootReadable: true,
    readableTypes: ["code"],
    hasAnyReadableRecord: true
  });
  assert.equal(declaration.status, "possibly-incomplete");
  assert.ok(declaration.gaps.some((gap) => gap.type === "source-type-missing"));
});

test("V-17 正文缺失生成 body-missing 缺口", () => {
  const declaration = analyzeIntegrity({
    source: "workbuddy",
    rootExists: true,
    rootReadable: true,
    emptyBodyMessageCount: 2,
    hasAnyReadableRecord: true
  });
  assert.equal(declaration.gaps.find((gap) => gap.type === "body-missing")?.affectedCount, 2);
});

test("V-18 消息序号不连续生成 message-discontinuity", () => {
  const declaration = analyzeIntegrity({
    source: "codex",
    rootExists: true,
    rootReadable: true,
    messageOrdinals: [0, 2, 3],
    hasAnyReadableRecord: true
  });
  assert.ok(declaration.gaps.some((gap) => gap.type === "message-discontinuity"));
});

test("V-19 索引差集生成 session-missing 并记录受影响数量", () => {
  const declaration = analyzeIntegrity({
    source: "claude",
    rootExists: true,
    rootReadable: true,
    indexSessionIds: ["a", "b", "c"],
    readableSessionIds: ["a"],
    hasAnyReadableRecord: true
  });
  assert.equal(declaration.gaps.find((gap) => gap.type === "session-missing")?.affectedCount, 2);
});

test("V-20 部分可用来源使报告与 Markdown 标注可能不完整", () => {
  const report = buildFactReport({
    day: range.from,
    dataVersion: "v1",
    sessions: [session()],
    classifications: [],
    tests: [],
    submissions: [],
    adoption: aggregateAdoption([], []),
    research: [],
    completenessBySource: {
      claude: {
        status: "possibly-incomplete",
        gaps: [{ type: "source-type-missing", source: "claude", scope: "claude-desktop", basis: "missing desktop chat" }],
        undetermined: false
      }
    }
  });
  assert.equal(report.completeness.status, "possibly-incomplete");
  assert.ok(renderMarkdown(report).includes("可能不完整"));
});

test("V-21 证据包携带完整性声明与九类空类别原因", () => {
  const pkg = buildEvidencePackage({
    dataVersion: "v1",
    range,
    sessions: [session()],
    classifications: [],
    tests: [],
    submissions: [],
    adoption: [],
    research: [],
    pending: [],
    completeness: {
      status: "possibly-incomplete",
      gaps: [{ type: "source-type-missing", source: "claude", scope: "claude-desktop", basis: "missing desktop chat" }],
      undetermined: false
    }
  });
  assert.equal(pkg.completeness.status, "possibly-incomplete");
  assert.equal(pkg.categories.length, 9);
  assert.equal(pkg.categories.find((category) => category.key === "tests")?.present, false);
});

test("V-22 Claude 布局补齐后重探为 discovered", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ww-v-integrity-"));
  await mkdir(join(dir, ".claude", "projects"), { recursive: true });
  const service = new ProbeService();
  const first = await service.probe({ source: "claude", platform: "win32", homeDir: dir, env: {} });
  assert.equal(first.status, "partially-available");

  await mkdir(join(dir, "AppData", "Roaming", "Claude"), { recursive: true });
  service.invalidate("claude");
  const second = await service.probe({ source: "claude", platform: "win32", homeDir: dir, env: {} });
  assert.equal(second.status, "discovered");
  assert.equal(second.completeness.status, "complete");
});

test("V-23 主动失效缓存后返回最新完整性结论", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ww-v-integrity-"));
  await mkdir(join(dir, ".claude", "projects"), { recursive: true });
  const service = new ProbeService();
  const first = await service.probe({ source: "claude", platform: "linux", homeDir: dir, env: {} });
  assert.equal(first.status, "partially-available");

  await mkdir(join(dir, ".config", "Claude"), { recursive: true });
  service.invalidate();
  const second = await service.probe({ source: "claude", platform: "linux", homeDir: dir, env: {} });
  assert.equal(second.status, "discovered");
  assert.notEqual(second.completeness.status, "possibly-incomplete");
});