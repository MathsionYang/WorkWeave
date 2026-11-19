import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CodexAdapter,
  DshAdapter,
  WorkBuddyAdapter
} from "@workweave/adapters";
import {
  PdfKitEngine,
  PdfRenderer,
  ProbeService,
  SqliteFactStore,
  WorkWeaveError,
  aggregateAdoption,
  aggregateResearch,
  asPlainDate,
  asProjectId,
  buildEvidencePackage,
  buildFactReport,
  buildWeeklyReport,
  classifySessions,
  decideAdoption,
  detectResearchFindings,
  exportReportAtomic,
  getSkillTemplate,
  groupExactPromptHits,
  isNoiseText,
  pairInteractions,
  parseSubmissionFacts,
  parseTestResult,
  renderHtml,
  renderMarkdown,
  resolveEvidence,
  redact,
  runMigrations,
  sessionForDateRange,
  validateSubmission
} from "@workweave/core";
import type {
  AdoptionDecision,
  ClassificationSignal,
  ClassifiedSession,
  CompletenessDeclaration,
  HostSubmission,
  FactReport,
  ParsedSession,
  Platform,
  ProbeSourceResult,
  SourceAdapter,
  SourceTool,
  MessageSearchQuery,
  SessionListQuery,
  StructuredEvidencePackage,
  SubmissionLike,
  TestFact
} from "@workweave/core";
import type { ToolHandler, ToolInvocation } from "./types.js";

export interface RuntimeOptions {
  readonly homeDir: string;
  readonly platform: Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly sources?: readonly SourceTool[];
  readonly dbPath?: string;
  readonly adapters?: Partial<Record<SourceTool, SourceAdapter>>;
  readonly sourceRoots?: Partial<Record<SourceTool, string>>;
}

const ALL_SOURCES: readonly SourceTool[] = ["codex", "claude", "workbuddy", "dsh"];
const OBSERVATION_WINDOW_MS = 24 * 60 * 60 * 1000;

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code.slice(0, 40) : "parse-error";
}

