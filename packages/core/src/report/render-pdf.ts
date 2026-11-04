import { WorkWeaveError } from "../domain/errors.js";
import { renderHtml } from "./render-html.js";
import type { FactReport } from "./types.js";

export interface PdfEngine {
  render(html: string): Promise<Buffer>;
}

export class PdfRenderer {
  constructor(private readonly engine?: PdfEngine) {}

  async render(report: FactReport): Promise<Buffer> {
    if (this.engine === undefined) {
      throw new WorkWeaveError(
        "E-RPT-001",
        "PDF engine is not configured; Markdown and JSON export remain available"
      );
    }
    return this.engine.render(renderHtml(report));
  }
}