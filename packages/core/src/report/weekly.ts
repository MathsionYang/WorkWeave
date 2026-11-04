import { createHash } from "node:crypto";
import type { FactReport, OverviewMetrics, ProjectReportSection, ReportCompleteness } from "./types.js";
import type { AdoptionStats } from "../adoption/engine.js";
import type { ResearchFinding } from "../adoption/research.js";
import type { SourceShare, TestFact } from "../domain/models.js";
import type { SourceTool } from "../domain/types.js";
import { asPlainDate } from "../domain/types.js";

export interface WeeklyReport {
  readonly reportType: "weekly";
  readonly range: { readonly from: string; readonly to: string };
  readonly days: readonly string[];
  readonly missingDays: readonly string[];
  readonly dataVersion: string;
  readonly generatedAt: string;
  readonly overview: OverviewMetrics & { readonly days: number };
  readonly adoption: AdoptionStats;
  readonly research: readonly ResearchFinding[];
  readonly projects: readonly ProjectReportSection[];
  readonly completeness: ReportCompleteness;
}

function sumAdoption(reports: readonly FactReport[]): AdoptionStats {
  const total = reports.reduce((sum, report) => sum + report.adoption.total, 0);
  const confirmed = reports.reduce((sum, report) => sum + report.adoption.confirmed, 0);
  const inferred = reports.reduce((sum, report) => sum + report.adoption.inferred, 0);
  const notAdopted = reports.reduce((sum, report) => sum + report.adoption.notAdopted, 0);
  const undeterminable = reports.reduce((sum, report) => sum + report.adoption.undeterminable, 0);
  const numerator = confirmed + inferred;
  const denominator = confirmed + inferred + notAdopted;
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
    reworkCount: reports.reduce((sum, report) => sum + report.adoption.reworkCount, 0),
    commitCount: reports.reduce((sum, report) => sum + report.adoption.commitCount, 0),
    revertCount: reports.reduce((sum, report) => sum + report.adoption.revertCount, 0)
  };
}

function sharesOf(bySource: Map<SourceTool, { sessions: number; messages: number }>, totalMessages: number): readonly SourceShare[] {
  return [...bySource.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, value]) => ({
      source,
      sessions: value.sessions,
      messages: value.messages,
      share: totalMessages === 0 ? 0 : Number((value.messages / totalMessages).toFixed(4)),
      completeness: "complete",
      gaps: []
    }));
}

interface ProjectAccumulator {
  sessions: number;
  messages: number;
  bySource: Map<SourceTool, { sessions: number; messages: number }>;
  tests: TestFact[];
  tasks: string[];
  completions: string[];
  problems: string[];
  optimizations: string[];
  risks: string[];
  blockers: string[];
  nextSteps: string[];
}

function pushUnique(target: string[], values: readonly string[] | undefined, limit = 10): void {
  for (const value of values ?? []) {
    if (!target.includes(value) && target.length < limit) target.push(value);
  }
}

function mergeProjects(reports: readonly FactReport[]): readonly ProjectReportSection[] {
  const map = new Map<string, ProjectAccumulator>();

  for (const report of reports) {
    for (const project of report.projects) {
      const entry: ProjectAccumulator = map.get(project.projectId) ?? {
        sessions: 0,
        messages: 0,
        bySource: new Map<SourceTool, { sessions: number; messages: number }>(),
        tests: [],
        tasks: [],
        completions: [],
        problems: [],
        optimizations: [],
        risks: [],
        blockers: [],
        nextSteps: []
      };
      entry.sessions += project.distribution.totalSessions;
      entry.messages += project.distribution.totalMessages;
      for (const share of project.distribution.shares) {
        const source = entry.bySource.get(share.source) ?? { sessions: 0, messages: 0 };
        source.sessions += share.sessions;
        source.messages += share.messages;
        entry.bySource.set(share.source, source);
      }
      entry.tests.push(...project.tests);
      pushUnique(entry.tasks, project.tasks);
      pushUnique(entry.completions, project.completions);
      pushUnique(entry.problems, project.problems);
      pushUnique(entry.optimizations, project.optimizations);
      pushUnique(entry.risks, project.risks);
      pushUnique(entry.blockers, project.blockers);
      pushUnique(entry.nextSteps, project.nextSteps);
      map.set(project.projectId, entry);
    }
  }

  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([projectId, entry]) => ({
    projectId,
    distribution: {
      projectId: projectId as ProjectReportSection["distribution"]["projectId"],
      range: {
        from: asPlainDate(reports[0]?.range.from ?? "1970-01-01"),
        to: asPlainDate(reports.at(-1)?.range.to ?? "1970-01-01")
      },
      totalSessions: entry.sessions,
      totalMessages: entry.messages,
      shares: sharesOf(entry.bySource, entry.messages),
      roundingDifference: false
    },
    tasks: entry.tasks,
    completions: entry.completions,
    problems: entry.problems,
    tests: entry.tests,
    optimizations: entry.optimizations,
    risks: entry.risks,
    blockers: entry.blockers,
    nextSteps: entry.nextSteps
  }));
}

export function buildWeeklyReport(
  reports: readonly FactReport[],
  expectedDays?: readonly string[]
): WeeklyReport {
  const days = [...new Set(reports.map((report) => String(report.range.from)))].sort();
  const missingDays = expectedDays?.filter((day) => !days.includes(day)) ?? [];
  const adoption = sumAdoption(reports);
  const projectIds = new Set(reports.flatMap((report) => report.projects.map((project) => project.projectId)));
  const overview = {
    sessions: reports.reduce((sum, report) => sum + report.overview.sessions, 0),
    projects: projectIds.size,
    tests: reports.reduce((sum, report) => sum + report.overview.tests, 0),
    failures: reports.reduce((sum, report) => sum + report.overview.failures, 0),
    optimizations: reports.reduce((sum, report) => sum + report.overview.optimizations, 0),
    aiAnswers: adoption.total,
    confirmed: adoption.confirmed,
    inferred: adoption.inferred,
    notAdopted: adoption.notAdopted,
    undeterminable: adoption.undeterminable,
    adoptionRate: adoption.rate,
    commits: adoption.commitCount,
    researchItems: reports.reduce((sum, report) => sum + report.overview.researchItems, 0),
    days: days.length
  };

  const incomplete = reports.some((report) => report.completeness.status === "possibly-incomplete");
  const hash = createHash("sha256");
  for (const report of [...reports].sort((a, b) => a.range.from.localeCompare(b.range.from))) {
    hash.update(`${report.range.from}:${report.dataVersion}|`);
  }

  return {
    reportType: "weekly",
    range: {
      from: days[0] ?? "",
      to: days.at(-1) ?? ""
    },
    days,
    missingDays,
    dataVersion: hash.digest("hex").slice(0, 16),
    generatedAt: new Date().toISOString(),
    overview,
    adoption,
    research: reports.flatMap((report) => report.research),
    projects: mergeProjects(reports),
    completeness: {
      status: incomplete ? "possibly-incomplete" : "complete",
      declarations: reports.flatMap((report) => report.completeness.declarations),
      disabledSources: [...new Set(reports.flatMap((report) => report.completeness.disabledSources))]
    }
  };
}