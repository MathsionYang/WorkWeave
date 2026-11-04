import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Instant, Platform, ProbeStatus, SourceTool } from "../domain/types.js";
import type {
  CompletenessDeclaration,
  EnvCandidateState,
  ProbeCandidate,
  ProbeSourceResult
} from "../domain/models.js";
import { resolveCandidates } from "./candidate-resolver.js";
import { readEnvCandidate } from "./env.js";
import { analyzeIntegrity, type IntegrityInput } from "./integrity.js";
import { platformCandidates } from "./platform-paths.js";

export interface ProbeRequest {
  readonly source: SourceTool;
  readonly platform: Platform;
  readonly homeDir: string;
  readonly appData?: string;
  readonly localAppData?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly manualPath?: string;
  readonly configuredRulePath?: string;
  readonly integrity?: Partial<IntegrityInput>;
  readonly now?: Date;
}

interface CacheEntry {
  readonly result: ProbeSourceResult;
  readonly atMs: number;
  readonly signature: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const REQUIRED_SUBDIRS: Readonly<Record<SourceTool, readonly string[]>> = {
  codex: ["sessions", "archived_sessions"],
  claude: ["projects", "sessions"],
  workbuddy: ["projects", "sessions"],
  dsh: ["sessions"]
};

async function isDirectory(path: string): Promise<{ exists: boolean; directory: boolean; unreadable: boolean }> {
  try {
    await access(path);
    const stats = await stat(path);
    return { exists: true, directory: stats.isDirectory(), unreadable: false };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return { exists: true, directory: false, unreadable: true };
    }
    return { exists: false, directory: false, unreadable: false };
  }
}

async function validateShape(source: SourceTool, path: string): Promise<ProbeCandidate["validation"]> {
  const root = await isDirectory(path);
  if (!root.exists) return "missing";
  if (root.unreadable) return "unreadable";
  if (!root.directory) return "not-a-directory";
  if (source === "claude") return "valid";

  for (const required of REQUIRED_SUBDIRS[source]) {
    const candidate = await isDirectory(join(path, required));
    if (candidate.directory) return "valid";
  }
  return "shape-mismatch";
}

function statusOf(
  adopted: ProbeCandidate | undefined,
  completeness: CompletenessDeclaration,
  candidates: readonly ProbeCandidate[]
): ProbeStatus {
  if (adopted !== undefined) {
    return completeness.status === "possibly-incomplete" ? "partially-available" : "discovered";
  }
  if (candidates.some((candidate) => candidate.validation === "unreadable")) return "permission-denied";
  if (candidates.some((candidate) => candidate.validation === "shape-mismatch")) return "unsupported-format";
  return "not-found";
}

export class ProbeService {
  private readonly cache = new Map<SourceTool, CacheEntry>();

  async probe(request: ProbeRequest): Promise<ProbeSourceResult> {
    const env = request.env ?? process.env;
    const now = request.now ?? new Date();
    const envState = await readEnvCandidate({
      source: request.source,
      env,
      homeDir: request.homeDir
    });

    const signature = [
      request.source,
      request.platform,
      request.manualPath ?? "",
      request.configuredRulePath ?? "",
      env[request.source === "codex" ? "CODEX_HOME" : request.source === "claude" ? "CLAUDE_CONFIG_DIR" : request.source === "workbuddy" ? "WORKBUDDY_HOME" : "DSH_HOME"] ?? ""
    ].join("|");

    const cached = this.cache.get(request.source);
    if (
      cached !== undefined &&
      cached.signature === signature &&
      now.getTime() - cached.atMs < CACHE_TTL_MS
    ) {
      return { ...cached.result, fromCache: true };
    }

    const candidates: ProbeCandidate[] = [];
    const envValidation = envState.state === "ok"
      ? await validateShape(request.source, envState.path ?? "")
      : envState.state === "file"
        ? "not-a-directory"
        : envState.state === "missing"
          ? "missing"
          : envState.state === "empty" || envState.state === "unset"
            ? "missing"
            : "shape-mismatch";

    if (request.manualPath !== undefined) {
      const validation = await validateShape(request.source, request.manualPath);
      candidates.push({
        source: request.source,
        layer: "manual",
        path: request.manualPath,
        rank: 0,
        validation,
        hit: validation === "valid" ? "adopted" : "invalid"
      });
    }

    if (request.configuredRulePath !== undefined) {
      const validation = await validateShape(request.source, request.configuredRulePath);
      candidates.push({
        source: request.source,
        layer: "configured-rule",
        path: request.configuredRulePath,
        rank: 1,
        validation,
        hit: validation === "valid" ? "adopted" : "invalid"
      });
    }

    if (envState.path !== undefined) {
      candidates.push({
        source: request.source,
        layer: "env",
        path: envState.path,
        rank: 2,
        validation: envValidation,
        hit: envValidation === "valid" ? "adopted" : "invalid",
        detail: envState.detail
      });
    }

    for (const platformCandidate of platformCandidates(request.source, {
      platform: request.platform,
      homeDir: request.homeDir,
      appData: request.appData,
      localAppData: request.localAppData
    })) {
      const validation = await validateShape(request.source, platformCandidate.path);
      candidates.push({
        source: request.source,
        layer: platformCandidate.layer,
        path: platformCandidate.path,
        platform: platformCandidate.platform,
        rank: 3,
        validation,
        hit: validation === "valid" ? "adopted" : "invalid"
      });
    }

    const resolution = resolveCandidates(candidates);
    const adopted = resolution.adopted;

    const rootState = adopted === undefined
      ? { exists: false, directory: false, unreadable: false }
      : await isDirectory(adopted.path);

    let inferredReadableTypes: readonly ("code" | "desktop")[] | undefined;
    if (request.source === "claude" && adopted !== undefined) {
      const hasCode =
        adopted.path.endsWith(".claude") ||
        (await isDirectory(join(adopted.path, "projects"))).directory ||
        (await isDirectory(join(adopted.path, "sessions"))).directory;
      const hasDesktop = candidates.some(
        (candidate) =>
          candidate !== adopted &&
          candidate.validation === "valid" &&
          !candidate.path.endsWith(".claude")
      );
      inferredReadableTypes = [
        ...(hasCode ? (["code"] as const) : []),
        ...(hasDesktop ? (["desktop"] as const) : [])
      ];
    }

    const integrity = analyzeIntegrity({
      source: request.source,
      rootExists: rootState.exists,
      rootReadable: rootState.directory && !rootState.unreadable,
      hasAnyReadableRecord: adopted !== undefined,
      hasAnyCompletenessBasis: false,
      ...(inferredReadableTypes !== undefined ? { readableTypes: inferredReadableTypes } : {}),
      ...(request.integrity ?? {})
    });

    const status = statusOf(adopted, integrity, candidates);
    const warnings = status === "partially-available" ? ["E-SRC-003"] : [];

    const result: ProbeSourceResult = {
      source: request.source,
      status,
      adoptedPath: adopted?.path,
      candidates: candidates.map((candidate) => ({
        ...candidate,
        hit: candidate === adopted ? "adopted" : candidate.validation === "valid" ? "ignored" : "invalid"
      })),
      env: envState satisfies EnvCandidateState,
      completeness: integrity,
      warnings,
      probedAt: now.toISOString() as Instant,
      fromCache: false
    };

    this.cache.set(request.source, { result, atMs: now.getTime(), signature });
    return result;
  }

  invalidate(source?: SourceTool): void {
    if (source === undefined) {
      this.cache.clear();
    } else {
      this.cache.delete(source);
    }
  }
}