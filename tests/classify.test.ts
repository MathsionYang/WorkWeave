import assert from "node:assert/strict";
import test from "node:test";
import {
  asMessageId,
  asSessionId,
  checkConsistency,
  classifySession,
  classifySessions
} from "@workweave/core";
import type { ClassificationSignal } from "@workweave/core";

function signal(overrides: Partial<ClassificationSignal> = {}): ClassificationSignal {
  return {
    sessionId: asSessionId("s1"),
    sourceTool: "codex",
    workDir: "/work/project-a",
    title: "修复登录问题",
    messages: [
      { role: "user", text: "帮我修复登录 bug" },
      { role: "assistant", text: "已修复并补充测试" }
    ],
    ...overrides
  };
}

test("人工覆盖优先且锁定", () => {
  const result = classifySession(signal(), {
    manualOverrides: [{ sessionId: asSessionId("s1"), projectId: "project-x", category: "testing" }],
    rules: [{ id: "r1", name: "workdir rule", priority: "configured-rule", workDirPrefix: "/work", projectId: "project-a" }]
  });
  assert.equal(result.projectId, "project-x");
  assert.equal(result.category, "testing");
  assert.equal(result.basis, "manual");
  assert.equal(result.locked, true);
  assert.ok(result.confidence >= 0.9);
});

test("配置规则按工作目录归属项目", () => {
  const result = classifySession(signal(), {
    rules: [
      { id: "r1", name: "project-a rule", priority: "configured-rule", workDirPrefix: "/work/project-a", projectId: "project-a" }
    ]
  });
  assert.equal(result.projectId, "project-a");
  assert.equal(result.basis, "configured-rule");
  assert.equal(result.locked, false);
  assert.ok(result.reasons.some((reason) => reason.includes("project-a rule")));
});

test("规则未覆盖时按关键词识别调试类别", () => {
  const result = classifySession(signal());
  assert.equal(result.category, "debugging");
  assert.equal(result.basis, "structured-feature");
});

test("无交付物时归入纯对话并细分子类", () => {
  const result = classifySession(
    signal({
      workDir: undefined,
      title: undefined,
      filePaths: [],
      messages: [{ role: "user", text: "什么是事件循环" }]
    })
  );
  assert.equal(result.category, "pure-conversation");
  assert.equal(result.pureConversationKind, "knowledge-qa");
});

test("跨仓库文件路径判 cross-project", () => {
  const result = classifySession(
    signal({ filePaths: ["/repo-a/src/a.ts", "/repo-b/src/b.ts"] })
  );
  assert.equal(result.projectId, "cross-project");
  assert.ok(result.reasons.some((reason) => reason.includes("multiple repositories")));
});

test("归类一致性校验计数之和等于会话数", () => {
  const signals = [
    signal({ sessionId: asSessionId("s1") }),
    signal({ sessionId: asSessionId("s2"), messages: [{ role: "user", text: "今天进度如何" }] })
  ];
  const classifications = classifySessions(signals);
  const report = checkConsistency(signals, classifications);
  assert.equal(report.consistent, true);
  assert.equal(report.projectSum, 2);
  assert.equal(report.categorySum, 2);
  assert.equal(report.conflicts.length, 0);
  assert.equal(asMessageId("m1"), "m1");
});