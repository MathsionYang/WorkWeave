import type { PlainDate, ResearchConclusionStatus } from "../domain/types.js";
import { isNoiseText } from "../facts/noise.js";

export interface ResearchMessage {
  readonly sessionId: string;
  readonly title?: string;
  readonly day: PlainDate;
  readonly messages: readonly { readonly text?: string; readonly role?: string }[];
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

const RESEARCH = /(调研|研究|查阅|对比|评估|探索|research|benchmark|compare)/i;
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
  const title = input.title !== undefined && !isNoiseText(input.title) ? input.title : undefined;
  const messages = input.messages
    .map((message) => (message.text ?? "").trim())
    .filter((text) => text.length > 0 && !isNoiseText(text));
  const userMessages = input.messages
    .filter((message) => message.role === undefined || message.role === "user")
    .map((message) => (message.text ?? "").trim())
    .filter((text) => text.length > 0 && !isNoiseText(text));

  const titleHasIntent = title !== undefined && RESEARCH.test(title);
  const intentMessage = userMessages.find((value) => RESEARCH.test(value));
  if (!titleHasIntent && intentMessage === undefined) return [];

  const question = intentMessage ?? title ?? "未命名调研";
  const topic = (titleHasIntent ? title ?? question : question).replace(/\s+/g, " ").trim().slice(0, 80);
  const conclusion = conclusionOf([title ?? "", ...messages].join("\n"));

  return [
    {
      topic: topic.length > 0 ? topic : "未命名调研",
      question: question.replace(/\s+/g, " ").trim().slice(0, 200),
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