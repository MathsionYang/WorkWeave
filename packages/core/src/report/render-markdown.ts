import type { FactReport } from "./types.js";
import type { WeeklyReport } from "./weekly.js";
import { toReportTemplateModel } from "./template-model.js";

const TEST_LABEL: Readonly<Record<string, string>> = {
  passed: "通过",
  failed: "失败",
  blocked: "阻塞",
  "not-run": "未执行"
};

const RESEARCH_LABEL: Readonly<Record<string, string>> = {
  concluded: "已形成结论",
  collecting: "收集中",
  "verification-failed": "验证失败",
  undecided: "未决"
};

function periodLabel(report: FactReport): string {
  return report.reportType === "weekly" ? "近一周工作报告" : "工作日报";
}

function testCounts(tests: readonly { readonly status: string }[]): string {
  const counts = new Map<string, number>();
  for (const test of tests) counts.set(test.status, (counts.get(test.status) ?? 0) + 1);
  const parts = ["passed", "failed", "blocked", "not-run"]
    .filter((status) => (counts.get(status) ?? 0) > 0)
    .map((status) => `${TEST_LABEL[status]} ${counts.get(status)}`);
  return parts.length === 0 ? "未检测到测试证据" : parts.join(" / ");
}

function projectHeading(project: FactReport["projects"][number]): string {
  return `### ${project.projectId}`;
}

export function renderMarkdown(input: FactReport | WeeklyReport): string {
  const { report, dailyDistribution } = toReportTemplateModel(input);
  const label = periodLabel(report);
  const lines = [
    `# 织迹${label}（${report.range.from}${report.reportType === "weekly" ? ` 至 ${report.range.to}` : ""}）`,
    "",
    "## 本期结论",
    "",
    `**${report.summary ?? "本期没有采集到可核对的工作结论。"}**`,
    "",
    "## 1. 工作进展",
    "",
    "### 1.1 日度分布",
    "",
    "| 日期 | 会话 | 项目 | 测试 | 失败 |",
    "|---|---:|---:|---:|---:|"
  ];

  if (dailyDistribution.length === 0) {
    lines.push("| — | 0 | 0 | 0 | 0 |", "");
  } else {
    for (const row of dailyDistribution) {
      lines.push(`| ${row.day} | ${row.sessions} | ${row.projects} | ${row.tests} | ${row.failures} |`);
    }
    lines.push("");
  }

  lines.push("### 1.2 按项目归集", "");
  if (report.projects.length === 0) {
    lines.push("- 未检测到有证据的项目。", "");
  } else {
    for (const project of [...report.projects].sort((left, right) => left.projectId.localeCompare(right.projectId))) {
      const sources = project.distribution.shares
        .map((share) => `${share.source} ${share.sessions} 会话 / ${share.messages} 消息`)
        .join("；") || "未检测到来源数据";
      lines.push(
        projectHeading(project),
        "",
        `- 工作量：${project.distribution.totalSessions} 个会话，${project.distribution.totalMessages} 条消息（${sources}）`,
        `- 任务：${project.tasks?.slice(0, 4).join("；") || "未检测到可核对的任务"}`,
        `- 完成：${project.completions.slice(0, 4).join("；") || "未检测到可核对的完成事项"}`,
        ""
      );
    }
  }

  lines.push("## 2. 问题与质量", "", "### 2.1 解决的问题", "");
  const problemProjects = report.projects
    .map((project) => ({ project, problems: project.problems.slice(0, 4) }))
    .filter((item) => item.problems.length > 0);
  if (problemProjects.length === 0) lines.push("- 未检测到有证据的已解决问题。", "");
  else {
    for (const { project, problems } of problemProjects) lines.push(`- **${project.projectId}**：${problems.join("；")}`);
    lines.push("");
  }

  lines.push("### 2.2 测试结果", "");
  const tests = report.projects.flatMap((project) => project.tests);
  lines.push(`- 汇总：${testCounts(tests)}`);
  if (tests.length > 0) {
    for (const project of report.projects) {
      if (project.tests.length === 0) continue;
      const summary = testCounts(project.tests);
      const failures = project.tests
        .filter((test) => test.status === "failed")
        .map((test) => test.failureReason ?? test.type);
      lines.push(`- **${project.projectId}**：${summary}${failures.length > 0 ? `；失败项：${failures.slice(0, 4).join("；")}` : ""}`);
    }
  }
  lines.push("", "## 3. 调研与行动", "", "### 3.1 本期调研", "");
  if (report.research.length === 0) lines.push("- 未检测到调研记录。", "");
  else {
    for (const finding of report.research) {
      lines.push(`- **${finding.topic}**：${RESEARCH_LABEL[finding.conclusion] ?? finding.conclusion}；${finding.question}`);
    }
    lines.push("");
  }

  lines.push("### 3.2 待优化项", "");
  const actions = report.projects.flatMap((project) => [
    ...(project.risks ?? []).map((item) => `**${project.projectId}｜风险**：${item}`),
    ...project.optimizations.filter((item) => !(project.todos ?? []).includes(item) && !/(?:TODO|待办|待完成|尚未完成|未完成|仍需|还需|还要|下一步|接下来|后续(?:需要|要|应|计划|补充|完善|修复|实现)|计划(?:完成|补充|修复|实现|完善|继续|进行)|需要继续|需要补充|需要修复|需要实现|需要完善)/i.test(item)).slice(0, 4).map((item) => `**${project.projectId}｜优化**：${item}`)
  ]);
  if (actions.length === 0) lines.push("- 未检测到有证据的待优化事项。", "");
  else lines.push(...[...new Set(actions)].map((action) => `- ${action}`), "");

  lines.push("## 4. 待办事项", "");
  const todos = report.projects.flatMap((project) =>
    (project.todos ?? []).map((todo) => `- **${project.projectId}**：${todo}`)
  );
  const uniqueTodos = [...new Set(todos)];
  if (uniqueTodos.length === 0) lines.push("- 未检测到明确待办事项。", "");
  else lines.push(...uniqueTodos, "");

  return lines.join("\n");
}
