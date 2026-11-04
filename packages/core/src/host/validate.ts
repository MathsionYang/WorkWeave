import type { StructuredEvidencePackage } from "../evidence/package.js";
import { resolveEvidence } from "../evidence/package.js";
import { redact, totalHits } from "../infra/sanitizer/index.js";
import { WorkWeaveError } from "../domain/errors.js";
import {
  SKILL_TEMPLATE,
  isSkillSectionKey,
  type SkillSectionKey,
  type SkillTemplate
} from "./skill-template.js";

export interface HostSection {
  readonly text: string;
  readonly evidenceIds: readonly string[];
}

export interface HostSubmission {
  readonly packageId: string;
  readonly templateVersion: string;
  readonly hostId?: string;
  readonly sections: Readonly<Partial<Record<SkillSectionKey, HostSection>>>;
}

export type ViolationCode =
  | "package-mismatch"
  | "template-version-mismatch"
  | "unknown-section"
  | "section-missing"
  | "section-empty"
  | "section-too-long"
  | "total-too-long"
  | "missing-evidence"
  | "unknown-evidence"
  | "sensitive-content"
  | "forbidden-phrase"
  | "illegal-number"
  | "source-split"
  | "reference-inconsistent"
  | "meta-commentary";

export interface ValidationViolation {
  readonly code: ViolationCode;
  readonly section?: SkillSectionKey;
  readonly message: string;
}

export interface ValidationResult {
  readonly passed: boolean;
  readonly violations: readonly ValidationViolation[];
}

const FORBIDDEN_PHRASES: readonly RegExp[] = [
  /AI\s*总结/i,
  /自动生成/i,
  /绩效/i,
  /排名第/,
  /token\s*成本/i,
  /模型判断/i,
  /大概/,
  /应该是/
];

const SOURCE_SPLIT = /[（(](codex|claude|workbuddy|dsh)[）)]/i;
const SOURCE_SPLIT_SECTION = /项目[^。\n]*[（(](codex|claude|workbuddy|dsh)[）)]/i;
const PASS_CLAIM = /(通过|passed|成功|全部通过)/i;
const META_COMMENTARY =
  /(可复跑用例|复跑用例|回归覆盖|不代表回归|不代表[^。\n]*覆盖|未固化(为)?[^。\n]*用例|没有固化(为)?[^。\n]*用例|下次[^。\n]*重走|还需重走|重走一遍|无法保证回归|未形成回归|不在本次覆盖|覆盖不到|生成链路|链路说明|生成过程|采集流程|数据处理流程|报告生成说明)/i;

function totalSessions(pkg: StructuredEvidencePackage): number {
  return pkg.categories.find((category) => category.key === "sessions")?.items.length ?? 0;
}

