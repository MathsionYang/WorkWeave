import type { FactReport } from "./types.js";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function empty(lines: string[], condition: boolean): void {
  if (condition) lines.push("本日无此类内容", "");
}

export function renderMarkdown(report: FactReport): string {
  const lines: string[] = [];
  lines.push(`# 织迹日报（${report.range.from}）`, "");
  lines.push(`- 数据版本：${report.dataVersion}`);
  lines.push(`- 生成时间：${report.generatedAt}`);
  lines.push(
    report.completeness.status === "possibly-incomplete"
      ? "- 完整性：可能不完整（部分来源记录不完整、被停用或存在采集缺口）"
      : "- 完整性：完整"
  );
  lines.push("");

  lines.push("## 1. 今日概览", "");
  lines.push(`- 处理会话数：${report.overview.sessions}`);
  lines.push(`- 涉及项目数：${report.overview.projects}`);
  lines.push(`- 测试数 / 失败数：${report.overview.tests} / ${report.overview.failures}`);
  lines.push(`- 待优化项数：${report.overview.optimizations}`);
  lines.push(`- AI 回答数：${report.overview.aiAnswers}`);
  lines.push(`- 采纳状态计数：可确证 ${report.overview.confirmed}，推断 ${report.overview.inferred}，未采纳 ${report.overview.notAdopted}，无法判定 ${report.overview.undeterminable}`);
  lines.push(`- 采纳度：${report.overview.adoptionRate === null ? "不适用（无数据）" : percent(report.overview.adoptionRate)}（分子 ${report.adoption.numerator} / 分母 ${report.adoption.denominator}）`);
  lines.push(`- 代码提交次数：${report.overview.commits}`);
  lines.push(`- 调研条目数：${report.overview.researchItems}`, "");

  lines.push("## 2. AI 协作与采纳", "");
  empty(lines, report.adoption.total === 0);
  if (report.adoption.total > 0) {
    lines.push(`- 可确证采纳：${report.adoption.confirmed}`);
    lines.push(`- 推断采纳：${report.adoption.inferred}`);
    lines.push(`- 未采纳：${report.adoption.notAdopted}`);
    lines.push(`- 无法判定：${report.adoption.undeterminable}（无法判定率 ${percent(report.adoption.undeterminableRate)}）`);
    lines.push(`- 返工次数 / 回退提交：${report.adoption.reworkCount} / ${report.adoption.revertCount}`, "");
  }

  lines.push("## 3. 今日调研", "");
  empty(lines, report.research.length === 0);
  for (const finding of report.research) {
    lines.push(`### ${finding.topic}`, "");
    lines.push(`- 问题：${finding.question}`);
    lines.push(`- 结论状态：${finding.conclusion}${finding.reason === undefined ? "" : `（${finding.reason}）`}`);
    lines.push(`- 证据：${finding.evidence.join("、")}`, "");
  }

  lines.push("## 4. 按项目总结", "");
  empty(lines, report.projects.length === 0);
  for (const project of report.projects) {
    lines.push(`### ${project.projectId}`, "");
    const shares = project.distribution.shares
      .map((share) => `${share.source} ${share.sessions} 会话 / ${share.messages} 消息（${percent(share.share)}）`)
      .join("；");
    lines.push(`- 来源分布：${shares.length > 0 ? shares : "本日无此类内容"}${project.distribution.roundingDifference ? "；因四舍五入存在差异" : ""}`);
    lines.push(`- 今日完成事项：${project.completions.length > 0 ? project.completions.join("；") : "未提供"}`);
    lines.push(`- 解决的问题：${project.problems.length > 0 ? project.problems.join("；") : "未提供"}`);
    lines.push(`- 测试记录：${project.tests.length > 0 ? project.tests.map((test) => `${test.type}:${test.status}`).join("；") : "未提供"}`);
    lines.push(`- 需要强化优化项：${project.optimizations.length > 0 ? project.optimizations.join("；") : "未提供"}`, "");
  }

  lines.push("## 5. 跨项目与未归属事项", "");
  empty(lines, report.crossProject.length === 0);
  for (const sessionId of report.crossProject) lines.push(`- ${sessionId}`);
  if (report.crossProject.length > 0) lines.push("");

  lines.push("## 6. 纯对话归类摘要", "");
  empty(lines, report.pureConversation.length === 0);
  for (const summary of report.pureConversation) {
    const sources = summary.sources.map((entry) => `${entry.source} ${entry.sessions}`).join("、");
    lines.push(`- ${summary.kind}：${summary.sessions} 会话（来源：${sources}）`);
  }
  if (report.pureConversation.length > 0) lines.push("");

  lines.push("## 7. 待确认项", "");
  empty(lines, report.pending.length === 0);
  for (const item of report.pending) lines.push(`- ${item}`);
  if (report.pending.length > 0) lines.push("");

  lines.push("## 8. 证据索引", "");
  empty(lines, report.evidenceIndex.length === 0);
  for (const ref of report.evidenceIndex) {
    lines.push(`- ${ref.evidenceId}（${ref.sourceTool} / ${ref.sessionId} / ${ref.timestamp}）`);
  }
  if (report.evidenceIndex.length > 0) lines.push("");

  if (report.completeness.status === "possibly-incomplete") {
    lines.push("> 本报告标注为“可能不完整”，请核对受影响来源与缺口类型后再使用。", "");
  }
  return lines.join("\n");
}