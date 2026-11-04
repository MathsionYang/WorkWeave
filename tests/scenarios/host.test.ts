import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  asConfidence,
  asInstant,
  asMessageId,
  asPlainDate,
  asProjectId,
  asSessionId,
  buildEvidencePackage,
  exportReportAtomic,
  validateSubmission
} from "@workweave/core";
import type {
  AdoptionDecision,
  ClassifiedSession,
  HostSection,
  HostSubmission,
  ParsedSession,
  ResearchFinding,
  SkillSectionKey,
  StructuredEvidencePackage,
  TestFact
} from "@workweave/core";

const day = asPlainDate("2026-11-04");
const sessionId = asSessionId("s1");

const session: ParsedSession = {
  sessionId,
  sourceTool: "codex",
  startedAt: asInstant("2026-11-04T08:00:00.000Z"),
  messages: [
    {
      messageId: asMessageId("m1"),
      sessionId,
      sourceTool: "codex",
      role: "user",
      timestamp: asInstant("2026-11-04T08:01:00.000Z"),
      text: "修复登录 bug"
    }
  ],
  unknownTypeCount: 0,
  gaps: [],
  sourceFile: "/fixtures/s1.jsonl"
};

const classification: ClassifiedSession = {
  sessionId,
  projectId: "project-a",
  category: "debugging",
  secondaryCategories: [],
  basis: "structured-feature",
  confidence: asConfidence(0.8),
  locked: false,
  pending: false,
  reasons: []
};

const failedTest: TestFact = {
  sessionId,
  projectId: asProjectId("project-a"),
  type: "jest",
  command: "npx jest",
  status: "failed",
  failureReason: "1 failed",
  evidenceIds: ["test-1"]
};

const decision: AdoptionDecision = {
  interactionId: "i1",
  status: "confirmed-adopted",
  observationPending: false,
  submissionKeys: ["commit:1"],
  reworkCount: 0,
  reason: "explicit accept with verifiable commit"
};

const research: ResearchFinding = {
  topic: "方案对比",
  question: "A 与 B 如何选择",
  sessionId: "s1",
  day,
  conclusion: "concluded",
  evidence: ["session:s1"]
};

function buildPackage(): StructuredEvidencePackage {
  return buildEvidencePackage({
    dataVersion: "v1",
    range: { from: day, to: day },
    sessions: [session],
    classifications: [classification],
    tests: [failedTest],
    submissions: [],
    adoption: [decision],
    research: [research],
    pending: [],
    completeness: { status: "complete", gaps: [], undetermined: false }
  });
}

const baseSections: Record<SkillSectionKey, HostSection> = {
  completions: { text: "完成登录修复", evidenceIds: ["session:codex:s1"] },
  problems: { text: "根因待确认", evidenceIds: [] },
  tests: { text: "测试失败 1 项", evidenceIds: ["test:s1:npx jest"] },
  optimizations: { text: "无", evidenceIds: [] },
  adoption: { text: "采纳度 50%（分子 1 / 分母 2）", evidenceIds: ["adoption:i1"] },
  research: { text: "调研方案对比，结论已形成", evidenceIds: ["research:s1:0"] }
};

function submission(overrides: Partial<Record<SkillSectionKey, HostSection>> = {}): HostSubmission {
  return {
    packageId: buildPackage().packageId,
    templateVersion: "1.0.0",
    sections: { ...baseSections, ...overrides }
  };
}

test("V-24 按来源拆章被拒绝", () => {
  const result = validateSubmission(
    submission({ completions: { text: "项目 A（Codex）完成登录修复", evidenceIds: ["session:codex:s1"] } }),
    buildPackage()
  );
  assert.equal(result.passed, false);
  assert.ok(result.violations.some((violation) => violation.code === "source-split"));
});

test("V-25 非法百分比被拒绝", () => {
  const result = validateSubmission(
    submission({ adoption: { text: "采纳度 120%（分子 1 / 分母 2）", evidenceIds: ["adoption:i1"] } }),
    buildPackage()
  );
  assert.ok(result.violations.some((violation) => violation.code === "illegal-number"));
});

test("V-26 未执行/失败测试被写成通过时拒绝", () => {
  const result = validateSubmission(
    submission({ tests: { text: "测试通过", evidenceIds: ["test:s1:npx jest"] } }),
    buildPackage()
  );
  assert.ok(result.violations.some((violation) => violation.code === "reference-inconsistent"));
});

test("V-27 同一 callId 重复提交只落盘一次", async () => {
  const { ContractGateway } = await import("@workweave/mcp");
  let count = 0;
  const gateway = new ContractGateway({
    expectedHostId: "workbuddy",
    expectedToken: "token",
    handlers: new Map([
      ["ww_pending_manage", async () => {
        count += 1;
        return { updated: 1 };
      }]
    ])
  });
  const invocation = {
    tool: "ww_pending_manage",
    callId: "V-27",
    auth: { hostId: "workbuddy", token: "token" },
    params: { day: "2026-11-04" }
  };
  await gateway.invoke(invocation);
  await gateway.invoke(invocation);
  assert.equal(count, 1);
});

test("V-28 事实模式报告原子导出且无半成品", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ww-v28-"));
  const target = join(dir, "report.md");
  await exportReportAtomic(target, "# 事实模式报告\n");
  assert.equal(await readFile(target, "utf8"), "# 事实模式报告\n");
  assert.equal((await readdir(dir)).some((file) => file.endsWith(".tmp")), false);
});

test("V-29 待总结模式只生成证据包，不产生报告文件", async () => {
  const pkg = buildPackage();
  assert.ok(pkg.packageId.length > 0);
  assert.equal(pkg.categories.length, 9);
});