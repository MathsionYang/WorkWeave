import assert from "node:assert/strict";
import test from "node:test";
import {
  asConfidence,
  asInstant,
  asMessageId,
  asPlainDate,
  asProjectId,
  asSessionId,
  buildEvidencePackage,
  degradeFailedSections,
  resolveEvidence,
  validateSubmission
} from "@workweave/core";
import type {
  AdoptionDecision,
  ClassifiedSession,
  HostSubmission,
  HostSection,
  ParsedSession,
  ResearchFinding,
  SkillSectionKey,
  StructuredEvidencePackage,
  SubmissionLike,
  TestFact
} from "@workweave/core";

const sessionId = asSessionId("s1");
const day = asPlainDate("2026-11-04");

const session: ParsedSession = {
  sessionId,
  sourceTool: "codex",
  startedAt: asInstant("2026-11-04T08:00:00.000Z"),
  workDir: "/work/project-a",
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

const testFact: TestFact = {
  sessionId,
  projectId: asProjectId("project-a"),
  type: "jest",
  command: "npx jest",
  status: "failed",
  failureReason: "1 failed",
  evidenceIds: ["test-1"]
};

const submissions: readonly SubmissionLike[] = [
  { dedupKey: "commit:1", kind: "commit", timestamp: asInstant("2026-11-04T09:00:00.000Z") }
];

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

function buildPackage(overrides: Partial<Parameters<typeof buildEvidencePackage>[0]> = {}): StructuredEvidencePackage {
  return buildEvidencePackage({
    dataVersion: "v1",
    range: { from: day, to: day },
    sessions: [session],
    classifications: [classification],
    tests: [testFact],
    submissions,
    adoption: [decision],
    research: [research],
    pending: ["claude:source-type-missing:claude-desktop"],
    completeness: { status: "complete", gaps: [], undetermined: false },
    ...overrides
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

function submission(overrides: Partial<HostSubmission> = {}): HostSubmission {
  return {
    packageId: buildPackage().packageId,
    templateVersion: "1.0.0",
    sections: { ...baseSections },
    ...overrides
  };
}

function withSection(overrides: Partial<Record<SkillSectionKey, HostSection>>): HostSubmission {
  return {
    ...submission(),
    sections: { ...baseSections, ...overrides }
  };
}

test("证据包九类齐全，空类别显式给出原因", () => {
  const pkg = buildPackage({ research: [] });
  assert.equal(pkg.categories.length, 9);
  const researchCategory = pkg.categories.find((entry) => entry.key === "research");
  assert.equal(researchCategory?.present, false);
  assert.ok((researchCategory?.reason ?? "").length > 0);
  assert.equal(pkg.packageId.length, 24);
  assert.ok(pkg.meta.entryCount > 0);
});

test("同一数据版本与范围复用 packageId，不同范围生成新包", () => {
  assert.equal(buildPackage().packageId, buildPackage().packageId);
  assert.notEqual(
    buildPackage().packageId,
    buildPackage({ range: { from: asPlainDate("2026-11-05"), to: asPlainDate("2026-11-05") } }).packageId
  );
});

test("超过上限时按优先级裁剪并标记 trimmed", () => {
  const pkg = buildPackage({ maxEntries: 2 });
  assert.equal(pkg.trimmed, true);
  assert.ok(pkg.meta.removedCount > 0);
  assert.ok(pkg.meta.entryCount <= 2);
});

test("引用可回查，未知引用返回 E-PKG-002", () => {
  const pkg = buildPackage();
  assert.equal(resolveEvidence(pkg, "session:codex:s1").kind, "sessions");
  assert.throws(
    () => resolveEvidence(pkg, "missing"),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "E-PKG-002"
  );
});

test("合法宿主提交通过九维校验", () => {
  const result = validateSubmission(submission(), buildPackage());
  assert.equal(result.passed, true);
  assert.equal(result.violations.length, 0);
});

test("缺失章节、未知证据、敏感内容、禁用表述均被拒绝", () => {
  const pkg = buildPackage();
  const missing = submission({
    sections: {
      completions: { text: "完成登录修复", evidenceIds: [] }
    }
  });
  const missingResult = validateSubmission(missing, pkg);
  assert.equal(missingResult.passed, false);
  assert.ok(missingResult.violations.some((violation) => violation.code === "section-missing"));

  const unknownEvidence = withSection({ tests: { text: "测试失败 1 项", evidenceIds: ["missing"] } });
  assert.ok(
    validateSubmission(unknownEvidence, pkg).violations.some((violation) => violation.code === "unknown-evidence")
  );

  const sensitive = withSection({
    completions: {
      text: "key sk-abcdefghijklmnopqrstuvwxyz123456",
      evidenceIds: ["session:codex:s1"]
    }
  });
  assert.ok(
    validateSubmission(sensitive, pkg).violations.some((violation) => violation.code === "sensitive-content")
  );

  const forbidden = withSection({ completions: { text: "AI 总结如下", evidenceIds: ["session:codex:s1"] } });
  assert.ok(
    validateSubmission(forbidden, pkg).violations.some((violation) => violation.code === "forbidden-phrase")
  );
});

test("超长章节与超限总字数被拒绝", () => {
  const pkg = buildPackage();
  const long = withSection({ completions: { text: "x".repeat(801), evidenceIds: [] } });
  assert.ok(
    validateSubmission(long, pkg).violations.some((violation) => violation.code === "section-too-long")
  );
});

test("二次失败章节降级为事实条目且其余章节保留", () => {
  const pkg = buildPackage();
  const invalid = withSection({ tests: { text: "测试通过", evidenceIds: [] } });
  const result = validateSubmission(invalid, pkg);
  const degraded = degradeFailedSections(invalid, result);
  assert.ok(degraded.degradedSections.includes("tests"));
  assert.ok(degraded.sections.tests.text.includes("未通过校验"));
  assert.equal(degraded.sections.completions.degraded, false);
});