function isTransientIngestError(error: unknown): boolean {
  return ["EIO", "EBUSY", "EMFILE", "ETIMEDOUT", "SQLITE_BUSY"].includes(errorCode(error));
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function extractFacts(sessions: readonly ParsedSession[]): { tests: TestFact[]; submissions: SubmissionLike[] } {
  const tests: TestFact[] = [];
  const submissions: SubmissionLike[] = [];
  for (const session of sessions) {
    for (const message of session.messages) {
      if (isNoiseText(message.text)) continue;
      const text = message.text ?? "";
      if (/^(Arguments|\{)/.test(text.trim())) continue;
      const hasTestCommand = /(jest|vitest|pytest|npm\s+test|go\s+test|cargo\s+test|mvn\s+test|gradle\s+test)/i.test(text);
      const hasCountResult = /(Tests?:\s*\d+|\d+[^\n]{0,24}(passed|failed))/i.test(text);
      if ((hasTestCommand || hasCountResult) && /(passed|failed|pass|fail|\u901a\u8fc7|\u5931\u8d25|\u963b\u585e|\u672a\u6267\u884c)/i.test(text)) {
        tests.push(parseTestResult({ sessionId: session.sessionId, projectId: asProjectId("unassigned"), command: text, output: text }));
      }
      submissions.push(...parseSubmissionFacts({ sessionId: session.sessionId, command: text, output: text }));
    }
  }
  return { tests, submissions };
}

function requiredString(invocation: ToolInvocation, name: string): string {
  const value = invocation.params?.[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorkWeaveError("E-MCP-003", `missing or invalid parameter: ${name}`);
  }
  return value;
}

export class WorkWeaveRuntime {
  private readonly probeService = new ProbeService();
  private readonly adapters: ReadonlyMap<SourceTool, SourceAdapter>;
  private readonly sources: readonly SourceTool[];
  private readonly sessionsByDay = new Map<string, ParsedSession[]>();
  private readonly classificationsByDay = new Map<string, ClassifiedSession[]>();
  private readonly testsByDay = new Map<string, TestFact[]>();
  private readonly submissionsByDay = new Map<string, SubmissionLike[]>();
  private readonly probeBySource = new Map<SourceTool, ProbeSourceResult>();
  private readonly packages = new Map<string, StructuredEvidencePackage>();
  private readonly store: SqliteFactStore;

  constructor(private readonly options: RuntimeOptions) {
    this.sources = options.sources ?? ALL_SOURCES;
    this.adapters = new Map<SourceTool, SourceAdapter>([
      ["codex", options.adapters?.codex ?? new CodexAdapter()],
      ["workbuddy", options.adapters?.workbuddy ?? new WorkBuddyAdapter()],
      ["dsh", options.adapters?.dsh ?? new DshAdapter()]
    ]);
    const databasePath = options.dbPath ?? join(options.homeDir, ".workweave", "workweave.sqlite");
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.store = SqliteFactStore.open(databasePath);
    runMigrations(this.store.database);
  }

  close(): void {
    this.store.close();
  }

  async probe(sources: readonly SourceTool[] = this.sources): Promise<readonly ProbeSourceResult[]> {
    const results: ProbeSourceResult[] = [];
    for (const source of sources) {
      const result = await this.probeService.probe({
        source,
        platform: this.options.platform,
        homeDir: this.options.homeDir,
        ...(this.options.env !== undefined ? { env: this.options.env } : {})
      });
      const rooted = this.options.sourceRoots?.[source] === undefined
        ? result
        : { ...result, adoptedPath: this.options.sourceRoots[source] };
      this.probeBySource.set(source, rooted);
      results.push(rooted);
    }
    return results;
  }

  async ingest(day: string, requestedSources?: readonly SourceTool[], resume = false) {
    return this.ingestRange(day, day, requestedSources, resume);
  }

  async ingestRange(dayFrom: string, dayTo: string, requestedSources?: readonly SourceTool[], resume = false): Promise<{
    readonly day: string;
    readonly sessionCount: number;
    readonly messageCount: number;
    readonly dataVersion: string;
    readonly warnings: readonly string[];
    readonly skippedSources: readonly SourceTool[];
    readonly completedFiles: number;
    readonly failedFiles: number;
    readonly resumedFiles: number;
  }> {
    if (!validDate(dayFrom) || !validDate(dayTo) || dayFrom > dayTo) {
      throw new WorkWeaveError("E-MCP-003", "dayFrom and dayTo must be valid dates with dayFrom <= dayTo");
    }
    const day = dayFrom === dayTo ? dayFrom : `${dayFrom}..${dayTo}`;
    if (this.probeBySource.size === 0) await this.probe();
    let sessions: ParsedSession[] = [];
    const warnings: string[] = [];
    const skippedSources: SourceTool[] = [];
    let completedFiles = 0;
    let failedFiles = 0;
    let resumedFiles = 0;

    for (const source of requestedSources ?? this.sources) {
      const adapter = this.adapters.get(source);
      const probe = this.probeBySource.get(source);
      if (adapter === undefined || probe?.adoptedPath === undefined) {
        skippedSources.push(source);
        continue;
      }
      const runId = `ingest:${day}:${source}`;
      this.store.beginIngestRun(runId, day, source);
      for await (const sourceFile of adapter.scan(probe.adoptedPath)) {
        let fingerprint: string;
        let fingerprintAttempts = 0;
        let fingerprintError: unknown;
        try {
          let info;
          let content: Buffer | undefined;
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            fingerprintAttempts = attempt;
            try {
              info = await stat(sourceFile);
              content = await readFile(sourceFile);
              fingerprintError = undefined;
              break;
            } catch (error) {
              fingerprintError = error;
              if (!isTransientIngestError(error) || attempt === 3) break;
              await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** (attempt - 1)));
            }
          }
          if (info === undefined || content === undefined) throw fingerprintError;
          fingerprint = `${sourceFile}:${info.size}:${info.mtimeMs}:${createHash("sha256").update(content).digest("hex")}`;
        } catch (error) {
          failedFiles += 1;
          warnings.push(`source-read-failed:${source}:${errorCode(error)}`);
          this.store.saveIngestCheckpoint({ runId, sourceTool: source, sourcePath: sourceFile,
            fingerprint: "unreadable", status: "failed", attempts: fingerprintAttempts, errorCode: errorCode(error) });
          continue;
        }

        const prior = this.store.getIngestCheckpoint(runId, source, sourceFile);
        if (resume && prior?.status === "completed" && prior.fingerprint === fingerprint) {
          resumedFiles += 1;
          continue;
        }

        let parsed: ParsedSession | undefined;
        let failure: unknown;
        let attemptsThisRun = 0;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          attemptsThisRun = attempt;
          try {
            parsed = await adapter.parse(sourceFile);
            failure = undefined;
            break;
          } catch (error) {
            failure = error;
            if (!isTransientIngestError(error) || attempt === 3) break;
            await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** (attempt - 1)));
          }
        }
        if (parsed === undefined) {
          failedFiles += 1;
          warnings.push(`source-parse-failed:${source}:${errorCode(failure)}`);
          this.store.saveIngestCheckpoint({ runId, sourceTool: source, sourcePath: sourceFile, fingerprint,
            status: "failed", attempts: (prior?.attempts ?? 0) + attemptsThisRun, errorCode: errorCode(failure) });
          continue;
        }

        const session = sessionForDateRange(parsed, dayFrom, dayTo);
        if (session !== undefined) {
          this.store.upsertSession(session);
        }
        // Valid files with no messages on this day are complete too; they are not parse failures.
        this.store.saveIngestCheckpoint({ runId, sourceTool: source, sourcePath: sourceFile, fingerprint,
          status: "completed", attempts: (prior?.attempts ?? 0) + attemptsThisRun });
        completedFiles += 1;
      }

      this.store.finishIngestRun(runId);
    }

    sessions = [];
    for (const source of requestedSources ?? this.sources) {
      let offset = 0;
      while (true) {
        const page = this.store.listSessions({ dayFrom, dayTo, sourceTool: source, limit: 100, offset });
        for (const item of page.items) {
          const stored = this.store.getSession(source, item.sessionId);
          const inRange = stored === undefined ? undefined : sessionForDateRange(stored as ParsedSession, dayFrom, dayTo);
          if (inRange !== undefined) sessions.push({ ...inRange, unknownTypeCount: 0, gaps: [], sourceFile: "" });
        }
        if (!page.hasMore) break;
        offset += page.items.length;
      }
    }
    for (let date = dayFrom; date <= dayTo; date = new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)) {
      const dailySessions = sessions.flatMap((session) => {
        const daily = sessionForDateRange(session, date, date);
        return daily === undefined ? [] : [daily];
      });
      const dailyFacts = extractFacts(dailySessions);
      this.sessionsByDay.set(date, dailySessions);
      this.testsByDay.set(date, dailyFacts.tests);
      this.submissionsByDay.set(date, dailyFacts.submissions);
    }
    const dataVersion = sessions.length === 0
      ? "no-data"
      : createHash("sha256").update(sessions.map((session) => `${session.sourceTool}:${session.sessionId}:${session.messages.map((message) => message.messageId).join("|")}`).sort().join("\n")).digest("hex").slice(0, 16);

    return {
      day,
      sessionCount: sessions.length,
      messageCount: sessions.reduce((sum, session) => sum + session.messages.length, 0),
      dataVersion,
      warnings,
      skippedSources,
      completedFiles,
      failedFiles,
      resumedFiles
    };
  }

  async classify(day: string): Promise<readonly ClassifiedSession[]> {
    const sessions = await this.sessionsFor(day);
    const signals: ClassificationSignal[] = sessions.map((session) => ({
      sessionId: session.sessionId,
      sourceTool: session.sourceTool,
      ...(session.workDir !== undefined ? { workDir: session.workDir } : {}),
      ...(session.title !== undefined ? { title: session.title } : {}),
      messages: session.messages
        .filter((message) => !isNoiseText(message.text))
        .map((message) => ({
          role: message.role,
          ...(message.text !== undefined ? { text: message.text } : {})
        }))
    }));
    const classifications = classifySessions(signals);
    for (let index = 0; index < sessions.length; index += 1) {
      const session = sessions[index];
      const classification = classifications[index];
      if (session !== undefined && classification !== undefined) {
        this.store.setSessionProject(session.sourceTool, session.sessionId, classification.projectId);
      }
    }
    this.classificationsByDay.set(day, [...classifications]);
    return classifications;
  }

  listSessions(query: SessionListQuery = {}) {
    const result = this.store.listSessions(query);
    return {
      ...result,
      items: result.items.map(({ workDir: _workDir, title, ...item }) => ({
        ...item,
        ...(title !== undefined ? { title: redact(title, "evidence").text } : {})
      }))
    };
  }

  readSession(sourceTool: SourceTool, sessionId: string, options: { readonly limit?: number; readonly offset?: number } = {}) {
    const page = this.store.readSessionPage(sourceTool, sessionId, options);
    if (page === undefined) return undefined;
    let remaining = 12_000;
    let truncated = false;
    const messages = page.messages.map((message) => {
      if (message.text === undefined) return message;
      const sanitized = redact(message.text, "evidence").text;
      const safeText = sanitized.slice(0, Math.min(2_000, remaining));
      if (safeText.length < sanitized.length) truncated = true;
      remaining -= safeText.length;
      return { ...message, text: safeText };
    });
    const { workDir: _workDir, title, ...session } = page.session;
    return {
      ...page,
      session: { ...session, ...(title !== undefined ? { title: redact(title, "evidence").text } : {}) },
      messages,
      warnings: truncated ? ["content-truncated"] : []
    };
  }

  searchSessions(query: MessageSearchQuery) {
    const result = this.store.searchMessages(query);
    const items = groupExactPromptHits(result.items).map((hit) => ({
      ...hit,
      text: redact(hit.text, "evidence").text.slice(0, 800)
    }));
    return { ...result, items, total: items.length, hasMore: query.offset !== undefined && query.offset > 0 ? false : result.hasMore };
  }

  async facts(day: string): Promise<{
    readonly day: string;
    readonly tests: readonly TestFact[];
    readonly submissions: readonly SubmissionLike[];
  }> {
    await this.sessionsFor(day);
    return {
      day,
      tests: this.testsByDay.get(day) ?? [],
      submissions: this.submissionsByDay.get(day) ?? []
    };
  }

  async evidence(day: string, maxEntries?: number): Promise<StructuredEvidencePackage> {
    const sessions = await this.sessionsFor(day);
    const classifications = await this.classificationsFor(day);
    const tests = this.testsByDay.get(day) ?? [];
    const submissions = this.submissionsByDay.get(day) ?? [];
    const adoption = this.adoptionFor(day, sessions, submissions);
    const pending = this.completeness().gaps.map((gap) => `${gap.source}:${gap.type}:${gap.scope}`);

    const pkg = buildEvidencePackage({
      dataVersion: this.dataVersionOf(sessions),
      range: { from: asPlainDate(day), to: asPlainDate(day) },
      sessions,
      classifications,
      tests,
      submissions,
      adoption: adoption.decisions,
      research: this.researchFor(day, sessions),
      pending,
      completeness: this.completeness(),
      ...(maxEntries !== undefined ? { maxEntries } : {})
    });
    this.packages.set(pkg.packageId, pkg);
    return pkg;
  }

  private async buildReportForDay(day: string) {
    const sessions = await this.sessionsFor(day);
    const classifications = await this.classificationsFor(day);
    const submissions = this.submissionsByDay.get(day) ?? [];
    const adoption = this.adoptionFor(day, sessions, submissions);
    const report = buildFactReport({
      day: asPlainDate(day),
      dataVersion: this.dataVersionOf(sessions),
      sessions,
      classifications,
      tests: this.testsByDay.get(day) ?? [],
      submissions,
      adoption: adoption.stats,
      research: this.researchFor(day, sessions),
      completenessBySource: this.completenessBySource()
    });

    return report;
  }

  async exportReport(day: string, out: string, format = "markdown"): Promise<{ readonly path: string; readonly dataVersion: string }> {
    return this.exportReportRange(day, day, out, format);
  }

  async exportReportRange(
    dayFrom: string,
    dayTo: string,
    out: string,
    format = "markdown"
  ): Promise<{ readonly path: string; readonly dataVersion: string }> {
    if (!validDate(dayFrom) || !validDate(dayTo) || dayFrom > dayTo) {
      throw new WorkWeaveError("E-MCP-003", "dayFrom and dayTo must be valid dates with dayFrom <= dayTo");
    }
    const reports: FactReport[] = [];
    for (let current = dayFrom; current <= dayTo; current = new Date(Date.parse(`${current}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)) {
      reports.push(await this.buildReportForDay(current));
    }
    const report = dayFrom === dayTo ? reports[0] : buildWeeklyReport(reports, reports.map((item) => item.range.from));
    if (report === undefined) throw new WorkWeaveError("E-MCP-003", "report range contains no days");

    let content: string | Buffer;
    if (format === "json") {
      content = JSON.stringify(report, null, 2);
    } else if (format === "html") {
      content = renderHtml(report);
    } else if (format === "pdf") {
      content = await new PdfRenderer(new PdfKitEngine()).render(report);
    } else {
      content = renderMarkdown(report);
    }

    await exportReportAtomic(out, content);
    return { path: out, dataVersion: report.dataVersion };
  }

  async validate(packageId: string, templateVersion: string, sections: unknown): Promise<unknown> {
    const pkg = this.packages.get(packageId);
    if (pkg === undefined) throw new WorkWeaveError("E-PKG-001", `unknown package: ${packageId}`);
    if (typeof sections !== "object" || sections === null || Array.isArray(sections)) {
      throw new WorkWeaveError("E-MCP-003", "sections must be an object");
    }
    return validateSubmission(
      {
        packageId,
        templateVersion,
        sections: sections as HostSubmission["sections"]
      },
      pkg
    );
  }

  async managePending(
    day: string,
    type?: string,
    action: "query" | "confirm" | "ignore" = "query",
    id?: string,
  ): Promise<readonly { id: number; source: string; type: string; scope: string; status: string }[]> {
    void day;
    if (this.probeBySource.size === 0) await this.probe();
    for (const gap of this.completeness().gaps) {
      this.store.addPendingIfMissing(gap.source, "record-integrity", `${gap.type}:${gap.scope}`, gap.basis);
    }
    if (action !== "query" && id !== undefined) {
      this.store.setPendingStatus(Number(id), action === "confirm" ? "confirmed" : "ignored");
    }
    return this.store.listPending(type);
  }

  async resolve(packageId: string, evidenceId: string): Promise<unknown> {
    const pkg = this.packages.get(packageId);
    if (pkg === undefined) throw new WorkWeaveError("E-PKG-001", `unknown package: ${packageId}`);
    return resolveEvidence(pkg, evidenceId);
  }

  private async sessionsFor(day: string): Promise<readonly ParsedSession[]> {
    if (!this.sessionsByDay.has(day)) await this.ingest(day);
    return this.sessionsByDay.get(day) ?? [];
  }

  private async classificationsFor(day: string): Promise<readonly ClassifiedSession[]> {
    if (!this.classificationsByDay.has(day)) await this.classify(day);
    return this.classificationsByDay.get(day) ?? [];
  }

  private completenessBySource(): Partial<Record<SourceTool, CompletenessDeclaration>> {
    const result: Partial<Record<SourceTool, CompletenessDeclaration>> = {};
    for (const [source, probe] of this.probeBySource) {
      if (probe.completeness.status === "possibly-incomplete") {
        result[source] = probe.completeness;
      }
    }
    return result;
  }

  private completeness(): CompletenessDeclaration {
    const declarations = [...this.probeBySource.values()].map((probe) => probe.completeness);
    const gaps = declarations.flatMap((declaration) => declaration.gaps);
    const incomplete = declarations.some((declaration) => declaration.status === "possibly-incomplete");
    return {
      status: incomplete ? "possibly-incomplete" : "complete",
      gaps,
      undetermined: declarations.some((declaration) => declaration.undetermined)
    };
  }

  private adoptionFor(
    day: string,
    sessions: readonly ParsedSession[],
    submissions: readonly SubmissionLike[]
  ): { readonly decisions: readonly AdoptionDecision[]; readonly stats: ReturnType<typeof aggregateAdoption> } {
    const decisions = sessions.flatMap((session) =>
      pairInteractions(session.sessionId, session.messages).map((interaction) =>
        decideAdoption(interaction, submissions, OBSERVATION_WINDOW_MS, Date.parse(`${day}T23:59:59.000Z`))
      )
    );
    return { decisions, stats: aggregateAdoption(decisions, submissions) };
  }

  private researchFor(day: string, sessions: readonly ParsedSession[]) {
    return aggregateResearch(
      sessions.flatMap((session) =>
        detectResearchFindings({
          sessionId: session.sessionId,
          ...(session.title !== undefined ? { title: session.title } : {}),
          day: asPlainDate(day),
          messages: session.messages
            .filter((message) => !isNoiseText(message.text))
            .map((message) => ({
              role: message.role,
              ...(message.text !== undefined ? { text: message.text } : {})
            }))
        })
      )
    );
  }

  private dataVersionOf(sessions: readonly ParsedSession[]): string {
    const hash = createHash("sha256");
    for (const session of [...sessions].sort((left, right) => left.sessionId.localeCompare(right.sessionId))) {
      hash.update(`|${session.sourceTool}:${session.sessionId}`);
    }
    return hash.digest("hex").slice(0, 16);
  }
}

export function createRuntimeHandlers(runtime: WorkWeaveRuntime): ReadonlyMap<string, ToolHandler> {
  return new Map<string, ToolHandler>([
    [
      "ww_source_probe",
      async (invocation) => {
        const source = invocation.params?.source;
        return runtime.probe(typeof source === "string" ? [source as SourceTool] : undefined);
      }
    ],
    [
      "ww_source_ingest",
      async (invocation) => {
        const source = invocation.params?.source;
        const day = invocation.params?.day;
        const dayFrom = invocation.params?.dayFrom;
        const dayTo = invocation.params?.dayTo;
        if (typeof day === "string") {
          if (dayFrom !== undefined || dayTo !== undefined) throw new WorkWeaveError("E-MCP-003", "use day or dayFrom/dayTo, not both");
          return runtime.ingest(day, typeof source === "string" ? [source as SourceTool] : undefined, invocation.params?.resume === true);
        }
        if (typeof dayFrom !== "string" || typeof dayTo !== "string") {
          throw new WorkWeaveError("E-MCP-003", "provide day or both dayFrom and dayTo");
        }
        return runtime.ingestRange(dayFrom, dayTo, typeof source === "string" ? [source as SourceTool] : undefined, invocation.params?.resume === true);
      }
    ],
    [
      "ww_sessions_list",
      async (invocation) => runtime.listSessions({
        ...(typeof invocation.params?.dayFrom === "string" ? { dayFrom: invocation.params.dayFrom } : {}),
        ...(typeof invocation.params?.dayTo === "string" ? { dayTo: invocation.params.dayTo } : {}),
        ...(typeof invocation.params?.sourceTool === "string" ? { sourceTool: invocation.params.sourceTool as SourceTool } : {}),
        ...(typeof invocation.params?.projectId === "string" ? { projectId: invocation.params.projectId } : {}),
        ...(typeof invocation.params?.limit === "number" ? { limit: invocation.params.limit } : {}),
        ...(typeof invocation.params?.offset === "number" ? { offset: invocation.params.offset } : {})
      })
    ],
    [
      "ww_session_read",
      async (invocation) => runtime.readSession(
        requiredString(invocation, "sourceTool") as SourceTool,
        requiredString(invocation, "sessionId"),
        {
          ...(typeof invocation.params?.limit === "number" ? { limit: invocation.params.limit } : {}),
          ...(typeof invocation.params?.offset === "number" ? { offset: invocation.params.offset } : {})
        }
      )
    ],
    [
      "ww_sessions_search",
      async (invocation) => runtime.searchSessions({
        query: requiredString(invocation, "query"),
        ...(typeof invocation.params?.dayFrom === "string" ? { dayFrom: invocation.params.dayFrom } : {}),
        ...(typeof invocation.params?.dayTo === "string" ? { dayTo: invocation.params.dayTo } : {}),
        ...(typeof invocation.params?.sourceTool === "string" ? { sourceTool: invocation.params.sourceTool as SourceTool } : {}),
        ...(typeof invocation.params?.projectId === "string" ? { projectId: invocation.params.projectId } : {}),
        ...(typeof invocation.params?.limit === "number" ? { limit: invocation.params.limit } : {}),
        ...(typeof invocation.params?.offset === "number" ? { offset: invocation.params.offset } : {})
      })
    ],
    ["ww_work_classify", async (invocation) => runtime.classify(requiredString(invocation, "day"))],
    [
      "ww_fact_extract",
      async (invocation) => runtime.facts(requiredString(invocation, "day"))
    ],
    [
      "ww_evidence_package",
      async (invocation) => {
        const maxEntries = invocation.params?.maxEntries;
        return runtime.evidence(
          requiredString(invocation, "day"),
          typeof maxEntries === "number" ? maxEntries : undefined
        );
      }
    ],
    ["ww_skill_template_get", async () => getSkillTemplate()],
    [
      "ww_summary_validate",
      async (invocation) =>
        runtime.validate(
          requiredString(invocation, "packageId"),
          requiredString(invocation, "templateVersion"),
          invocation.params?.sections
        )
    ],
    [
      "ww_report_export",
      async (invocation) => {
        const format = invocation.params?.format;
        const day = invocation.params?.day;
        const dayFrom = invocation.params?.dayFrom;
        const dayTo = invocation.params?.dayTo;
        const out = requiredString(invocation, "out");
        const selectedFormat = typeof format === "string" ? format : "html";
        if (typeof day === "string") {
          if (dayFrom !== undefined || dayTo !== undefined) {
            throw new WorkWeaveError("E-MCP-003", "use day or dayFrom/dayTo, not both");
          }
          return runtime.exportReport(day, out, selectedFormat);
        }
        if (typeof dayFrom === "string" && typeof dayTo === "string") {
          return runtime.exportReportRange(dayFrom, dayTo, out, selectedFormat);
        }
        throw new WorkWeaveError("E-MCP-003", "provide day or both dayFrom and dayTo");
      }
    ],
    [
      "ww_pending_manage",
      async (invocation) => {
        const type = invocation.params?.type;
        const action = invocation.params?.action;
        const id = invocation.params?.id;
        return runtime.managePending(
          requiredString(invocation, "day"),
          typeof type === "string" ? type : undefined,
          action === "confirm" || action === "ignore" ? action : "query",
          typeof id === "string" ? id : undefined
        );
      }
    ],
    [
      "ww_evidence_resolve",
      async (invocation) =>
        runtime.resolve(
          requiredString(invocation, "packageId"),
          requiredString(invocation, "evidenceId")
        )
    ]
  ]);
}
