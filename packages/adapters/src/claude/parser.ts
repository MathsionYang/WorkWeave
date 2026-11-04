import { readFile } from "node:fs/promises";

export interface ClaudeFingerprintSample {
  readonly file: string;
  readonly lineCount: number;
  readonly typeCounts: Readonly<Record<string, number>>;
  readonly shapes: Readonly<Record<string, unknown>>;
}

export interface ClaudeFingerprintReport {
  readonly version: 1;
  readonly files: number;
  readonly samples: readonly ClaudeFingerprintSample[];
}

function isSample(value: unknown): value is ClaudeFingerprintSample {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.file === "string" &&
    typeof record.lineCount === "number" &&
    typeof record.typeCounts === "object" &&
    record.typeCounts !== null &&
    typeof record.shapes === "object" &&
    record.shapes !== null
  );
}

export function validateClaudeFingerprint(value: unknown): value is ClaudeFingerprintReport {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    typeof record.files === "number" &&
    record.files > 0 &&
    Array.isArray(record.samples) &&
    record.samples.length > 0 &&
    record.samples.every(isSample)
  );
}

export async function isClaudeParserEnabled(fingerprintPath: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(fingerprintPath, "utf8")) as unknown;
    return validateClaudeFingerprint(parsed);
  } catch {
    return false;
  }
}