import type { PlainDate, ResearchConclusionStatus } from "../domain/types.js";

export interface ResearchMessage {
  readonly sessionId: string;
  readonly title?: string;
  readonly day: PlainDate;
  readonly messages: readonly { readonly text?: string }[];
}

export interface ResearchFinding {
  readonly topic: string;
  readonly question: string;
  readonly sessionId: string;
  readonly day: PlainDate;
  readonly conclusion: ResearchConclusionStatus;
  readonly reason?: string;
  readonly evidence: readonly string[];
  readonly crossDay?: boolean;
}

const RESEARCH = /(调研|研究|查阅|对比|评估|验证|探索|research|benchmark|compare)/i;
const CONCLUDED = /(结论|已确认|验证通过|可以确定|决定采用|concluded)/i;
const FAILED = /(验证失败|不成立|不可行|失败|failed|not viable)/i;
const COLLECTING = /(收集中|继续查|待补充|still collecting)/i;

function conclusionOf(text: string): { readonly status: ResearchConclusionStatus; readonly reason?: string } {
  if (FAILED.test(text)) return { status: "verification-failed", reason: "verification failed" };
  if (CONCLUDED.test(text)) return { status: "concluded" };
  if (COLLECTING.test(text)) return { status: "collecting", reason: "information still being collected" };
  return { status: "undecided", reason: "no conclusion stated" };
}

export function detectResearchFindings(input: ResearchMessage): readonly ResearchFinding[] {
  const text = [
    input.title ?? "",
    ...input.messages.map((message) => message.text ?? "")
  ].join("\n");
  if (!RESEARCH.test(text)) return [];

  const question =
    input.messages.find((message) => (message.text ?? "").trim().length > 0)?.text ??
    input.title ??
    "untitled research";
  const conclusion = conclusionOf(text);
  return [
    {
      topic: (input.title ?? question).trim().slice(0, 120),
      question: question.trim().slice(0, 300),
      sessionId: input.sessionId,
      day: input.day,
      conclusion: conclusion.status,
      ...(conclusion.reason !== undefined ? { reason: conclusion.reason } : {}),
      evidence: [`session:${input.sessionId}`]
    }
  ];
}

export function aggregateResearch(findings: readonly ResearchFinding[]): readonly ResearchFinding[] {
  const byTopic = new Map<string, ResearchFinding>();
  for (const finding of findings) {
    const key = finding.topic.toLowerCase();
    const existing = byTopic.get(key);
    if (existing === undefined) {
      byTopic.set(key, finding);
      continue;
    }
    byTopic.set(key, {
      ...existing,
      evidence: [...new Set([...existing.evidence, ...finding.evidence])],
      crossDay: existing.day !== finding.day,
      conclusion: existing.conclusion === "concluded" ? existing.conclusion : finding.conclusion
    });
  }
  return [...byTopic.values()];
}