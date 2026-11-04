#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import {
  asMessageId,
  asSessionId,
  buildEvidencePackage,
  buildFactReport,
  classifySessions
} from "../packages/core/dist/index.js";

const SESSIONS = Number(process.env.BENCH_SESSIONS ?? 500);
const MESSAGES_PER_SESSION = Number(process.env.BENCH_MESSAGES_PER_SESSION ?? 100);
const day = "2026-11-04";
const sessions = [];
const signals = [];

for (let s = 0; s < SESSIONS; s += 1) {
  const sessionId = asSessionId(`bench-${s}`);
  const messages = [];
  for (let m = 0; m < MESSAGES_PER_SESSION; m += 1) {
    messages.push({
      messageId: asMessageId(`${sessionId}-m${m}`),
      sessionId,
      sourceTool: "codex",
      role: m % 2 === 0 ? "user" : "assistant",
      timestamp: `${day}T08:${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}.000Z`,
      text: m % 3 === 0 ? "修复登录 bug 并补充测试" : `消息 ${m}`
    });
  }
  sessions.push({
    sessionId,
    sourceTool: "codex",
    startedAt: `${day}T08:00:00.000Z`,
    workDir: "/work/project-a",
    messages,
    unknownTypeCount: 0,
    gaps: [],
    sourceFile: `/bench/${sessionId}.jsonl`
  });
  signals.push({
    sessionId,
    sourceTool: "codex",
    workDir: "/work/project-a",
    messages: messages.map((message) => ({ role: message.role, text: message.text }))
  });
}

const totalStart = performance.now();
const classifyStart = performance.now();
const classifications = classifySessions(signals);
const classifyMs = performance.now() - classifyStart;

const reportStart = performance.now();
const report = buildFactReport({
  day,
  dataVersion: "bench",
  sessions,
  classifications,
  tests: [],
  submissions: [],
  adoption: {
    total: 0,
    confirmed: 0,
    inferred: 0,
    notAdopted: 0,
    undeterminable: 0,
    numerator: 0,
    denominator: 0,
    rate: null,
    undeterminableRate: 0,
    reworkCount: 0,
    commitCount: 0,
    revertCount: 0
  },
  research: []
});
const reportMs = performance.now() - reportStart;

const evidenceStart = performance.now();
const pkg = buildEvidencePackage({
  dataVersion: "bench",
  range: { from: day, to: day },
  sessions,
  classifications,
  tests: [],
  submissions: [],
  adoption: [],
  research: [],
  pending: [],
  completeness: { status: "complete", gaps: [], undetermined: false },
  maxEntries: 2000
});
const evidenceMs = performance.now() - evidenceStart;
const totalMs = performance.now() - totalStart;
const memory = process.memoryUsage();

const result = {
  messages: SESSIONS * MESSAGES_PER_SESSION,
  sessions: SESSIONS,
  classifyMs: Math.round(classifyMs),
  reportMs: Math.round(reportMs),
  evidenceMs: Math.round(evidenceMs),
  totalMs: Math.round(totalMs),
  rssMB: Math.round(memory.rss / 1024 / 1024),
  heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
  projects: report.projects.length,
  evidenceEntries: pkg.meta.entryCount,
  trimmed: pkg.trimmed
};

console.log(JSON.stringify(result, null, 2));

if (totalMs > 180_000) {
  console.error("bench: total time exceeds 3 minutes");
  process.exit(1);
}
if (memory.rss > 1.5 * 1024 * 1024 * 1024) {
  console.error("bench: RSS exceeds 1.5 GB");
  process.exit(1);
}