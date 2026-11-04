import { redact } from "../infra/sanitizer/index.js";

export interface DiagnosticsInput {
  readonly day: string;
  readonly sources: readonly string[];
  readonly stageTimings: Readonly<Record<string, number>>;
  readonly errors: readonly string[];
  readonly probeCandidatePaths: readonly string[];
  readonly gaps: readonly string[];
  readonly homeDir?: string;
}

export interface DiagnosticsPackage {
  readonly version: 1;
  readonly day: string;
  readonly sources: readonly string[];
  readonly stageTimings: Readonly<Record<string, number>>;
  readonly errors: readonly string[];
  readonly candidatePaths: readonly string[];
  readonly gaps: readonly string[];
}

function maskPath(path: string, homeDir: string | undefined): string {
  if (homeDir !== undefined && homeDir.length > 0 && path.startsWith(homeDir)) {
    return path.replace(homeDir, "<profile>");
  }
  return path;
}

export function buildDiagnostics(input: DiagnosticsInput): DiagnosticsPackage {
  return {
    version: 1,
    day: input.day,
    sources: input.sources,
    stageTimings: input.stageTimings,
    errors: input.errors.map((error) => redact(error, "diagnostics").text.slice(0, 500)),
    candidatePaths: input.probeCandidatePaths.map((path) => maskPath(path, input.homeDir)),
    gaps: input.gaps.map((gap) => redact(gap, "diagnostics").text)
  };
}