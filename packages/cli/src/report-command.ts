import { dirname, join } from "node:path";
import { PathGuard } from "@workweave/core";
import type { Platform, SourceTool } from "@workweave/core";
import { WorkWeaveRuntime } from "@workweave/mcp";

export interface ReportCommandOptions {
  readonly day: string;
  readonly out: string;
  readonly homeDir?: string;
  readonly platform?: Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly format?: "markdown" | "json" | "html" | "pdf";
  readonly now?: Date;
}

export interface ReportCommandResult {
  readonly reportPath: string;
  readonly dataVersion: string;
  readonly sessionCount: number;
  readonly skippedSources: readonly SourceTool[];
}

export async function runReportCommand(options: ReportCommandOptions): Promise<ReportCommandResult> {
  const platform =
    options.platform ??
    (process.platform === "win32" || process.platform === "darwin" ? process.platform : "linux");
  const homeDir = options.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? "";

  const runtime = new WorkWeaveRuntime({
    homeDir,
    platform,
    ...(options.env !== undefined ? { env: options.env } : {})
  });

  await runtime.probe();
  const ingest = await runtime.ingest(options.day);
  await runtime.classify(options.day);
  await runtime.evidence(options.day);

  const guard = new PathGuard({ allowedExportRoots: [dirname(options.out)] });
  await guard.assertExportable(dirname(options.out));
  const exported = await runtime.exportReport(
    options.day,
    options.out,
    options.format ?? "markdown"
  );

  return {
    reportPath: exported.path,
    dataVersion: exported.dataVersion,
    sessionCount: ingest.sessionCount,
    skippedSources: ingest.skippedSources
  };
}

export function defaultReportPath(day: string): string {
  return join(process.cwd(), `workweave-report-${day}.md`);
}