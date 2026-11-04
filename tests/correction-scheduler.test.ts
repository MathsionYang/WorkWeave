import assert from "node:assert/strict";
import test from "node:test";
import {
  CorrectionService,
  SchedulerService,
  WorkWeaveError
} from "@workweave/core";

test("校正仅本次生效时不生成规则但保留历史", () => {
  const service = new CorrectionService();
  const result = service.correct({
    actorId: "m1",
    tenantId: "t1",
    sessionId: "s1",
    workDir: "/work/project-a",
    sourceTool: "codex",
    field: "project",
    before: "unassigned",
    value: "project-a",
    scope: "once"
  });
  assert.equal(result.rule, undefined);
  assert.equal(service.historyFor("s1").length, 1);
  assert.equal(service.allRules().length, 0);
});

test("校正后续生效时生成可复用规则并按工作目录匹配", () => {
  const service = new CorrectionService();
  const result = service.correct({
    actorId: "m1",
    tenantId: "t1",
    sessionId: "s1",
    workDir: "/work/project-a",
    sourceTool: "codex",
    field: "project",
    before: "unassigned",
    value: "project-a",
    scope: "future"
  });
  assert.ok(result.rule !== undefined);
  assert.equal(service.matchRules({ workDir: "/work/project-a/sub", sourceTool: "codex" }).length, 1);
  assert.equal(service.matchRules({ workDir: "/work/project-b", sourceTool: "codex" }).length, 0);

  const ruleId = result.rule?.id ?? "";
  assert.equal(service.removeRule(ruleId), true);
  assert.equal(service.allRules().length, 0);
});

test("同匹配条件但目标不同的规则冲突时拒绝", () => {
  const service = new CorrectionService();
  service.correct({
    actorId: "m1",
    tenantId: "t1",
    sessionId: "s1",
    workDir: "/work/project-a",
    sourceTool: "codex",
    field: "project",
    before: "unassigned",
    value: "project-a",
    scope: "future"
  });

  assert.throws(
    () =>
      service.correct({
        actorId: "m2",
        tenantId: "t1",
        sessionId: "s2",
        workDir: "/work/project-a",
        sourceTool: "codex",
        field: "project",
        before: "unassigned",
        value: "project-b",
        scope: "future"
      }),
    (error: unknown) => error instanceof WorkWeaveError && error.code === "E-FIX-002"
  );
});

test("定时模式 A 自动导出事实报告", async () => {
  const exported: string[] = [];
  const scheduler = new SchedulerService({
    mode: "fact-auto",
    exportFact: async (day) => {
      exported.push(day);
      return `/out/${day}.md`;
    },
    enqueuePackage: async () => undefined,
    cacheOnly: async () => undefined
  });
  const result = await scheduler.tick("2026-11-04");
  assert.equal(result.action, "exported");
  assert.equal(result.reportPath, "/out/2026-11-04.md");
  assert.deepEqual(exported, ["2026-11-04"]);
});

test("定时模式 B 只入队，模式 C 只缓存", async () => {
  const queued: string[] = [];
  const cached: string[] = [];
  const pending = new SchedulerService({
    mode: "package-pending",
    exportFact: async () => "/never",
    enqueuePackage: async (day) => {
      queued.push(day);
    },
    cacheOnly: async () => undefined
  });
  const cacheOnly = new SchedulerService({
    mode: "cache-only",
    exportFact: async () => "/never",
    enqueuePackage: async () => undefined,
    cacheOnly: async (day) => {
      cached.push(day);
    }
  });

  assert.equal((await pending.tick("2026-11-04")).action, "queued");
  assert.equal((await cacheOnly.tick("2026-11-04")).action, "cached");
  assert.deepEqual(queued, ["2026-11-04"]);
  assert.deepEqual(cached, ["2026-11-04"]);
});

test("休眠跨过的日期被识别为漏执行", () => {
  const scheduler = new SchedulerService({
    mode: "fact-auto",
    exportFact: async () => "/out",
    enqueuePackage: async () => undefined,
    cacheOnly: async () => undefined
  });
  assert.deepEqual(scheduler.detectMissed("2026-11-01", "2026-11-04"), [
    "2026-11-02",
    "2026-11-03",
    "2026-11-04"
  ]);
});