import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { SourceTool } from "../domain/types.js";
import type { EnvCandidateState } from "../domain/models.js";

export const SOURCE_ENV_VARS: Readonly<Record<SourceTool, string>> = {
  codex: "CODEX_HOME",
  claude: "CLAUDE_CONFIG_DIR",
  workbuddy: "WORKBUDDY_HOME",
  dsh: "DSH_HOME"
};

export interface EnvReadInput {
  readonly source: SourceTool;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
}

const PLACEHOLDER = /(%[A-Za-z_][A-Za-z0-9_]*%|\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*)/;

function expandPlaceholders(value: string, env: NodeJS.ProcessEnv): string | undefined {
  const expanded = value
    .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (_, name: string) => env[name] ?? "")
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => env[name] ?? "")
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => env[name] ?? "");
  return PLACEHOLDER.test(expanded) ? undefined : expanded;
}

export async function readEnvCandidate(input: EnvReadInput): Promise<EnvCandidateState & { readonly path?: string }> {
  const env = input.env ?? process.env;
  const home = input.homeDir ?? homedir();
  const variable = SOURCE_ENV_VARS[input.source];
  const raw = env[variable];

  if (raw === undefined) {
    return { variable, state: "unset" };
  }
  if (raw.trim() === "") {
    return { variable, state: "empty" };
  }

  const expanded = expandPlaceholders(raw.trim(), env);
  if (expanded === undefined) {
    return { variable, state: "placeholder", detail: "environment variable contains unresolved placeholder" };
  }

  const withHome = expanded === "~" || expanded.startsWith("~/") || expanded.startsWith("~\\")
    ? join(home, expanded.length > 1 ? expanded.slice(2) : "")
    : expanded;

  const absolute = isAbsolute(withHome) ? withHome : resolve(home, withHome);
  if (!isAbsolute(withHome)) {
    return { variable, state: "relative", detail: `resolved relative path against home: ${absolute}`, path: absolute };
  }

  try {
    const stats = await stat(absolute);
    if (!stats.isDirectory()) {
      return { variable, state: "file", detail: `path is not a directory: ${absolute}`, path: absolute };
    }
    return { variable, state: "ok", path: absolute };
  } catch {
    return { variable, state: "missing", detail: `path does not exist: ${absolute}`, path: absolute };
  }
}