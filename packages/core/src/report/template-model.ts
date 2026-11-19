import { asPlainDate } from "../domain/types.js";
import type { FactReport, OverviewMetrics } from "./types.js";
import type { WeeklyReport } from "./weekly.js";

export interface DailyDistributionRow {
  readonly day: string;
  readonly sessions: number;
  readonly projects: number;
  readonly tests: number;
  readonly failures: number;
}

export interface ReportTemplateModel {
  readonly report: FactReport;
  readonly dailyDistribution: readonly DailyDistributionRow[];
}

function weeklyConclusion(report: WeeklyReport): string {
  const lead = [...report.projects]
    .sort((left, right) => right.completions.length - left.completions.length || left.projectId.localeCompare(right.projectId))
    .find((project) => project.completions.length > 0);
  if (lead === undefined) {
    return report.overview.sessions === 0
      ? "本期没有采集到可供总结的工作记录。"
      : `本期记录了 ${report.overview.sessions} 个会话，尚无可核对的完成结论。`;
  }
  return `本期主要进展集中在${lead.projectId}：${lead.completions[0]}`;
}

export function toReportTemplateModel(input: FactReport | WeeklyReport): ReportTemplateModel {
  if (!("dailyDistribution" in input)) {
    return {
      report: input,
      dailyDistribution: [{
        day: input.range.from,
        sessions: input.overview.sessions,
        projects: input.overview.projects,
        tests: input.overview.tests,
        failures: input.overview.failures
      }]
    };
  }

  const overview: OverviewMetrics = input.overview;
  const report: FactReport = {
    reportType: "weekly",
    range: { from: asPlainDate(input.range.from), to: asPlainDate(input.range.to) },
    dataVersion: input.dataVersion,
    generatedAt: input.generatedAt,
    overview,
    summary: weeklyConclusion(input),
    nextSteps: [...new Set(input.projects.flatMap((project) => project.nextSteps ?? []))],
    adoption: input.adoption,
    research: input.research,
    projects: input.projects,
    crossProject: [],
    pureConversation: [],
    pending: [],
    evidenceIndex: [],
    completeness: input.completeness
  };
  return { report, dailyDistribution: input.dailyDistribution };
}
