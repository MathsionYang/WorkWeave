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

export function renderHtml(report: FactReport): string {
  const body = markdownToHtml(renderMarkdown(report));
  return [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    `<title>织迹日报 ${escapeHtml(report.range.from)}</title>`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>"
  ].join("\n");
}