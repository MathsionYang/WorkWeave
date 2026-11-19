import { homedir } from "node:os";
import { WorkWeaveRuntime } from "@workweave/mcp";
import type { Platform, SourceTool } from "@workweave/core";

export interface IngestCommandOptions {
  readonly day?: string;
  readonly dayFrom?: string;
  readonly dayTo?: string;
  readonly source?: SourceTool;
  readonly resume?: boolean;
  readonly homeDir?: string;
  readonly platform?: Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly dbPath?: string;
}

export async function runIngestCommand(options: IngestCommandOptions) {
  const runtime = new WorkWeaveRuntime({
    homeDir: options.homeDir ?? homedir(),
    platform: options.platform ?? (process.platform === "win32" || process.platform === "darwin" ? process.platform : "linux"),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.dbPath !== undefined ? { dbPath: options.dbPath } : {})
  });
  try {
    await runtime.probe(options.source === undefined ? undefined : [options.source]);
    const sources = options.source === undefined ? undefined : [options.source];
    if (options.dayFrom !== undefined || options.dayTo !== undefined) {
      if (options.dayFrom === undefined || options.dayTo === undefined || options.day !== undefined) {
        throw new TypeError("provide either day or both dayFrom and dayTo");
      }
      return await runtime.ingestRange(options.dayFrom, options.dayTo, sources, options.resume ?? false);
    }
    return await runtime.ingest(options.day ?? new Date().toISOString().slice(0, 10), sources, options.resume ?? false);
  } finally {
    runtime.close();
  }
}
