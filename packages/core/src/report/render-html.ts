import type { FactReport } from "./types.js";
import { renderMarkdown } from "./render-markdown.js";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let inList = false;

  const closeList = (): void => {
    if (inList) {
      output.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith("### ")) {
      closeList();
      output.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      closeList();
      output.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      closeList();
      output.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.startsWith("- ")) {
      if (!inList) {
        output.push("<ul>");
        inList = true;
      }
      output.push(`<li>${escapeHtml(line.slice(2))}</li>`);
    } else if (line.trim().startsWith("> ")) {
      closeList();
      output.push(`<blockquote>${escapeHtml(line.trim().slice(2))}</blockquote>`);
    } else if (line.trim().length === 0) {
      closeList();
    } else {
      closeList();
      output.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  closeList();
  return output.join("\n");
}

interface ChartDatum {
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

const COLORS = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c", "#0891b2", "#64748b"];

function chartCard(title: string, body: string): string {
  return `<article class="chart-card"><h3>${escapeHtml(title)}</h3>${body}</article>`;
}

function emptyData(message = "未检测到数据"): string {
  return `<p class="empty">${escapeHtml(message)}</p>`;
}

function svgPie(data: readonly ChartDatum[]): string {
  const visible = data.filter((item) => item.value > 0);
  const total = visible.reduce((sum, item) => sum + item.value, 0);
  if (total === 0) return emptyData();

  let angle = -Math.PI / 2;
  const cx = 80;
  const cy = 80;
  const radius = 62;
  const paths = visible.map((item) => {
    const slice = (item.value / total) * Math.PI * 2;
    const end = angle + slice;
    const x1 = cx + radius * Math.cos(angle);
    const y1 = cy + radius * Math.sin(angle);
    const x2 = cx + radius * Math.cos(end);
    const y2 = cy + radius * Math.sin(end);
    const large = slice > Math.PI ? 1 : 0;
    const path = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
    angle = end;
    return `<path d="${path}" fill="${item.color}"><title>${escapeHtml(item.label)}: ${item.value}</title></path>`;
  });

  const legend = visible
    .map((item) => `<li><span class="dot" style="background:${item.color}"></span>${escapeHtml(item.label)} <strong>${item.value}</strong></li>`)
    .join("");

  return `<div class="pie-wrap"><svg viewBox="0 0 160 160" role="img" aria-label="${escapeHtml(data.map((item) => `${item.label} ${item.value}`).join("，"))}">${paths.join("")}</svg><ul class="legend">${legend}</ul></div>`;
}

function svgBars(data: readonly ChartDatum[]): string {
  const visible = data.filter((item) => item.value > 0).slice(0, 10);
  if (visible.length === 0) return emptyData();

  const max = Math.max(...visible.map((item) => item.value), 1);
  const rowHeight = 26;
  const labelWidth = 150;
  const barWidth = 240;
  const height = visible.length * rowHeight + 8;
  const rows = visible
    .map((item, index) => {
      const width = Math.max(2, (item.value / max) * barWidth);
      const y = index * rowHeight + 6;
      return [
        `<text x="0" y="${y + 12}" class="bar-label">${escapeHtml(item.label.slice(0, 20))}</text>`,
        `<rect x="${labelWidth}" y="${y}" width="${width.toFixed(1)}" height="16" rx="3" fill="${item.color}"></rect>`,
        `<text x="${labelWidth + width + 6}" y="${y + 12}" class="bar-value">${item.value}</text>`
      ].join("");
    })
    .join("");

  return `<svg viewBox="0 0 ${labelWidth + barWidth + 40} ${height}" role="img" aria-label="${escapeHtml(visible.map((item) => `${item.label} ${item.value}`).join("，"))}">${rows}</svg>`;
}

function sourceData(report: FactReport): readonly ChartDatum[] {
  const counts = new Map<string, number>();
  for (const project of report.projects) {
    for (const share of project.distribution.shares) {
      counts.set(share.source, (counts.get(share.source) ?? 0) + share.messages);
    }
  }
  return [...counts.entries()].map(([label, value], index) => ({
    label,
    value,
    color: COLORS[index % COLORS.length] ?? "#64748b"
  }));
}

function projectData(report: FactReport): readonly ChartDatum[] {
  return report.projects.map((project, index) => ({
    label: project.projectId,
    value: project.distribution.totalSessions,
    color: COLORS[index % COLORS.length] ?? "#64748b"
  }));
}

function testData(report: FactReport): readonly ChartDatum[] {
  const counts = new Map<string, number>();
  for (const project of report.projects) {
    for (const test of project.tests) {
      counts.set(test.status, (counts.get(test.status) ?? 0) + 1);
    }
  }
  const labels: Record<string, string> = {
    passed: "通过",
    failed: "失败",
    blocked: "阻塞",
    "not-run": "未执行"
  };
  return [...counts.entries()].map(([status, value], index) => ({
    label: labels[status] ?? status,
    value,
    color: COLORS[index % COLORS.length] ?? "#64748b"
  }));
}

function adoptionData(report: FactReport): readonly ChartDatum[] {
  return [
    { label: "可确证采纳", value: report.adoption.confirmed, color: "#16a34a" },
    { label: "推断采纳", value: report.adoption.inferred, color: "#2563eb" },
    { label: "未采纳", value: report.adoption.notAdopted, color: "#dc2626" }
  ];
}

function researchData(report: FactReport): readonly ChartDatum[] {
  const labels: Record<string, string> = {
    concluded: "已形成结论",
    collecting: "收集中",
    "verification-failed": "验证失败",
    undecided: "未决"
  };
  const counts = new Map<string, number>();
  for (const item of report.research) {
    counts.set(item.conclusion, (counts.get(item.conclusion) ?? 0) + 1);
  }
  return [...counts.entries()].map(([status, value], index) => ({
    label: labels[status] ?? status,
    value,
    color: COLORS[index % COLORS.length] ?? "#64748b"
  }));
}

function renderCharts(report: FactReport): string {
  const adoption = adoptionData(report);
  const adoptionTotal = adoption.reduce((sum, item) => sum + item.value, 0);
  const adoptionChart =
    adoptionTotal === 0
      ? emptyData(report.adoption.undeterminable > 0 ? "未检测到可判定采纳信号" : "本日无 AI 交互")
      : svgPie(adoption);

  return [
    "<section class=\"charts\">",
    "<h2>图表概览</h2>",
    "<div class=\"chart-grid\">",
    chartCard("来源分布（按消息数）", svgPie(sourceData(report))),
    chartCard("项目会话数", svgBars(projectData(report))),
    chartCard("测试四态", svgPie(testData(report))),
    chartCard("AI 采纳状态", adoptionChart),
    chartCard("调研结论", svgBars(researchData(report))),
    "</div>",
    "</section>"
  ].join("\n");
}

const STYLE = `
:root{--fg:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc;--card:#fff}
*{box-sizing:border-box}
body{margin:0;padding:32px;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;line-height:1.65}
main{max-width:1080px;margin:0 auto}
h1{margin-top:0}
h2{border-bottom:1px solid var(--line);padding-bottom:6px;margin-top:36px}
h3{margin:0 0 12px;font-size:15px}
ul{padding-left:20px}
blockquote{margin:16px 0;padding:10px 14px;background:#fff7ed;border-left:4px solid #f59e0b;color:#92400e}
.charts{margin:24px 0}
.chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
.chart-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;min-height:220px}
.pie-wrap{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.pie-wrap svg{width:160px;height:160px;flex:0 0 160px}
.legend{list-style:none;padding:0;margin:0;font-size:13px}
.legend li{display:flex;align-items:center;gap:6px;margin:4px 0}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%}
svg{max-width:100%;height:auto}
.bar-label{font-size:11px;fill:#334155}
.bar-value{font-size:11px;fill:#475569}
.empty{color:var(--muted);background:#f1f5f9;border-radius:8px;padding:24px;text-align:center}
table{border-collapse:collapse;width:100%}
@media print{body{background:#fff;padding:0}.chart-card{break-inside:avoid}}
`;

export function renderHtml(report: FactReport): string {
  const body = markdownToHtml(renderMarkdown(report));
  return [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `<title>织迹日报 ${escapeHtml(report.range.from)}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    "<main>",
    renderCharts(report),
    body,
    "</main>",
    "</body>",
    "</html>"
  ].join("\n");
}