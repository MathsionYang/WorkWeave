import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const COPY_SUFFIX = /(\s*-\s*副本|\s*\(1\)|\s+copy|\s+copy\s*\d+|_copy)$/i;
const UNREADABLE = /^(SATBin\d+|\d{4}[-_]\d{2}[-_]\d{2}[T_-].*|[0-9a-f]{8,}|tmp|temp|untitled)$/i;

export interface ProjectNameResult {
  readonly name?: string;
  readonly reason: string;
}

function clean(name: string): string {
  return name.replace(COPY_SUFFIX, "").trim();
}

function packageNameAt(dir: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.length > 0 ? clean(parsed.name) : undefined;
  } catch {
    return undefined;
  }
}

function readableOrParent(dir: string): string | undefined {
  const name = clean(basename(dir));
  if (name.length > 0 && !UNREADABLE.test(name)) return name;
  const parent = clean(basename(dirname(dir)));
  if (parent.length > 0 && !UNREADABLE.test(parent)) return parent;
  return undefined;
}

export function deriveProjectName(workDir?: string): ProjectNameResult {
  if (workDir === undefined || workDir.trim().length === 0) {
    return { reason: "no workDir" };
  }

  let current = resolve(workDir);
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(current, ".git"))) {
      const repoName = readableOrParent(current);
      if (repoName !== undefined) return { name: repoName, reason: `git repository root: ${current}` };
    }
    const packageName = packageNameAt(current);
    if (packageName !== undefined && !UNREADABLE.test(packageName)) {
      return { name: packageName, reason: `package.json name at ${current}` };
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const fallback = readableOrParent(resolve(workDir));
  return fallback === undefined
    ? { reason: `unreadable workDir: ${workDir}` }
    : { name: fallback, reason: `structured path fallback: ${workDir}` };
}