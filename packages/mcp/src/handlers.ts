import { createHash } from "node:crypto";
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
  classifySessions,
  collectDay,
  decideAdoption,
  detectResearchFindings,
  exportReportAtomic,
  getSkillTemplate,
  pairInteractions,
  parseSubmissionFacts,
  parseTestResult,
  renderHtml,
  renderMarkdown,
  resolveEvidence,
  runMigrations,
  validateSubmission
} from "@workweave/core";
import type {
  AdoptionDecision,
  ClassificationSignal,
  ClassifiedSession,
  CompletenessDeclaration,
  HostSubmission,
  ParsedSession,
  Platform,
  ProbeSourceResult,
  SourceAdapter,
  SourceTool,
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
}

const ALL_SOURCES: readonly SourceTool[] = ["codex", "claude", "workbuddy", "dsh"];
const OBSERVATION_WINDOW_MS = 24 * 60 * 60 * 1000;

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
      ["codex", new CodexAdapter()],
      ["workbuddy", new WorkBuddyAdapter()],
      ["dsh", new DshAdapter()]
    ]);
    this.store = SqliteFactStore.open(options.dbPath ?? ":memory:");
    runMigrations(this.store.database);
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
      this.probeBySource.set(source, result);
      results.push(result);
    }
    return results;
  }

  async ingest(day: string): Promise<{
    readonly day: string;
    readonly sessionCount: number;
    readonly messageCount: number;
    readonly dataVersion: string;
    readonly warnings: readonly string[];
    readonly skippedSources: readonly SourceTool[];
  }> {
    if (this.probeBySource.size === 0) await this.probe();
    const sessions: ParsedSession[] = [];
    const tests: TestFact[] = [];
    const submissions: SubmissionLike[] = [];
    const warnings: string[] = [];
    const skippedSources: SourceTool[] = [];
    const versions: string[] = [];

    for (const source of this.sources) {
      const adapter = this.adapters.get(source);
      const probe = this.probeBySource.get(source);
      if (adapter === undefined || probe?.adoptedPath === undefined) {
        skippedSources.push(source);
        continue;
      }
      const collected = await collectDay({
        adapter,
        root: probe.adoptedPath,
        day,
        maxSessions: 500
      });
      sessions.push(...collected.sessions);
      warnings.push(...collected.warnings);
      if (collected.dataVersion.length > 0) versions.push(collected.dataVersion);
      for (const session of collected.sessions) {
        for (const message of session.messages) {
          const text = message.text ?? "";
          if (/\b(jest|vitest|pytest|npm\s+test|go\s+test|cargo\s+test)\b/i.test(text)) {
            tests.push(
              parseTestResult({
                sessionId: session.sessionId,
                projectId: asProjectId("unassigned"),
                command: text,
                output: text
              })
            );
          }
          submissions.push(...parseSubmissionFacts({ sessionId: session.sessionId, command: text, output: text }));
        }
      }
    }

    const dataVersion = versions.length === 0
      ? "no-data"
      : createHash("sha256").update(versions.sort().join("|")).digest("hex").slice(0, 16);

    this.sessionsByDay.set(day, sessions);
    this.testsByDay.set(day, tests);
    this.submissionsByDay.set(day, submissions);

    return {
      day,
      sessionCount: sessions.length,
      messageCount: sessions.reduce((sum, session) => sum + session.messages.length, 0),
      dataVersion,
      warnings,
      skippedSources
    };
  }

  async classify(day: string): Promise<readonly ClassifiedSession[]> {
    const sessions = await this.sessionsFor(day);
    const signals: ClassificationSignal[] = sessions.map((session) => ({
      sessionId: session.sessionId,
      sourceTool: session.sourceTool,
      ...(session.workDir !== undefined ? { workDir: session.workDir } : {}),
      ...(session.title !== undefined ? { title: session.title } : {}),
      messages: session.messages.map((message) => ({
        role: message.role,
        ...(message.text !== undefined ? { text: message.text } : {})
      }))
    }));
    const classifications = classifySessions(signals);
    this.classificationsByDay.set(day, [...classifications]);
    return classifications;
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

  async exportReport(day: string, out: string, format = "markdown"): Promise<{ readonly path: string; readonly dataVersion: string }> {
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
          messages: session.messages.map((message) => ({ ...(message.text !== undefined ? { text: message.text } : {}) }))
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
    ["ww_source_ingest", async (invocation) => runtime.ingest(requiredString(invocation, "day"))],
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
        return runtime.exportReport(
          requiredString(invocation, "day"),
          requiredString(invocation, "out"),
          typeof format === "string" ? format : "markdown"
        );
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