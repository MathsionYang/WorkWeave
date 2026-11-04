import type { FactReport } from "./types.js";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

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

function testSummary(tests: readonly { readonly status: string }[]): string {
  const counts = new Map<string, number>();
  for (const test of tests) {
    counts.set(test.status, (counts.get(test.status) ?? 0) + 1);
  }
  return ["passed", "failed", "blocked", "not-run"]
    .filter((status) => (counts.get(status) ?? 0) > 0)
    .map((status) => `${TEST_LABEL[status] ?? status} ${counts.get(status) ?? 0}`)
    .join(" / ");
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
  lines.push(`> 一句话总结：${report.summary ?? "未检测到可读工作结论"}`, "");

  lines.push("## 1. 今日概览", "");
  lines.push(`- 处理会话数：${report.overview.sessions}`);
  lines.push(`- 涉及项目数：${report.overview.projects}`);
  lines.push(
    report.overview.tests === 0
      ? "- 测试记录：—（未检测到测试证据）"
      : `- 测试记录：${report.overview.tests} 条（${testSummary(report.projects.flatMap((project) => project.tests))}）`
  );
  lines.push(`- 失败数：${report.overview.failures}`);
  lines.push(`- 待优化项数：${report.overview.optimizations}`);
  lines.push(`- AI 回答数：${report.overview.aiAnswers}`);
  lines.push(
    `- 采纳状态计数：可确证 ${report.overview.confirmed}，推断 ${report.overview.inferred}，未采纳 ${report.overview.notAdopted}，无法判定 ${report.overview.undeterminable}`
  );
  lines.push(
    report.overview.adoptionRate === null
      ? "- 采纳度：—（无可判定数据）"
      : `- 采纳度：${percent(report.overview.adoptionRate)}（分子 ${report.adoption.numerator} / 分母 ${report.adoption.denominator}）`
  );
  lines.push(`- 代码提交次数：${report.overview.commits}`);
  lines.push(`- 调研条目数：${report.overview.researchItems}`, "");
  lines.push("**下一步建议**", "");
  const nextSteps = report.nextSteps ?? [];
  if (nextSteps.length === 0 || (nextSteps.length === 1 && nextSteps[0]?.startsWith("—"))) {
    lines.push("- 未检测到可执行建议");
  } else {
    for (const step of nextSteps) lines.push(`- ${step}`);
  }
  lines.push("");

  lines.push("## 2. AI 协作与采纳", "");
  if (report.adoption.total === 0) {
    lines.push("- 本日无 AI 交互");
  } else {
    lines.push(`- 可确证采纳：${report.adoption.confirmed}`);
    lines.push(`- 推断采纳：${report.adoption.inferred}`);
    lines.push(`- 未采纳：${report.adoption.notAdopted}`);
    lines.push(`- 可判定样本：${report.adoption.numerator + report.adoption.notAdopted} / ${report.adoption.total}`);
    lines.push(`- 无法判定：${report.adoption.undeterminable}（未检测到明确接受/否定信号或可核对提交）`);
    lines.push(
      report.adoption.denominator === 0
        ? "- 采纳度：—（可判定样本不足，无法形成采纳度结论）"
        : `- 采纳度：${percent(report.adoption.numerator / report.adoption.denominator)}`
    );
    lines.push(`- 返工次数 / 回退提交：${report.adoption.reworkCount} / ${report.adoption.revertCount}`);
    lines.push(
      report.adoption.denominator === 0
        ? "- 洞察：可判定样本不足，当前无法形成可靠的采纳结论"
        : "- 洞察：采纳度仅代表可判定样本，未判定交互不纳入分子分母"
    );
  }
  lines.push("");

  lines.push("## 3. 今日调研", "");
  if (report.research.length === 0) {
    lines.push("- 未检测到调研记录");
  } else {
    for (const finding of report.research) {
      lines.push(`### ${finding.topic}`, "");
      lines.push(`- 问题：${finding.question}`);
      lines.push(
        `- 结论状态：${RESEARCH_LABEL[finding.conclusion] ?? finding.conclusion}${finding.reason === undefined ? "" : `（${finding.reason}）`}`
      );
      lines.push(`- 证据：${finding.evidence.join("、")}`, "");
    }
  }

  lines.push("## 4. 按项目总结", "");
  if (report.projects.length === 0) {
    lines.push("- 未检测到有证据的项目");
  } else {
    for (const project of report.projects) {
      lines.push(`### ${project.projectId}`, "");
      const shares = project.distribution.shares
        .map((share) => `${share.source} ${share.sessions} 会话 / ${share.messages} 消息（${percent(share.share)}）`)
        .join("；");
      lines.push(`- 来源分布：${shares.length > 0 ? shares : "未检测到来源数据"}`);
      lines.push(
        `- 今日任务：${(project.tasks ?? []).length > 0 ? (project.tasks ?? []).join("；") : "未检测到有证据的任务目标"}`
      );
      lines.push(
        `- 今日完成事项：${project.completions.length > 0 ? project.completions.join("；") : "未检测到有证据的关键产出"}`
      );
      lines.push(
        `- 解决的问题：${project.problems.length > 0 ? project.problems.join("；") : "未检测到已解决的问题"}`
      );

      const tests = project.tests;
      if (tests.length === 0) {
        lines.push("- 测试与质量：—（未检测到测试证据）");
      } else {
        const distribution = testSummary(tests);
        const failed = tests.filter((test) => test.status === "failed");
        const failedText =
          failed.length === 0
            ? "质量结论：未检测到失败用例"
            : `质量结论：存在 ${failed.length} 个失败用例（${failed.map((test) => test.failureReason ?? test.type).join("；")}）`;
        lines.push(`- 测试与质量：${distribution || "—"}；${failedText}`);
      }

      const continueItems = [
        ...(project.blockers ?? []).map((item) => `[阻塞] ${item}`),
        ...(project.risks ?? []).map((item) => `[风险] ${item}`),
        ...project.optimizations.map((item) => `[优化] ${item}`)
      ];
      lines.push(
        `- 需要继续优化：${continueItems.length > 0 ? continueItems.join("；") : "未检测到阻塞/风险/待优化项"}`
      );
      lines.push(
        `- 下一步建议：${(project.nextSteps ?? []).length > 0 ? (project.nextSteps ?? []).join("；") : "未检测到可执行建议"}`,
        ""
      );
    }
  }

  lines.push("## 5. 跨项目与未归属事项", "");
  if (report.crossProject.length === 0) lines.push("- 本日无此类内容");
  else for (const sessionId of report.crossProject) lines.push(`- ${sessionId}`);
  lines.push("");

  lines.push("## 6. 纯对话归类摘要", "");
  if (report.pureConversation.length === 0) {
    lines.push("- 本日无此类内容");
  } else {
    for (const summary of report.pureConversation) {
      const sources = summary.sources.map((entry) => `${entry.source} ${entry.sessions}`).join("、");
      lines.push(`- ${summary.kind}：${summary.sessions} 会话（来源：${sources}）`);
    }
  }
  lines.push("");

  lines.push("## 7. 待确认项", "");
  if (report.pending.length === 0) lines.push("- 未检测到待确认项");
  else for (const item of report.pending) lines.push(`- ${item}`);
  lines.push("");

  lines.push("## 8. 证据索引", "");
  if (report.evidenceIndex.length === 0) {
    lines.push("- 未检测到证据引用");
  } else {
    for (const ref of report.evidenceIndex) {
      lines.push(`- ${ref.evidenceId}（${ref.sourceTool} / ${ref.sessionId} / ${ref.timestamp}）`);
    }
  }
  lines.push("");

  if (report.completeness.status === "possibly-incomplete") {
    lines.push("> 本报告标注为“可能不完整”，请核对受影响来源与缺口类型后再使用。", "");
  }
  return lines.join("\n");
}