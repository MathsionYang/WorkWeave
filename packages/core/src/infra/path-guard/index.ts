import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { WorkWeaveError } from "../../domain/errors.js";

const HARD_DENY_PATTERNS: readonly RegExp[] = [
  /(^|[\\/])settings\.json$/i,
  /(^|[\\/])\.credentials(\.yaml|\.yml|\.json)?$/i,
  /(^|[\\/])\.env(\.|$)/i,
  /(^|[\\/])keyblob$/i,
  /(^|[\\/])security([\\/]|$)/i,
  /(^|[\\/])storages([\\/]|$)/i,
  /(^|[\\/])\.sandbox-secrets([\\/]|$)/i,
  /(^|[\\/])login-device-nonce$/i,
  /(^|[\\/])device-id(\.machine)?$/i,
  /(^|[\\/])mcp-approvals\.json$/i,
  /(^|[\\/])SOUL\.md$/i,
  /(^|[\\/])USER\.md$/i,
  /(^|[\\/])IDENTITY\.md$/i
];

export interface PathGuardOptions {
  readonly homeDir?: string;
  readonly allowedExportRoots?: readonly string[];
}

export function expandHome(input: string, homeDir = homedir()): string {
  if (input === "~") return homeDir;
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return join(homeDir, input.slice(2));
  }
  return input;
}

export function normalizeAbsolute(input: string, base = process.cwd(), homeDir = homedir()): string {
  const expanded = expandHome(input, homeDir);
  return resolve(isAbsolute(expanded) ? expanded : join(base, expanded));
}

export function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}

export function isDeniedPath(candidate: string): boolean {
  const normalized = candidate.replaceAll("/", sep);
  return HARD_DENY_PATTERNS.some((pattern) => pattern.test(normalized));
}

async function assertNoLinks(root: string, target: string): Promise<void> {
  let current = root;
  const rel = relative(root, target);
  if (rel === "") return;
  const segments = rel.split(sep).filter(Boolean);
  for (const segment of segments) {
    current = join(current, segment);
    const stats = await lstat(current);
    if (stats.isSymbolicLink()) {
      throw new WorkWeaveError("E-SRC-005", `不允许的符号链接或目录联接: ${current}`);
    }
  }
}

export class PathGuard {
  private readonly homeDir: string;
  private readonly allowedExportRoots: readonly string[];

  constructor(options: PathGuardOptions = {}) {
    this.homeDir = options.homeDir ?? homedir();
    this.allowedExportRoots = options.allowedExportRoots ?? [];
  }

  normalize(input: string): string {
    return normalizeAbsolute(input, process.cwd(), this.homeDir);
  }

  async assertCollectable(requested: string, sourceRoot: string): Promise<string> {
    const root = this.normalize(sourceRoot);
    const target = this.normalize(requested);

    if (!isWithin(root, target)) {
      throw new WorkWeaveError("E-SRC-005", `请求路径不在来源根目录内: ${requested}`);
    }
    if (isDeniedPath(target)) {
      throw new WorkWeaveError("E-SRC-005", `请求路径命中硬排除清单: ${requested}`);
    }

    const realRoot = await realpath(root);
    const realTarget = await realpath(target);
    if (!isWithin(realRoot, realTarget)) {
      throw new WorkWeaveError("E-SRC-005", `realpath 校验越界: ${requested}`);
    }
    await assertNoLinks(realRoot, realTarget);
    return realTarget;
  }

  async assertExportable(targetDir: string): Promise<string> {
    const target = this.normalize(targetDir);
    const roots = this.allowedExportRoots.map((root) => this.normalize(root));
    if (roots.length > 0 && !roots.some((root) => isWithin(root, target))) {
      throw new WorkWeaveError("E-SRC-005", `导出目录不在白名单内: ${targetDir}`);
    }
    const realTarget = await realpath(target);
    for (const root of roots) {
      const realRoot = await realpath(root);
      if (isWithin(realRoot, realTarget)) {
        await assertNoLinks(realRoot, realTarget);
      }
    }
    return realTarget;
  }
}