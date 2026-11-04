import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PdfKitEngine, asPlainDate, findDefaultPdfFont, renderHtml } from "@workweave/core";
import type { FactReport } from "@workweave/core";
import { runReportCommand } from "@workweave/cli";

const day = asPlainDate("2026-11-04");
const report: FactReport = {
  reportType: "daily",
  range: { from: day, to: day },
  dataVersion: "v1",
  generatedAt: "2026-11-04T20:00:00.000Z",
  overview: {
    sessions: 1,
    projects: 1,
    tests: 0,
    failures: 0,
    optimizations: 0,
    aiAnswers: 0,
    confirmed: 0,
    inferred: 0,
    notAdopted: 0,
    undeterminable: 0,
    adoptionRate: null,
    commits: 0,
    researchItems: 0
  },
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
  research: [],
  projects: [],
  crossProject: [],
  pureConversation: [],
  pending: [],
  evidenceIndex: [],
  completeness: { status: "complete", declarations: [], disabledSources: [] }
};

test("PDFKit 生成真实 PDF 并支持中文", async (t) => {
  if (findDefaultPdfFont() === undefined) {
    t.skip("当前环境无可用 CJK 字体");
    return;
  }

  const buffer = await new PdfKitEngine().render(renderHtml(report));
  assert.equal(buffer.subarray(0, 5).toString("utf8"), "%PDF-");
  assert.ok(buffer.length > 1000);
});

test("PDF 字体缺失时返回可读 E-RPT-001", async () => {
  const engine = new PdfKitEngine({ fontPath: "C:\\missing\\font.ttf" });
  await assert.rejects(
    engine.render(renderHtml(report)),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "E-RPT-001"
  );
});

test("CLI 可将日报导出为 PDF 文件", async (t) => {
  if (findDefaultPdfFont() === undefined) {
    t.skip("当前环境无可用 CJK 字体");
    return;
  }

  const home = await mkdtemp(join(tmpdir(), "ww-pdf-"));
  const codexDir = join(home, ".codex", "sessions", "2026", "11", "04");
  await mkdir(codexDir, { recursive: true });
  await writeFile(
    join(codexDir, "rollout-2026-11-04T08-00-00-pdf-1.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-11-04T08:00:00.000Z",
        ordinal: 0,
        type: "session_meta",
        payload: { session_id: "pdf-1", cwd: "/work/project-a" }
      }),
      JSON.stringify({
        timestamp: "2026-11-04T08:01:00.000Z",
        ordinal: 1,
        type: "response_item",
        payload: { type: "message", id: "p1", role: "user", content: [{ type: "text", text: "完成中文报告" }] }
      })
    ].join("\n"),
    "utf8"
  );

  const out = join(home, "daily.pdf");
  const result = await runReportCommand({
    day: "2026-11-04",
    out,
    homeDir: home,
    platform: "linux",
    env: {},
    format: "pdf"
  });
  assert.equal(result.reportPath, out);
  assert.equal((await readFile(out)).subarray(0, 5).toString("utf8"), "%PDF-");
});