export function validateSubmission(
  submission: HostSubmission,
  pkg: StructuredEvidencePackage,
  template: SkillTemplate = SKILL_TEMPLATE
): ValidationResult {
  const violations: ValidationViolation[] = [];

  if (submission.packageId !== pkg.packageId) {
    violations.push({ code: "package-mismatch", message: `packageId ${submission.packageId} does not match ${pkg.packageId}` });
  }
  if (submission.templateVersion !== template.templateVersion) {
    violations.push({
      code: "template-version-mismatch",
      message: `template version ${submission.templateVersion} does not match ${template.templateVersion}`
    });
  }

  for (const key of Object.keys(submission.sections)) {
    if (!isSkillSectionKey(key)) {
      violations.push({ code: "unknown-section", message: `unknown section: ${key}` });
    }
  }

  let totalChars = 0;
  for (const spec of template.sections) {
    const section = submission.sections[spec.key];
    if (section === undefined) {
      violations.push({ code: "section-missing", section: spec.key, message: `missing section: ${spec.title}` });
      continue;
    }
    if (section.text.trim().length === 0) {
      violations.push({ code: "section-empty", section: spec.key, message: `empty section: ${spec.title}` });
      continue;
    }

    totalChars += section.text.length;
    if (section.text.length > spec.maxChars) {
      violations.push({
        code: "section-too-long",
        section: spec.key,
        message: `section ${spec.title} exceeds ${spec.maxChars} characters`
      });
    }

    if (section.evidenceIds.length < spec.minEvidenceRefs) {
      violations.push({
        code: "missing-evidence",
        section: spec.key,
        message: `section ${spec.title} requires at least ${spec.minEvidenceRefs} evidence reference(s)`
      });
    }

    for (const evidenceId of section.evidenceIds) {
      try {
        const item = resolveEvidence(pkg, evidenceId);
        if (item.kind === "tests" && PASS_CLAIM.test(section.text) && item.meta?.status === "failed") {
          violations.push({
            code: "reference-inconsistent",
            section: spec.key,
            message: `section ${spec.title} claims passing tests but evidence ${evidenceId} is failed`
          });
        }
      } catch (error) {
        if (error instanceof WorkWeaveError && error.code === "E-PKG-002") {
          violations.push({
            code: "unknown-evidence",
            section: spec.key,
            message: `evidence reference not found in package: ${evidenceId}`
          });
        } else {
          throw error;
        }
      }
    }

    if (SOURCE_SPLIT.test(section.text) || SOURCE_SPLIT_SECTION.test(section.text)) {
      violations.push({
        code: "source-split",
        section: spec.key,
        message: `section ${spec.title} splits a project by source; projects must be merged into one section`
      });
    }

    if (totalHits(redact(section.text, "report")) > 0) {
      violations.push({
        code: "sensitive-content",
        section: spec.key,
        message: `section ${spec.title} contains unredacted sensitive content`
      });
    }

    for (const pattern of FORBIDDEN_PHRASES) {
      if (pattern.test(section.text)) {
        violations.push({
          code: "forbidden-phrase",
          section: spec.key,
          message: `section ${spec.title} contains forbidden phrase ${pattern}`
        });
      }
    }

    if (META_COMMENTARY.test(section.text)) {
      violations.push({
        code: "meta-commentary",
        section: spec.key,
        message: `section ${spec.title} contains methodology or coverage commentary`
      });
    }

    for (const match of section.text.matchAll(/(\d+(?:\.\d+)?)%/g)) {
      const value = Number(match[1]);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        violations.push({
          code: "illegal-number",
          section: spec.key,
          message: `section ${spec.title} contains out-of-range percentage ${match[0]}`
        });
      }
    }

    if (spec.key === "adoption" && /会话数\s*[:：]\s*(\d+)/.test(section.text)) {
      const match = section.text.match(/会话数\s*[:：]\s*(\d+)/);
      if (match !== null && Number(match[1]) > totalSessions(pkg)) {
        violations.push({
          code: "illegal-number",
          section: spec.key,
          message: `adoption section session count exceeds package total ${totalSessions(pkg)}`
        });
      }
    }
  }

  if (totalChars > template.totalMaxChars) {
    violations.push({
      code: "total-too-long",
      message: `submission exceeds total limit ${template.totalMaxChars} characters`
    });
  }

  return { passed: violations.length === 0, violations };
}

export interface DegradedSection {
  readonly text: string;
  readonly evidenceIds: readonly string[];
  readonly degraded: boolean;
}

export interface DegradedSubmission {
  readonly sections: Readonly<Record<SkillSectionKey, DegradedSection>>;
  readonly degradedSections: readonly SkillSectionKey[];
}

export function degradeFailedSections(
  submission: HostSubmission,
  result: ValidationResult,
  template: SkillTemplate = SKILL_TEMPLATE
): DegradedSubmission {
  const failed = new Set(
    result.violations
      .map((violation) => violation.section)
      .filter((section): section is SkillSectionKey => section !== undefined)
  );

  const sections = {} as Record<SkillSectionKey, DegradedSection>;
  for (const spec of template.sections) {
    const original = submission.sections[spec.key];
    const degraded = failed.has(spec.key) || original === undefined;
    sections[spec.key] = {
      text: degraded
        ? `未通过校验：${result.violations.filter((violation) => violation.section === spec.key).map((violation) => violation.code).join(",") || "missing"}`
        : (original?.text ?? ""),
      evidenceIds: original?.evidenceIds ?? [],
      degraded
    };
  }

  return {
    sections,
    degradedSections: [...failed]
  };
}