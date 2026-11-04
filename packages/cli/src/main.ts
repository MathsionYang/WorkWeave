#!/usr/bin/env node
import { homedir, platform as osPlatform } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProbeService } from "@workweave/core";
import type { Platform, SourceTool } from "@workweave/core";
import { defaultReportPath, runReportCommand } from "./report-command.js";

function parsePlatform(value: string | undefined): Platform {
  if (value === "win32" || value === "darwin" || value === "linux") return value;
  const current = osPlatform();
  return current === "win32" || current === "darwin" ? current : "linux";
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseFormat(value: string | undefined): "markdown" | "json" | "html" | "pdf" {
  if (value === "json" || value === "html" || value === "pdf") return value;
  return "markdown";
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const command = argv[0] ?? "probe";

  if (command === "report") {
    const dayArg = argv.find((arg) => arg.startsWith("--day="));
    const outArg = argv.find((arg) => arg.startsWith("--out="));
    const homeArg = argv.find((arg) => arg.startsWith("--home="));
    const formatArg = argv.find((arg) => arg.startsWith("--format="));
    const day = dayArg?.split("=")[1] ?? today();
    const out = outArg?.split("=")[1] ?? defaultReportPath(day);
    const result = await runReportCommand({
      day,
      out,
      ...(homeArg?.split("=")[1] !== undefined ? { homeDir: homeArg.split("=")[1] } : {}),
      platform: parsePlatform(argv.find((arg) => arg.startsWith("--platform="))?.split("=")[1]),
      format: parseFormat(formatArg?.split("=")[1])
    });
    console.log(`report=${result.reportPath}`);
    console.log(`dataVersion=${result.dataVersion}`);
    console.log(`sessions=${result.sessionCount}`);
    console.log(`skipped=${result.skippedSources.join(",") || "-"}`);
    return 0;
  }

  if (command !== "probe") {
    console.error(`unknown command: ${command}`);
    return 2;
  }

  const homeArg = argv.find((arg) => arg.startsWith("--home="));
  const platformArg = argv.find((arg) => arg.startsWith("--platform="));
  const sources: readonly SourceTool[] = ["codex", "claude", "workbuddy", "dsh"];
  const service = new ProbeService();
  const results = await Promise.all(
    sources.map((source) =>
      service.probe({
        source,
        platform: parsePlatform(platformArg?.split("=")[1]),
        homeDir: homeArg?.split("=")[1] ?? homedir()
      })
    )
  );

  for (const result of results) {
    const completeness = result.completeness.status === "complete" ? "complete" : "possibly-incomplete";
    console.log(
      `${result.source}\t${result.status}\t${completeness}\t${result.adoptedPath ?? "-"}\t${result.warnings.join(",")}`
    );
  }
  return 0;
}

const modulePath = resolve(fileURLToPath(import.meta.url));
const entryPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
const isEntry =
  entryPath.length > 0 &&
  (process.platform === "win32"
    ? modulePath.toLowerCase() === entryPath.toLowerCase()
    : modulePath === entryPath);
if (isEntry) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}