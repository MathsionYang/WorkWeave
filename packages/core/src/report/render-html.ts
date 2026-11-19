import type { FactReport, ProjectReportSection } from "./types.js";
import type { WeeklyReport } from "./weekly.js";
import { toReportTemplateModel } from "./template-model.js";

const TEST_LABEL: Readonly<Record<string, string>> = {
  passed: "通过",
  failed: "失败",
  blocked: "阻塞",
  "not-run": "未执行"
};
import type { FactLine, WorkstreamInsight } from "./insights.js";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

const SOURCE_LABEL: Readonly<Record<string, string>> = {
  codex: "Codex",
  claude: "Claude",
  workbuddy: "WorkBuddy",
  dsh: "dsh"
};

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function dateInfo(plain: string): { year: string; month: number; day: string; weekday: string; monthEn: string } {
  const parts = plain.split("-");
  const year = parts[0] ?? "0000";
  const month = Number(parts[1] ?? "1");
  const day = parts[2] ?? "01";
  const weekdayIndex = new Date(Number(year), month - 1, Number(day)).getDay();
  return {
    year,
    month,
    day: pad2(Number(day)),
    weekday: WEEKDAYS[weekdayIndex] ?? "",
    monthEn: MONTHS[month - 1] ?? ""
  };
}

function clockOf(iso: string | undefined): string {
  if (iso === undefined) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function stampOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function sourceName(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

function chip(source: string): string {
  return `<span class="src src-${escapeHtml(source)}">${escapeHtml(sourceName(source))}</span>`;
}

/** 数字在句子里轻微加重，方便扫读。传入已转义文本。 */
function emphasizeNumbers(escaped: string): string {
  return escaped.replace(
    /(\d+(?:\.\d+)?)\s*(项|个|条|张|份|次|处|行|轮|%|分钟|秒)/g,
    "<b class=\"num\">$1$2</b>"
  );
}

function factText(line: FactLine): string {
  return emphasizeNumbers(escapeHtml(line.text));
}

/* ---------------------------------- 图表 --------------------------------- */

interface Datum {
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

const PALETTE = ["#2b6a6e", "#b04a2f", "#3f5170", "#9a7b3f", "#6a6f7d", "#8c5a7a"];

function emptyState(reason: string): string {
  return `<div class="empty"><span>未检测到数据</span><em>${escapeHtml(reason)}</em></div>`;
}

function donut(data: readonly Datum[], caption: string): string {
  const visible = data.filter((item) => item.value > 0);
  const total = visible.reduce((sum, item) => sum + item.value, 0);
  if (total === 0) return emptyState(caption);

  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const arcs = visible.map((item) => {
    const length = (item.value / total) * circumference;
    const arc = `<circle r="${radius}" cx="60" cy="60" fill="none" stroke="${item.color}" stroke-width="14"
      stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 60 60)"></circle>`;
    offset += length;
    return arc;
  });

  const legend = visible
    .map(
      (item) =>
        `<li><i style="background:${item.color}"></i><span>${escapeHtml(item.label)}</span><b>${item.value}</b></li>`
    )
    .join("");

  return `<div class="donut-wrap">
    <svg viewBox="0 0 120 120" role="img" aria-label="${escapeHtml(
      visible.map((item) => `${item.label} ${item.value}`).join("，")
    )}">${arcs.join("")}<text x="60" y="57" class="donut-total">${total}</text><text x="60" y="72" class="donut-unit">合计</text></svg>
    <ul class="legend">${legend}</ul>
  </div>`;
}

function bars(data: readonly Datum[], reason: string): string {
  const visible = data.filter((item) => item.value > 0).slice(0, 8);
  if (visible.length === 0) return emptyState(reason);

  const max = Math.max(...visible.map((item) => item.value), 1);
  const width = 250;
  const row = 38;
  const height = visible.length * row;

  const rows = visible
    .map((item, index) => {
      const barWidth = Math.max(3, (item.value / max) * width);
      const y = index * row;
      const label = item.label.length > 14 ? `${item.label.slice(0, 13)}…` : item.label;
      return `<text x="0" y="${y + 10}" class="bar-label">${escapeHtml(label)}</text>
        <text x="${width}" y="${y + 10}" class="bar-value" text-anchor="end">${item.value}</text>
        <rect x="0" y="${y + 17}" width="${width}" height="6" rx="3" class="bar-track"></rect>
        <rect x="0" y="${y + 17}" width="${barWidth.toFixed(1)}" height="6" rx="3" fill="${item.color}"></rect>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" class="bars-svg" role="img" aria-label="${escapeHtml(
    visible.map((item) => `${item.label} ${item.value}`).join("，")
  )}">${rows}</svg>`;
}

function segmented(data: readonly Datum[], reason: string): string {
  const visible = data.filter((item) => item.value > 0);
  const total = visible.reduce((sum, item) => sum + item.value, 0);
  if (total === 0) return emptyState(reason);

  const segments = visible
    .map(
      (item) =>
        `<span class="seg" style="width:${((item.value / total) * 100).toFixed(2)}%;background:${item.color}" title="${escapeHtml(
          item.label
        )} ${item.value}"></span>`
    )
    .join("");
  const legend = visible
    .map(
      (item) =>
        `<li><i style="background:${item.color}"></i><span>${escapeHtml(item.label)}</span><b>${item.value}</b></li>`
    )
    .join("");

  return `<div class="seg-wrap"><div class="seg-bar">${segments}</div><ul class="legend legend-row">${legend}</ul></div>`;
}

function sourceData(report: FactReport): readonly Datum[] {
  const counts = new Map<string, number>();
  for (const project of report.projects) {
    for (const share of project.distribution.shares) {
      counts.set(share.source, (counts.get(share.source) ?? 0) + share.messages);
    }
  }
  return [...counts.entries()].map(([label, value], index) => ({
    label: sourceName(label),
    value,
    color: PALETTE[index % PALETTE.length] ?? "#6a6f7d"
  }));
}

function testData(report: FactReport): readonly Datum[] {
  const counts = new Map<string, number>();
  for (const project of report.projects) {
    for (const test of project.tests) {
      counts.set(test.status, (counts.get(test.status) ?? 0) + 1);
    }
  }
  const order = [
    ["passed", "通过", "#2f7d5c"],
    ["failed", "失败", "#b3402f"],
    ["blocked", "阻塞", "#b07d24"],
    ["not-run", "未执行", "#9aa0ad"]
  ] as const;
  return order
    .filter(([status]) => (counts.get(status) ?? 0) > 0)
    .map(([status, label, color]) => ({ label, value: counts.get(status) ?? 0, color }));
}

function projectData(report: FactReport): readonly Datum[] {
  return [...report.projects]
    .sort((left, right) => right.distribution.totalMessages - left.distribution.totalMessages)
    .map((project, index) => ({
      label: project.projectId,
      value: project.distribution.totalMessages,
      color: PALETTE[index % PALETTE.length] ?? "#6a6f7d"
    }));
}

/* ---------------------------------- 版块 --------------------------------- */

function dateRangeText(report: FactReport): string {
  const from = dateInfo(report.range.from);
  if (report.range.from === report.range.to) {
    return `${from.year} 年 ${from.month} 月 ${Number(from.day)} 日`;
  }
  const to = dateInfo(report.range.to);
  return `${from.month} 月 ${Number(from.day)} 日 – ${to.month} 月 ${Number(to.day)} 日`;
}

function projectRange(project: ProjectReportSection): string {
  const times = (project.workstreams ?? [])
    .map((item) => clockOf(item.tag.at))
    .filter((item) => item.length > 0)
    .sort();
  if (times.length === 0) return "";
  const first = times[0] ?? "";
  const last = times[times.length - 1] ?? "";
  return first === last ? first : `${first} – ${last}`;
}

function projectSourceChips(project: ProjectReportSection): string {
  return project.distribution.shares
    .filter((share) => share.messages > 0)
    .map((share) => chip(share.source))
    .join("");
}

interface Totals {
  readonly outcomes: number;
  readonly workstreams: number;
  readonly testsPassed: number;
  readonly testsTotal: number;
}

function totalsOf(report: FactReport): Totals {
  return report.projects.reduce<Totals>(
    (acc, project) => {
      const metrics = project.metrics;
      if (metrics === undefined) {
        return {
          outcomes: acc.outcomes + project.completions.length,
          workstreams: acc.workstreams + 1,
          testsPassed: acc.testsPassed,
          testsTotal: acc.testsTotal
        };
      }
      return {
        outcomes: acc.outcomes + metrics.outcomes,
        workstreams: acc.workstreams + metrics.workstreams,
        testsPassed: acc.testsPassed + metrics.testsPassed,
        testsTotal: acc.testsTotal + metrics.testsTotal
      };
    },
    { outcomes: 0, workstreams: 0, testsPassed: 0, testsTotal: 0 }
  );
}

function ledger(report: FactReport): string {
  const totals = totalsOf(report);

  const items: string[] = [
    `<div class="cell"><span class="k">可核对产出</span><span class="v">${totals.outcomes}</span><span class="u">项</span><span class="n">跨 ${report.overview.projects} 个项目</span></div>`,
    `<div class="cell"><span class="k">工作线</span><span class="v">${totals.workstreams}</span><span class="u">条</span><span class="n">来自 ${report.overview.sessions} 个会话</span></div>`,
    totals.testsTotal > 0
      ? `<div class="cell"><span class="k">测试通过</span><span class="v">${totals.testsPassed}</span><span class="u">/ ${totals.testsTotal}</span><span class="n">${
          report.overview.failures > 0 ? `${report.overview.failures} 例失败待修` : "无失败用例"
        }</span></div>`
    : `<div class="cell"><span class="k">测试记录</span><span class="v">0</span><span class="u">项</span><span class="n">未检测到测试证据</span></div>`,
    `<div class="cell"><span class="k">待推进</span><span class="v">${report.overview.optimizations}</span><span class="u">项</span><span class="n">优化与遗留</span></div>`
  ];

  return `<section class="ledger">${items.join("")}</section>`;
}

function ledeText(report: FactReport): string {
  const totals = totalsOf(report);
  if (report.overview.sessions === 0) {
    return `${dateRangeText(report)}没有采集到可用于分析的会话记录，下面仅保留结构。`;
  }

  const top = [...report.projects]
    .filter((project) => (project.metrics?.outcomes ?? project.completions.length) > 0)
    .sort(
      (left, right) =>
        (right.metrics?.outcomes ?? right.completions.length) - (left.metrics?.outcomes ?? left.completions.length)
    )[0];
  let head: string;
  if (top !== undefined) {
    const outcomes = top.workstreams?.flatMap((stream) => stream.outcomes.map((line) => line.text)) ?? top.completions;
    const keyOutcome = outcomes[0] ?? top.completions[0] ?? "完成阶段性工作";
    head = `结论：${escapeHtml(top.projectId)} 的主要进展是“${escapeHtml(keyOutcome)}”`;
  } else {
    head = `结论：${dateRangeText(report)}有 ${report.overview.sessions} 个会话记录，但未检测到可核对的完成事项`;
  }
  head += `。本期涉及 ${report.overview.projects} 个项目、${totals.workstreams} 条工作线，共识别 ${totals.outcomes} 项产出`;
  if (totals.testsPassed > 0) head += `、${totals.testsPassed} 项测试验证通过`;
  if (report.overview.failures > 0) head += `；另有 ${report.overview.failures} 项测试失败需要优先处理`;
  else if (report.overview.optimizations > 0) head += `；另有 ${report.overview.optimizations} 项待优化`;
  head += "。";
  return head;
}

function cover(report: FactReport): string {
  const info = dateInfo(report.range.from);
  const weekly = report.reportType === "weekly";
  return `<header class="cover">
  <div class="brandrow">
    <div class="brand"><span class="brand-mark">织</span><span class="brand-name">织迹<em>WorkWeave</em></span></div>
    <div class="brand-meta">数据版本 ${escapeHtml(report.dataVersion.slice(0, 8))}<span class="dot">·</span>生成于 ${escapeHtml(
      stampOf(report.generatedAt)
    )}</div>
  </div>
  <div class="cover-main">
    <div class="cover-left">
      <p class="eyebrow">${weekly ? "WEEKLY" : "DAILY"} WORK REPORT</p>
      <h1>${weekly ? "近一周工作报告" : "工作日报"}</h1>
      <p class="cover-date">${escapeHtml(dateRangeText(report))}${weekly ? "" : `<span>${info.weekday}</span>`}</p>
    </div>
    <div class="cover-mark"><span class="big">${info.day}</span><span class="small">${info.monthEn}</span></div>
  </div>
</header>`;
}

function researchSection(report: FactReport): string {
  if (report.research.length === 0) {
    return `<section class="strip strip-quiet">
  <h3>3.1 本期调研</h3>
  <p class="quiet">${
    report.overview.sessions === 0
      ? "本期没有可供分析的会话记录。"
      : "本期会话集中在实现与验证，没有形成需要单列的调研议题。"
  }</p>
</section>`;
  }
  const rows = report.research
    .map((finding) => {
      const labels: Readonly<Record<string, string>> = {
        concluded: "已形成结论",
        collecting: "信息收集",
        "verification-failed": "验证未通过",
        undecided: "未决"
      };
      return `<li><span class="rq">${escapeHtml(finding.topic)}</span><span class="rc">${escapeHtml(
        labels[finding.conclusion] ?? finding.conclusion
      )}</span><p>${escapeHtml(finding.question)}</p></li>`;
    })
    .join("");
  return `<section class="strip">
  <h3>3.1 本期调研</h3>
  <ul class="research">${rows}</ul>
</section>`;
}

function sameLine(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replace(/[\s，。；、,.;:「」【】（）()]/g, "");
  const a = normalize(left);
  const b = normalize(right);
  if (a.length === 0 || b.length === 0) return false;
  return a === b || (a.length > 8 && b.includes(a)) || (b.length > 8 && a.includes(b));
}

function outcomesOf(workstream: WorkstreamInsight): readonly FactLine[] {
  const filtered = workstream.outcomes.filter((line) => !sameLine(line.text, workstream.title));
  return (filtered.length > 0 ? filtered : workstream.outcomes).slice(0, 3);
}

function workstreamBlock(workstream: WorkstreamInsight, index: number): string {
  const outcomes = outcomesOf(workstream);
  const tests = workstream.tests;
  const testChips: string[] = [];
  if (tests.passed > 0) testChips.push(`<span class="tchip t-pass">通过 ${tests.passed}</span>`);
  if (tests.failed > 0) testChips.push(`<span class="tchip t-fail">失败 ${tests.failed}</span>`);
  if (tests.blocked > 0) testChips.push(`<span class="tchip t-block">阻塞 ${tests.blocked}</span>`);
  if (tests.notRun > 0) testChips.push(`<span class="tchip t-run">未执行 ${tests.notRun}</span>`);

  const resultList =
    outcomes.length === 0
      ? ""
      : `<ul class="results">${outcomes
          .map((line) => {
            const sameSource = line.tag.source === workstream.tag.source;
            const meta = sameSource
              ? clockOf(line.tag.at)
              : `${sourceName(line.tag.source)} ${clockOf(line.tag.at)}`;
            return `<li><span class="tick"></span><span class="txt">${factText(line)}</span><span class="meta">${escapeHtml(
              meta
            )}</span></li>`;
          })
          .join("")}</ul>`;

  return `<article class="ws">
  <div class="ws-head">
    <span class="ws-no">${pad2(index + 1)}</span>
    <h3>${escapeHtml(workstream.title)}</h3>
    <span class="ws-tag">${chip(workstream.tag.source)}<time>${clockOf(workstream.tag.at)}</time></span>
  </div>
  ${resultList}
  ${testChips.length > 0 ? `<div class="ws-tests">${testChips.join("")}</div>` : ""}
</article>`;
}

function dedupeList(items: readonly string[], against: readonly string[], limit: number): readonly string[] {
  const key = (value: string): string =>
    value
      .replace(/^\[(高|中|低)\]\s*/, "")
      .replace(/^(推进优化|跟进问题|修复失败测试|解除阻塞|处理风险)[：:]\s*/, "")
      .replace(/[（(]项目：[^）)]*[）)]/g, "")
      .replace(/[\s，。；、,.;:]/g, "")
      .slice(0, 14);
  const seen = new Set(against.map(key));
  const output: string[] = [];
  for (const item of items) {
    const current = key(item);
    if (current.length === 0 || seen.has(current)) continue;
    seen.add(current);
    output.push(item);
    if (output.length >= limit) break;
  }
  return output;
}

function gainBlock(project: ProjectReportSection): string {
  const metrics = project.metrics;
  const outcomes = metrics?.outcomes ?? project.completions.length;
  const parts: string[] = [`${outcomes} 项产出`];
  if (metrics !== undefined && metrics.testsTotal > 0) {
    parts.push(`${metrics.testsPassed}/${metrics.testsTotal} 测试通过`);
  }
  if (metrics !== undefined && metrics.commits > 0) parts.push(`${metrics.commits} 次提交`);
  const problems = metrics?.problems ?? project.problems.length;
  if (problems > 0) parts.push(`${problems} 个问题跟进`);
  const optimizations = metrics?.optimizations ?? project.optimizations.length;
  if (optimizations > 0) parts.push(`${optimizations} 项待优化`);
  if (parts.length === 1 && outcomes === 0) return "";
  return `<div class="gain"><span class="k">本期收益</span><span class="v">${emphasizeNumbers(
    escapeHtml(parts.join("  ·  "))
  )}</span></div>`;
}

function projectCard(project: ProjectReportSection, includeTail = true): string {
  const workstreams = project.workstreams ?? [];
  const shown = workstreams.filter((item) => outcomesOf(item).length > 0 || item.tests.passed + item.tests.failed > 0);
  const visible = shown.length > 0 ? shown : workstreams;

  const nextItems = dedupeList(
    [...(project.nextSteps ?? []), ...project.optimizations],
    [...project.completions, ...project.problems],
    4
  );

  const problemItems = dedupeList(project.problems, project.completions, 2);

  const body = visible.length > 0
    ? `<div class="ws-list">${visible.map((item, index) => workstreamBlock(item, index)).join("")}</div>`
    : `<p class="quiet">该项目的会话未产生可核对的产出记录。</p>`;

  const problems =
    problemItems.length === 0
      ? ""
      : `<div class="sub">
      <h4>遇到的问题</h4>
      <ul class="plain">${problemItems.map((item) => `<li>${emphasizeNumbers(escapeHtml(item))}</li>`).join("")}</ul>
    </div>`;

  const next =
    nextItems.length === 0
      ? ""
      : `<div class="sub sub-next">
      <h4>下一步优化</h4>
      <ol class="todo">${nextItems
        .map(
          (item) =>
            `<li><span class="arrow">→</span><span>${emphasizeNumbers(
              escapeHtml(item.replace(/^\[(高|中|低)\]\s*/, ""))
            )}</span></li>`
        )
        .join("")}</ol>
    </div>`;

  const both = problems.length > 0 && next.length > 0;
  const tail = !includeTail ||
    problems.length === 0 && next.length === 0
      ? ""
      : `<div class="sub-grid${both ? "" : " single"}">${problems}${next}</div>`;

  const range = projectRange(project);

  return `<article class="project">
  <div class="project-head">
    <div class="project-id">
      <h2>${escapeHtml(project.projectId)}</h2>
      <div class="project-meta">${projectSourceChips(project)}<span class="dim">${
        project.distribution.totalSessions
      } 条工作线<span class="dot">·</span>${project.distribution.totalMessages} 条消息${
        range.length > 0 ? `<span class="dot">·</span>${escapeHtml(range)}` : ""
      }</span></div>
    </div>
  </div>
  ${gainBlock(project)}
  ${body}
  ${tail}
</article>`;
}

function projectsSection(report: FactReport, includeTail = true): string {
  if (report.projects.length === 0) {
    return `<section class="projects">
  <h3>1.2 按项目归集</h3>
  ${emptyState("本期没有归属到项目的会话")}
</section>`;
  }

  const ordered = [...report.projects].sort((left, right) => {
    const leftScore = (left.metrics?.outcomes ?? left.completions.length) * 10 + (left.metrics?.messages ?? 0) / 1000;
    const rightScore = (right.metrics?.outcomes ?? right.completions.length) * 10 + (right.metrics?.messages ?? 0) / 1000;
    return rightScore - leftScore;
  });

  const workstreamCount = ordered.reduce(
    (sum, project) => sum + (project.metrics?.workstreams ?? project.workstreams?.length ?? 1),
    0
  );

  return `<section class="projects">
  <h3>1.2 按项目归集</h3>
  <p class="quiet">${ordered.length} 个项目<span class="dot">·</span>${workstreamCount} 条工作线</p>
  ${ordered.map((project) => projectCard(project, includeTail)).join("\n")}
</section>`;
}

function chartsSection(report: FactReport): string {
  if (report.overview.sessions === 0) return "";
  const cells = [
    `<figure class="board-cell"><figcaption>项目工作量<span>按消息数</span></figcaption><div class="board-body">${bars(
      projectData(report),
      "本期无项目消息"
    )}</div></figure>`,
    `<figure class="board-cell"><figcaption>测试四态<span>按用例数</span></figcaption><div class="board-body">${segmented(
      testData(report),
      "本期无测试记录"
    )}</div></figure>`,
    `<figure class="board-cell"><figcaption>来源分布<span>按消息数</span></figcaption><div class="board-body">${donut(
      sourceData(report),
      "本期无来源消息"
    )}</div></figure>`
  ];

  return `<section class="viz">
  <div class="viz-board">${cells.join("")}</div>
</section>`;
}

/* ---------------------------------- 样式 --------------------------------- */

const STYLE = `
*,*::before,*::after{box-sizing:border-box}
:root{
  --paper:#f6f5f1;--card:#fff;--ink:#14161a;--ink2:#3d4350;--muted:#8d92a1;
  --line:#e6e4de;--line-soft:#f0eee8;--accent:#b04a2f;--teal:#2b6a6e;
  --green:#2f7d5c;--amber:#b07d24;--red:#b3402f;
}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);
  font-family:"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,-apple-system,sans-serif;
  font-size:14px;line-height:1.65;-webkit-font-smoothing:antialiased}
.doc{max-width:900px;margin:0 auto;padding:40px 36px 52px}
b.num{font-weight:600;font-variant-numeric:tabular-nums}
.mono{font-family:ui-monospace,"SFMono-Regular",Consolas,"Liberation Mono",monospace}
.dot{color:#c9c6bd;margin:0 7px}

/* 封面 */
.cover{border-bottom:1px solid var(--line);padding-bottom:22px}
.brandrow{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px}
.brand-mark{width:26px;height:26px;border-radius:6px;background:var(--accent);color:#fff;font-size:14px;
  display:flex;align-items:center;justify-content:center;font-weight:600}
.brand-name{font-size:14px;font-weight:600;letter-spacing:.02em}
.brand-name em{font-style:normal;color:var(--muted);font-weight:400;margin-left:6px;letter-spacing:.08em;font-size:11px;text-transform:uppercase}
.brand-meta{font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.cover-main{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-top:32px}
.eyebrow{margin:0 0 10px;font-size:10.5px;letter-spacing:.22em;color:var(--accent);font-weight:600}
.cover h1{margin:0;font-size:46px;line-height:1.05;font-weight:600;letter-spacing:-.02em}
.cover-date{margin:12px 0 0;font-size:14.5px;color:var(--ink2);font-variant-numeric:tabular-nums}
.cover-date span{margin-left:12px;color:var(--muted);font-size:12.5px}
.cover-mark{text-align:right;line-height:.9;color:var(--line);user-select:none}
.cover-mark .big{display:block;font-size:92px;font-weight:600;letter-spacing:-.04em;color:#dedbd2;font-variant-numeric:tabular-nums}
.cover-mark .small{font-size:11px;letter-spacing:.3em;color:#c6c2b7}
.lede{margin:22px 0 0;font-size:14.5px;line-height:1.88;color:var(--ink2);max-width:700px}
.lede b{color:var(--ink);font-weight:600}

/* 工作内容总结 */
.brief{margin-top:26px;padding-top:16px;border-top:1px solid var(--line)}
.brief-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:8px}
.brief-title{font-size:11px;letter-spacing:.18em;color:var(--accent);font-weight:600}
.brief-hint{font-size:11.5px;color:var(--muted)}
.brief-item{display:grid;grid-template-columns:136px 1fr;gap:16px;padding:12px 0;
  border-top:1px solid var(--line);break-inside:avoid;page-break-inside:avoid}
.brief-item:first-of-type{border-top:0;padding-top:2px}
.brief-side{display:flex;flex-direction:column;gap:4px}
.brief-name{font-size:13.5px;font-weight:600;color:var(--ink);line-height:1.5;word-break:break-word}
.brief-src{font-size:10.5px;color:#a6a29a;line-height:1.6}
.brief-meta{font-size:10.5px;color:var(--muted);line-height:1.6}
.brief-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.brief-list li{display:flex;gap:10px;align-items:baseline}
.brief-list .no{flex:0 0 auto;min-width:16px;padding-top:1px;font-size:10.5px;color:#c9c5ba;
  font-variant-numeric:tabular-nums;letter-spacing:.06em}
.brief-list .tx{font-size:13px;color:var(--ink2);line-height:1.55}
.brief-list li.more .tx{font-size:12px;color:var(--muted)}

/* 数字带 */
.ledger{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--line)}
.ledger .cell{padding:16px 18px 16px 0;border-right:1px solid var(--line-soft)}
.ledger .cell:last-child{border-right:0;padding-right:0}
.ledger .k{display:block;font-size:11.5px;color:var(--muted);letter-spacing:.06em}
.ledger .v{font-size:30px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.25}
.ledger .u{font-size:12px;color:var(--muted);margin-left:4px}
.ledger .n{display:block;font-size:11.5px;color:var(--muted);margin-top:2px}

/* 小节 */
.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin:30px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--ink)}
.section-head.flat{margin:0 0 14px;padding-bottom:0;border-bottom:0}
.section-head h2{margin:0;font-size:14.5px;font-weight:600;letter-spacing:.03em}
.section-head .idx{color:#c3bfb4;font-weight:400;margin-right:7px;font-variant-numeric:tabular-nums}
.hint{font-size:11.5px;color:var(--muted)}

/* 横条 */
.strip{margin-top:26px;padding:16px 20px;background:var(--card);border:1px solid var(--line);border-radius:12px}
.strip-quiet{background:transparent;border-style:dashed;border-color:#e2dfd7;padding:12px 18px}
.strip-quiet .quiet{margin:0}
.strip-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:10px}
.strip-head h2{margin:0;font-size:14px;font-weight:600;letter-spacing:.03em}
.strip-body{display:flex;gap:34px;flex-wrap:wrap}
.mini .k{display:block;font-size:11.5px;color:var(--muted)}
.mini .v{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.mini .u{font-size:11.5px;color:var(--muted);margin-left:5px}
.research{list-style:none;margin:0;padding:0}
.research li{padding:8px 0;border-bottom:1px solid var(--line-soft)}
.research li:last-child{border-bottom:0;padding-bottom:0}
.research .rq{font-weight:600}
.research .rc{font-size:11px;color:var(--teal);border:1px solid #d8e6e4;background:#f2f8f7;border-radius:999px;padding:1px 8px;margin-left:10px}
.research p{margin:4px 0 0;color:var(--ink2);font-size:13px}

/* 项目卡 */
.projects{margin-top:8px}
.project{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 22px 16px;margin-bottom:12px}
.project-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid var(--line-soft)}
.project-id h2{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em;line-height:1.3}
.project-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px}
.project-meta .dim{font-size:11.5px;color:var(--muted);margin-left:4px;font-variant-numeric:tabular-nums}
.src{font-size:10.5px;font-weight:600;letter-spacing:.04em;padding:2px 8px;border-radius:999px;border:1px solid transparent}
.src-codex{background:#eef0f4;color:#2b3448;border-color:#dfe3ea}
.src-claude{background:#fbf1ec;color:#a3472e;border-color:#f0ded4}
.src-workbuddy{background:#eef6f5;color:#2b6a6e;border-color:#d9e9e7}
.src-dsh{background:#f3f1f7;color:#5b5470;border-color:#e5e1ee}
.pstats{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.stat{font-size:11.5px;color:var(--ink2);background:#faf9f5;border:1px solid var(--line-soft);
  border-radius:8px;padding:4px 9px;font-variant-numeric:tabular-nums}
.stat b{font-weight:600;color:var(--ink)}

/* 工作线 */
.gain{display:flex;gap:10px;align-items:baseline;margin-top:12px;padding-left:10px;
  border-left:2px solid var(--accent)}
.gain .k{font-size:10.5px;letter-spacing:.12em;color:var(--accent);flex:0 0 auto;font-weight:600}
.gain .v{font-size:12.5px;color:var(--ink2);line-height:1.6}
.ws-list{margin-top:6px}
.ws{padding:12px 0;border-bottom:1px dashed var(--line)}
.ws:last-child{border-bottom:0;padding-bottom:4px}
.ws-head{display:flex;align-items:baseline;gap:12px}
.ws-no{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#bdb9ae;flex:0 0 22px;letter-spacing:.04em}
.ws-head h3{margin:0;font-size:14.5px;font-weight:600;flex:1;line-height:1.5}
.ws-tag{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.ws-tag time{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.results{list-style:none;margin:5px 0 0;padding:0 0 0 34px}
.results li{display:flex;gap:10px;align-items:baseline;padding:2px 0;color:var(--ink2)}
.results .tick{flex:0 0 5px;width:5px;height:5px;border-radius:50%;background:#cdc9be;margin-top:10px}
.results .txt{flex:1;font-size:13px;line-height:1.6}
.results .meta{flex:0 0 auto;font-size:10px;color:#b3afa5;font-variant-numeric:tabular-nums;opacity:.95}
.ws-tests{display:flex;gap:6px;margin:6px 0 0 34px;flex-wrap:wrap}
.tchip{font-size:10.5px;padding:1px 8px;border-radius:999px;font-variant-numeric:tabular-nums}
.t-pass{background:#eef6f1;color:var(--green)}
.t-fail{background:#fbeeeb;color:var(--red)}
.t-block{background:#fbf4e6;color:var(--amber)}
.t-run{background:#f2f2f0;color:#7c808c}

/* 子块 */
.sub-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 26px;margin-top:12px}
.sub-grid.single{grid-template-columns:1fr}
.sub{padding-top:10px;border-top:1px solid var(--line-soft)}
.sub h4{margin:0 0 6px;font-size:11px;letter-spacing:.14em;color:var(--muted);font-weight:600;text-transform:uppercase}
.plain{list-style:none;margin:0;padding:0}
.plain li{position:relative;padding-left:14px;margin:4px 0;color:var(--ink2);font-size:13px}
.plain li::before{content:"";position:absolute;left:0;top:11px;width:4px;height:4px;border-radius:50%;background:#d3cfc4}
.todo{list-style:none;margin:0;padding:0;counter-reset:todo}
.todo li{display:flex;gap:10px;padding:4px 0;color:var(--ink2);font-size:13px}
.todo .arrow{color:var(--accent);flex:0 0 auto}
.sub-next{background:#fdfaf7;border-radius:8px;padding:10px 12px 8px;border:1px solid #f2ece4}

/* 图表 */
.viz{margin-top:18px}
.viz-board{display:grid;grid-template-columns:1.12fr 1fr 1fr;background:var(--card);
  border:1px solid var(--line);border-radius:12px;overflow:hidden}
.board-cell{margin:0;padding:14px 16px 12px;display:flex;flex-direction:column;
  border-left:1px solid var(--line-soft)}
.board-cell:first-child{border-left:0}
.board-cell figcaption{font-size:11.5px;color:var(--ink);font-weight:600;margin-bottom:10px;
  display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.board-cell figcaption span{font-weight:400;color:var(--muted);font-size:10.5px}
.board-cell svg{width:100%;height:auto;display:block}
.board-body{flex:1;display:flex;flex-direction:column;justify-content:center;min-height:0}
.board-body .legend{margin:8px 0 0;padding:0}
.board-body .legend-row{margin:8px 0 0;padding:0}
.board-body .donut-wrap{flex:0 0 auto}
.board-cell .empty{border:0;background:transparent;padding:14px 0}
.viz-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;align-items:stretch}
.viz-grid-2{grid-template-columns:repeat(2,1fr);margin-top:10px}
.chart{margin:0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 14px 12px;
  display:flex;flex-direction:column}
.chart figcaption{font-size:11.5px;color:var(--ink);font-weight:600;margin-bottom:10px;display:flex;justify-content:space-between;gap:8px}
.chart figcaption span{font-weight:400;color:var(--muted);font-size:10.5px}
.chart svg{width:100%;height:auto;display:block}
.bar-label{font-size:10px;fill:#5a6070}
.bar-value{font-size:10px;fill:#8d92a1;font-variant-numeric:tabular-nums}
.bar-track{fill:#f2f1ec}
.legend{list-style:none;margin:auto 0 0;padding:10px 0 0;font-size:11.5px;color:var(--ink2)}
.legend li{display:flex;align-items:center;gap:7px;padding:2px 0}
.legend i{width:8px;height:8px;border-radius:2px;flex:0 0 8px}
.legend b{margin-left:auto;font-weight:600;font-variant-numeric:tabular-nums;color:var(--ink)}
.legend-row{display:flex;gap:14px;flex-wrap:wrap;margin:auto 0 0;padding-top:12px}
.legend-row li{flex:0 0 auto}
.legend-row b{margin-left:4px}
.donut-wrap{flex:1;display:flex;flex-direction:column;justify-content:center;gap:4px}
.donut-wrap svg{width:92px;height:92px;margin:0 auto}
.donut-total{font-size:19px;font-weight:600;text-anchor:middle;fill:#14161a}
.donut-unit{font-size:8px;text-anchor:middle;fill:#a6a29a}
.seg-bar{display:flex;height:10px;border-radius:5px;overflow:hidden;background:#f2f1ec}
.seg{display:block;height:100%}
.empty{border:1px dashed var(--line);border-radius:10px;padding:22px 16px;text-align:center;background:#fbfaf7}
.empty span{display:block;font-size:12px;color:#9a968d}
.empty em{font-style:normal;font-size:10.5px;color:#bdb9ae}

/* 其他 */
.misc{margin-top:24px;padding-top:14px;border-top:1px solid var(--line)}
.misc ul{list-style:none;margin:0;padding:0;display:flex;gap:14px 28px;flex-wrap:wrap}
.misc .k{font-size:11px;color:var(--muted);display:block}
.misc .v{font-size:12.5px;color:var(--ink2)}
.quiet{color:var(--muted);font-size:13px;margin:16px 0 0}

/* 附录 */
.appendix{margin-top:26px;border-top:1px solid var(--line);padding-top:14px}
.appendix summary{cursor:pointer;font-size:11.5px;color:var(--muted);letter-spacing:.04em;list-style:none;outline:none}
.appendix summary::-webkit-details-marker{display:none}
.appendix summary::before{content:"＋ ";color:#c3bfb4}
.appendix[open] summary::before{content:"－ "}
.appendix-body{margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:22px 32px}
.appendix-item h4{margin:0 0 6px;font-size:11px;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;font-weight:600}
.appendix-item h2{margin:0 0 6px;font-size:11px;letter-spacing:.12em;color:var(--muted);font-weight:600}
.appendix-item p{margin:0;font-size:12.5px;color:var(--ink2);line-height:1.8}
.appendix-item .mono{font-size:11px;color:#a6a29a;margin-top:4px}
.appendix-item .plain li{font-size:12px;padding-left:12px}
.appendix-item .small li{font-size:11px;word-break:break-all}
.appendix-item code{font-family:ui-monospace,Consolas,monospace;color:#5a6070}
.colophon{margin-top:22px;padding-top:12px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:16px;
  flex-wrap:wrap;font-size:10.5px;color:#a6a29a;letter-spacing:.04em}

@media (max-width:760px){
  .doc{padding:32px 20px 48px}
  .cover h1{font-size:38px}
  .cover-mark{display:none}
  .ledger{grid-template-columns:repeat(2,1fr)}
  .ledger .cell{padding:16px 16px 16px 0}
  .ledger .cell:nth-child(2){border-right:0}
  .viz-grid,.viz-grid-2,.appendix-body{grid-template-columns:1fr}
  .sub-grid{grid-template-columns:1fr;gap:12px 0}
  .brief-item{grid-template-columns:1fr;gap:7px}
  .brief-side{flex-direction:row;align-items:baseline;gap:10px;flex-wrap:wrap}
  .project{padding:20px}
  .pstats{justify-content:flex-start}
}
@media print{
  @page{size:A4;margin:16mm 14mm}
  body{background:#fff;font-size:11.5px;line-height:1.5}
  .results .txt{line-height:1.5}
  .plain li,.todo li{line-height:1.55}
  .doc{max-width:none;padding:0}
  .brief-item{grid-template-columns:132px 1fr;gap:14px;padding:11px 0}
  .sub-grid{grid-template-columns:1fr 1fr;gap:0 20px}
  .brief-side{flex-direction:column;gap:1px;align-items:flex-start}
  .brief-list .tx{font-size:11px}
  .brief-name{font-size:12px}
  .ledger{grid-template-columns:repeat(4,1fr)}
  .ledger .cell{padding:16px 16px 18px 0}
  .ledger .cell:nth-child(2){border-right:1px solid var(--line-soft)}
  .strip,.chart{break-inside:avoid;box-shadow:none}
  .project{break-inside:auto;page-break-inside:auto;margin-bottom:0;box-shadow:none;
    background:transparent;border:0;border-top:1px solid var(--line);border-radius:0;padding:11px 0 4px}
  .ws{padding:11px 0}
  .gain{margin-top:10px}
  .project:first-of-type{border-top:0}
  .sub-next{background:transparent;border-color:#e8e2d8}
  .chart,.viz-board{background:transparent}
  .ws{break-inside:avoid;page-break-inside:avoid}

  .section-head{break-after:avoid;page-break-after:avoid}
  .viz-board{break-inside:avoid}
  .appendix{break-inside:auto}
  .appendix[open] .appendix-body{display:grid}
  a{text-decoration:none;color:inherit}
}
`;

function dailyDistributionSection(rows: readonly { day: string; sessions: number; projects: number; tests: number; failures: number }[]): string {
  const body = rows.length === 0
    ? `<tr><td colspan="5">未检测到可核对的日度数据。</td></tr>`
    : rows.map((row) => `<tr><td>${escapeHtml(row.day)}</td><td>${row.sessions}</td><td>${row.projects}</td><td>${row.tests}</td><td>${row.failures}</td></tr>`).join("");
  return `<section class="distribution">
  <h3>1.1 日度分布</h3>
  <table><thead><tr><th>日期</th><th>会话</th><th>项目</th><th>测试</th><th>失败</th></tr></thead><tbody>${body}</tbody></table>
</section>`;
}

function solvedProblemsSection(report: FactReport): string {
  const items = report.projects.flatMap((project) => project.problems.slice(0, 4).map((problem) =>
    `<li><b>${escapeHtml(project.projectId)}</b><span>${escapeHtml(problem)}</span></li>`
  ));
  return `<section class="strip"><h3>2.1 解决的问题</h3>${items.length > 0
    ? `<ul class="summary-list">${items.join("")}</ul>`
    : `<p class="quiet">未检测到有证据的已解决问题。</p>`}</section>`;
}

function testResultsSection(report: FactReport): string {
  const counts = testData(report);
  const tests = report.projects.flatMap((project) => project.tests);
  const detail = tests.length === 0
    ? `<p class="quiet">未检测到测试证据。</p>`
    : `<ul class="summary-list">${report.projects.flatMap((project) => {
        const projectTests = project.tests;
        if (projectTests.length === 0) return [];
        const statusCounts = new Map<string, number>();
        for (const test of projectTests) statusCounts.set(test.status, (statusCounts.get(test.status) ?? 0) + 1);
        const statuses = ["passed", "failed", "blocked", "not-run"]
          .filter((status) => (statusCounts.get(status) ?? 0) > 0)
          .map((status) => `${TEST_LABEL[status] ?? status} ${statusCounts.get(status)}`)
          .join(" / ");
        const failed = projectTests.filter((test) => test.status === "failed").map((test) => test.failureReason ?? test.type);
        return [`<li><b>${escapeHtml(project.projectId)}</b><span>${escapeHtml(statuses)}${failed.length > 0 ? `；失败：${escapeHtml(failed.slice(0, 4).join("；"))}` : ""}</span></li>`];
      }).join("")}</ul>`;
  return `<section class="strip"><h3>2.2 测试结果</h3>
  ${counts.length > 0 ? `<div class="board-body">${segmented(counts, "未检测到测试证据")}</div>` : ""}
  ${detail}
</section>`;
}

function optimizationsSection(report: FactReport): string {
  const items = report.projects.flatMap((project) => [
    ...(project.risks ?? []).map((item) => ({ projectId: project.projectId, kind: "风险", text: item })),
    ...project.optimizations
      .filter((item) => !(project.todos ?? []).includes(item) && !/(?:TODO|待办|待完成|尚未完成|未完成|仍需|还需|还要|下一步|接下来|后续(?:需要|要|应|计划|补充|完善|修复|实现)|计划(?:完成|补充|修复|实现|完善|继续|进行)|需要继续|需要补充|需要修复|需要实现|需要完善)/i.test(item))
      .slice(0, 4)
      .map((item) => ({ projectId: project.projectId, kind: "优化", text: item }))
  ]);
  const unique = [...new Map(items.map((item) => [`${item.projectId}\u0000${item.kind}\u0000${item.text}`, item])).values()];
  return `<section class="strip strip-quiet"><h3>3.2 待优化项</h3>${unique.length > 0
    ? `<ul class="summary-list">${unique.map((item) => `<li><b>${escapeHtml(item.projectId)} · ${item.kind}</b><span>${escapeHtml(item.text)}</span></li>`).join("")}</ul>`
    : `<p class="quiet">未检测到有证据的待优化事项。</p>`}</section>`;
}

function todosSection(report: FactReport): string {
  const items = report.projects.flatMap((project) =>
    (project.todos ?? []).map((todo) => `<li><b>${escapeHtml(project.projectId)}</b><span>${escapeHtml(todo)}</span></li>`)
  );
  const unique = [...new Set(items)];
  return `<section class="strip"><h2>4. 待办事项</h2>${unique.length > 0
    ? `<ul class="summary-list">${unique.join("")}</ul>`
    : `<p class="quiet">未检测到明确待办事项。</p>`}</section>`;
}

export function renderHtml(input: FactReport | WeeklyReport): string {
  const { report, dailyDistribution } = toReportTemplateModel(input);
  const conclusion = report.summary ?? ledeText(report);
  return [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `<title>织迹${report.reportType === "weekly" ? "近一周工作报告" : "工作日报"} ${escapeHtml(report.range.from)}${report.reportType === "weekly" ? `-${escapeHtml(report.range.to)}` : ""}</title>`,
    "<meta name=\"generator\" content=\"WorkWeave\">",
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    "<div class=\"doc\">",
    cover(report),
    `<section class="summary-groups"><h2>本期结论</h2><p class="lede">${escapeHtml(conclusion)}</p></section>`,
    `<section class="summary-groups"><h2>1. 工作进展</h2>${dailyDistributionSection(dailyDistribution)}${ledger(report)}${chartsSection(report)}${projectsSection(report, false)}</section>`,
    `<section class="summary-groups"><h2>2. 问题与质量</h2>${solvedProblemsSection(report)}${testResultsSection(report)}</section>`,
    `<section class="summary-groups"><h2>3. 调研与行动</h2>${researchSection(report)}${optimizationsSection(report)}</section>`,
    todosSection(report),
    `<footer class="colophon"><span>织迹 WorkWeave · 本地规则生成，未调用任何模型</span><span>数据版本 ${escapeHtml(
      report.dataVersion
    )} · ${escapeHtml(stampOf(report.generatedAt))}</span></footer>`,
    "</div>",
    "</body>",
    "</html>"
  ].join("\n");
}
