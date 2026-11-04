import type { TestFact } from "../domain/models.js";
import type { ProjectId, SessionId, TestStatus } from "../domain/types.js";

export interface TestParseInput {
  readonly sessionId: SessionId;
  readonly projectId: ProjectId;
  readonly command: string;
  readonly output: string;
  readonly exitCode?: number;
  readonly truncated?: boolean;
  readonly evidenceIds?: readonly string[];
}

const TEST_COMMAND = /\b(jest|vitest|pytest|npm\s+(run\s+)?test|yarn\s+test|pnpm\s+test|go\s+test|cargo\s+test|mvn\s+test|gradle\s+test)\b/i;
const FAILURE = /(\b\d+\s+failed\b|\bFAIL\b|assertionerror|traceback|E\s+assert|tests? failed|✕|×)/i;
const PASS = /(\b\d+\s+passed\b|\bPASS\b|all tests? passed|✓|ok\b)/i;
const BLOCKED = /(blocked|skipped|无法执行|权限不足|EACCES|EPERM|cannot run)/i;

function inferType(command: string, output: string): string {
  const text = `${command}\n${output}`;
  if (/pytest/i.test(text)) return "pytest";
  if (/vitest/i.test(text)) return "vitest";
  if (/jest/i.test(text)) return "jest";
  if (/go test/i.test(text)) return "go-test";
  if (/cargo test/i.test(text)) return "cargo-test";
  return "generic";
}

function firstFailureLine(output: string): string | undefined {
  const line = output
    .split(/\r?\n/)
    .find((candidate) => FAILURE.test(candidate));
  return line?.trim().slice(0, 300);
}

export function parseTestResult(input: TestParseInput): TestFact {
  const command = input.command.trim();
  const output = input.output;
  const evidenceIds = input.evidenceIds ?? [];

  if (!TEST_COMMAND.test(command) && !TEST_COMMAND.test(output)) {
    return {
      sessionId: input.sessionId,
      projectId: input.projectId,
      type: inferType(command, output),
      command,
      status: "not-run",
      failureReason: "no test command or framework output detected",
      evidenceIds
    };
  }

  if (input.truncated === true && !FAILURE.test(output)) {
    return {
      sessionId: input.sessionId,
      projectId: input.projectId,
      type: inferType(command, output),
      command,
      status: "failed",
      failureReason: "output truncated; pass cannot be confirmed",
      evidenceIds
    };
  }

  if (FAILURE.test(output) || (input.exitCode !== undefined && input.exitCode !== 0)) {
    const reason = firstFailureLine(output) ?? `exit code ${input.exitCode ?? "non-zero"}`;
    return {
      sessionId: input.sessionId,
      projectId: input.projectId,
      type: inferType(command, output),
      command,
      status: "failed",
      failureReason: reason,
      evidenceIds
    };
  }

  if (BLOCKED.test(output)) {
    return {
      sessionId: input.sessionId,
      projectId: input.projectId,
      type: inferType(command, output),
      command,
      status: "blocked",
      failureReason: "test run blocked or skipped",
      evidenceIds
    };
  }

  if (PASS.test(output)) {
    return {
      sessionId: input.sessionId,
      projectId: input.projectId,
      type: inferType(command, output),
      command,
      status: "passed",
      evidenceIds
    };
  }

  return {
    sessionId: input.sessionId,
    projectId: input.projectId,
    type: inferType(command, output),
    command,
    status: "not-run",
    failureReason: "framework output does not provide a conclusive result",
    evidenceIds
  };
}

export function adjudicateTestStatus(
  evidence: {
    readonly failedEvidence: boolean;
    readonly passedEvidence: boolean;
    readonly blockedEvidence: boolean;
    readonly truncated?: boolean;
  }
): TestStatus {
  if (evidence.failedEvidence) return "failed";
  if (evidence.truncated === true) return "failed";
  if (evidence.passedEvidence) return "passed";
  if (evidence.blockedEvidence) return "blocked";
  return "not-run";
}