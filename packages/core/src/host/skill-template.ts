export const SKILL_TEMPLATE_VERSION = "1.0.0";

export type SkillSectionKey =
  | "completions"
  | "problems"
  | "tests"
  | "optimizations"
  | "adoption"
  | "research";

export const SKILL_SECTION_KEYS: readonly SkillSectionKey[] = [
  "completions",
  "problems",
  "tests",
  "optimizations",
  "adoption",
  "research"
];

export interface SkillTemplateSection {
  readonly key: SkillSectionKey;
  readonly title: string;
  readonly required: boolean;
  readonly maxChars: number;
  readonly minEvidenceRefs: number;
  readonly instruction: string;
}

export interface SkillTemplate {
  readonly templateVersion: string;
  readonly totalMaxChars: number;
  readonly globalInstruction: string;
  readonly sections: readonly SkillTemplateSection[];
}

export const SKILL_TEMPLATE: SkillTemplate = {
  templateVersion: SKILL_TEMPLATE_VERSION,
  totalMaxChars: 4000,
  globalInstruction:
    "报告只陈述有证据支持的事实与结论。禁止输出方法论说明、覆盖率/回归覆盖免责声明、对本次总结过程的自我评价，以及“下次重做/重走一遍”之类的后续提示；这些内容不得进入报告正文或附录。",
  sections: [
    {
      key: "completions",
      title: "今日完成",
      required: true,
      maxChars: 800,
      minEvidenceRefs: 0,
      instruction: "只陈述有证据支持的完成事项，不得推断未发生的工作"
    },
    {
      key: "problems",
      title: "解决的问题",
      required: true,
      maxChars: 800,
      minEvidenceRefs: 0,
      instruction: "按问题、根因、方案、状态呈现；根因缺失时标注待确认"
    },
    {
      key: "tests",
      title: "测试结果",
      required: true,
      maxChars: 800,
      minEvidenceRefs: 1,
      instruction: "只引用事实层测试结果，不得把未执行写成通过"
    },
    {
      key: "optimizations",
      title: "待优化项",
      required: true,
      maxChars: 800,
      minEvidenceRefs: 0,
      instruction: "列出类型、优先级与闭环状态"
    },
    {
      key: "adoption",
      title: "AI 协作与采纳",
      required: true,
      maxChars: 800,
      minEvidenceRefs: 1,
      instruction: "同时给出采纳分子、分母、状态分布与无法判定率，不做个人排名"
    },
    {
      key: "research",
      title: "今日调研",
      required: true,
      maxChars: 800,
      minEvidenceRefs: 1,
      instruction: "给出调研主题、结论状态、原因与最小证据；失败与未决必须说明原因"
    }
  ]
};

export function isSkillSectionKey(value: string): value is SkillSectionKey {
  return (SKILL_SECTION_KEYS as readonly string[]).includes(value);
}

export function getSkillTemplate(): SkillTemplate {
  return SKILL_TEMPLATE;
}