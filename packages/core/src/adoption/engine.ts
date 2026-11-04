import type { AdoptionStatus, Instant, MessageId, MessageRole, SessionId } from "../domain/types.js";
import { asMessageId } from "../domain/types.js";

export interface MessageLike {
  readonly messageId: MessageId;
  readonly role: MessageRole;
  readonly timestamp: Instant;
  readonly text?: string;
}

export interface Interaction {
  readonly interactionId: string;
  readonly sessionId: SessionId;
  readonly questionMessageIds: readonly MessageId[];
  readonly answerMessageIds: readonly MessageId[];
  readonly questionText: string;
  readonly answerText: string;
  readonly answeredAt: Instant;
  readonly followUpText?: string;
}

export type DialogSignal =
  | "explicit-accept"
  | "explicit-reject"
  | "follow-up"
  | "rework-request"
  | "replacement"
  | "progress";

const ACCEPT = /(谢谢|感谢|可以了|没问题|采纳|就这样|很好|解决了|works|thanks|looks good|lgtm)/i;
const REJECT = /(不对|不行|不是这样|不要|没用|错误|不对吧|doesn'?t work|wrong|not right)/i;
const REWORK = /(重做|重新|再做|换个方案|改用|restart|redo|try again)/i;
const REPLACE = /(换成|替代|改为|instead|replace)/i;
const FOLLOW = /(那|还有|另外|再问|那么|what about|also|then)/i;
const PROGRESS = /(继续|下一步|推进|go on|next)/i;

export function detectDialogSignal(text: string): DialogSignal | undefined {
  if (text.trim().length === 0) return undefined;
  if (REWORK.test(text)) return "rework-request";
  if (REPLACE.test(text)) return "replacement";
  if (REJECT.test(text)) return "explicit-reject";
  if (ACCEPT.test(text)) return "explicit-accept";
  if (PROGRESS.test(text)) return "progress";
  if (FOLLOW.test(text)) return "follow-up";
  return undefined;
}

export function pairInteractions(sessionId: SessionId, messages: readonly MessageLike[]): readonly Interaction[] {
  const interactions: Interaction[] = [];
  let current: { questions: MessageId[]; answers: MessageId[]; questionText: string; answerText: string } | undefined;
  const flush = (followUpText?: string): void => {
    if (current === undefined) return;
    const answeredAt = messages.find((message) => message.messageId === current?.answers[0])?.timestamp;
    if (answeredAt === undefined) {
      current = undefined;
      return;
    }
    interactions.push({
      interactionId: `${sessionId}-i${interactions.length + 1}`,
      sessionId,
      questionMessageIds: [...current.questions],
      answerMessageIds: [...current.answers],
      questionText: current.questionText,
      answerText: current.answerText,
      answeredAt,
      ...(followUpText !== undefined ? { followUpText } : {})
    });
    current = undefined;
  };

  for (const message of messages) {
    if (message.role === "user") {
      flush(message.text);
      current = {
        questions: [message.messageId],
        answers: [],
        questionText: message.text ?? "",
        answerText: ""
      };
    } else if (message.role === "assistant" && current !== undefined) {
      current.answers.push(message.messageId);
      current.answerText = `${current.answerText}${current.answerText.length > 0 ? "\n" : ""}${message.text ?? ""}`;
    }
  }
  flush();
  return interactions;
}

export interface SubmissionLike {
  readonly dedupKey: string;
  readonly kind: "commit" | "revert" | "file-change";
  readonly timestamp?: Instant;
}

export interface AdoptionDecision {
  readonly interactionId: string;
  readonly status: AdoptionStatus;
  readonly observationPending: boolean;
  readonly submissionKeys: readonly string[];
  readonly reworkCount: number;
  readonly reason: string;
}

export interface AdoptionWindow {
  readonly fromMs: number;
  readonly toMs: number;
  readonly stillOpen: boolean;
}

function windowFor(interaction: Interaction, windowMs: number, nowMs: number): AdoptionWindow {
  const fromMs = Date.parse(interaction.answeredAt);
  const toMs = fromMs + windowMs;
  return { fromMs, toMs, stillOpen: nowMs < toMs };
}

export function decideAdoption(
  interaction: Interaction,
  submissions: readonly SubmissionLike[],
  windowMs: number,
  nowMs: number,
): AdoptionDecision {
  const window = windowFor(interaction, windowMs, nowMs);
  const inWindow = submissions.filter((submission) => {
    if (submission.timestamp === undefined) return false;
    const at = Date.parse(submission.timestamp);
    return at >= window.fromMs && at <= window.toMs;
  });
  const commits = inWindow.filter((submission) => submission.kind === "commit");
  const rework = inWindow.filter((submission) => submission.kind === "revert");
  const signal = detectDialogSignal(interaction.followUpText ?? "");

  if (window.stillOpen) {
    return {
      interactionId: interaction.interactionId,
      status: "undeterminable",
      observationPending: true,
      submissionKeys: commits.map((submission) => submission.dedupKey),
      reworkCount: rework.length,
      reason: "observation window still open"
    };
  }

  if (signal === "explicit-reject" || signal === "rework-request") {
    return {
      interactionId: interaction.interactionId,
      status: "not-adopted",
      observationPending: false,
      submissionKeys: commits.map((submission) => submission.dedupKey),
      reworkCount: rework.length,
      reason: `dialog signal: ${signal}`
    };
  }

  if (signal === "explicit-accept" && commits.length > 0) {
    return {
      interactionId: interaction.interactionId,
      status: "confirmed-adopted",
      observationPending: false,
      submissionKeys: commits.map((submission) => submission.dedupKey),
      reworkCount: rework.length,
      reason: "explicit accept with verifiable commit"
    };
  }

  if (signal === "explicit-accept") {
    return {
      interactionId: interaction.interactionId,
      status: "inferred-adopted",
      observationPending: false,
      submissionKeys: [],
      reworkCount: rework.length,
      reason: "explicit accept without commit evidence"
    };
  }

  return {
    interactionId: interaction.interactionId,
    status: "undeterminable",
    observationPending: false,
    submissionKeys: commits.map((submission) => submission.dedupKey),
    reworkCount: rework.length,
    reason: "no conclusive dialog signal"
  };
}

export interface AdoptionStats {
  readonly total: number;
  readonly confirmed: number;
  readonly inferred: number;
  readonly notAdopted: number;
  readonly undeterminable: number;
  readonly numerator: number;
  readonly denominator: number;
  readonly rate: number | null;
  readonly undeterminableRate: number;
  readonly reworkCount: number;
  readonly commitCount: number;
  readonly revertCount: number;
}

export function aggregateAdoption(decisions: readonly AdoptionDecision[], submissions: readonly SubmissionLike[]): AdoptionStats {
  const confirmed = decisions.filter((decision) => decision.status === "confirmed-adopted").length;
  const inferred = decisions.filter((decision) => decision.status === "inferred-adopted").length;
  const notAdopted = decisions.filter((decision) => decision.status === "not-adopted").length;
  const undeterminable = decisions.filter((decision) => decision.status === "undeterminable").length;
  const numerator = confirmed + inferred;
  const denominator = confirmed + inferred + notAdopted;
  const total = decisions.length;

  return {
    total,
    confirmed,
    inferred,
    notAdopted,
    undeterminable,
    numerator,
    denominator,
    rate: denominator === 0 ? null : numerator / denominator,
    undeterminableRate: total === 0 ? 0 : undeterminable / total,
    reworkCount: decisions.reduce((sum, decision) => sum + decision.reworkCount, 0),
    commitCount: submissions.filter((submission) => submission.kind === "commit").length,
    revertCount: submissions.filter((submission) => submission.kind === "revert").length
  };
}

export function adoptSubmissionKeys(decisions: readonly AdoptionDecision[]): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const decision of decisions) {
    if (decision.status === "confirmed-adopted" || decision.status === "inferred-adopted") {
      for (const key of decision.submissionKeys) keys.add(key);
    }
  }
  return keys;
}

export function asInteractionMessageId(value: string): MessageId {
  return asMessageId(value);
}