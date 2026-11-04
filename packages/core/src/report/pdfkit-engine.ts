import { existsSync } from "node:fs";
import PDFDocument from "pdfkit";
import { WorkWeaveError } from "../domain/errors.js";
import type { PdfEngine } from "./render-pdf.js";

export interface PdfKitEngineOptions {
  readonly fontPath?: string;
}

function candidateFonts(): readonly string[] {
  if (process.platform === "win32") {
    return ["C:\\Windows\\Fonts\\simhei.ttf", "C:\\Windows\\Fonts\\msyh.ttc"];
  }
  if (process.platform === "darwin") {
    return ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Light.ttc"];
  }
  return [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/truetype/arphic/uming.ttc"
  ];
}

export function findDefaultPdfFont(): string | undefined {
  const configured = process.env.WORKWEAVE_PDF_FONT;
  if (configured !== undefined && configured.length > 0) {
    return existsSync(configured) ? configured : undefined;
  }
  return candidateFonts().find((font) => existsSync(font));
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<h1>/g, "\n# ")
      .replace(/<h2>/g, "\n## ")
      .replace(/<h3>/g, "\n### ")
      .replace(/<li>/g, "\n- ")
      .replace(/<blockquote>/g, "\n> ")
      .replace(/<\/(h1|h2|h3|li|blockquote|p|ul)>/g, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function hasNonAscii(value: string): boolean {
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) > 0x7f) return true;
  }
  return false;
}

export class PdfKitEngine implements PdfEngine {
  constructor(private readonly options: PdfKitEngineOptions = {}) {}

  async render(html: string): Promise<Buffer> {
    const text = htmlToText(html);
    const fontPath = this.options.fontPath ?? findDefaultPdfFont();

    if (this.options.fontPath !== undefined && !existsSync(this.options.fontPath)) {
      throw new WorkWeaveError("E-RPT-001", `PDF font not found: ${this.options.fontPath}`);
    }
    if (fontPath === undefined && hasNonAscii(text)) {
      throw new WorkWeaveError(
        "E-RPT-001",
        "No CJK font available for PDF export; set WORKWEAVE_PDF_FONT to a TTF/TTC file"
      );
    }

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    const completed = new Promise<Buffer>((resolve, reject) => {
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    if (fontPath !== undefined) {
      doc.font(fontPath);
    } else {
      doc.font("Helvetica");
    }
    doc.fontSize(10);

    for (const line of text.split(/\r?\n/)) {
      if (line.trim().length === 0) {
        doc.moveDown(0.5);
        continue;
      }
      doc.text(line, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, lineGap: 2 });
    }
    doc.end();

    try {
      return await completed;
    } catch (error) {
      throw new WorkWeaveError("E-RPT-001", `PDF rendering failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}