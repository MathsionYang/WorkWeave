import { DatabaseSync } from "node:sqlite";
import type { Message, Session } from "../../domain/models.js";
import type { SourceTool } from "../../domain/types.js";
import { asInstant, asMessageId, asSessionId } from "../../domain/types.js";

interface SessionRow {
  readonly source_tool: string;
  readonly session_id: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly work_dir: string | null;
  readonly title: string | null;
  readonly project_id: string | null;
}

export interface SessionListItem {
  readonly sourceTool: SourceTool;
  readonly sessionId: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly workDir?: string;
  readonly title?: string;
  readonly projectId?: string;
  readonly messageCount: number;
}

export interface SessionListQuery {
  readonly dayFrom?: string;
  readonly dayTo?: string;
  readonly sourceTool?: SourceTool;
  readonly projectId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface MessageSearchQuery extends SessionListQuery {
  readonly query: string;
}

export interface MessageSearchHit {
  readonly sourceTool: SourceTool;
  readonly sessionId: string;
  readonly messageId: string;
  readonly role: Message["role"];
  readonly timestamp: string;
  readonly text: string;
  readonly projectId?: string;
}

export interface SessionReadPage {
  readonly session: Omit<SessionListItem, "messageCount"> & { readonly messageCount: number };
  readonly messages: readonly Message[];
  readonly totalMessages: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

export interface IngestCheckpoint {
  readonly runId: string;
  readonly sourceTool: SourceTool;
  readonly sourcePath: string;
  readonly fingerprint: string;
  readonly status: "pending" | "completed" | "failed";
  readonly attempts: number;
  readonly errorCode?: string;
}


export interface PagedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

function pageSize(value: number | undefined, defaultSize: number): number {
  if (value === undefined) return defaultSize;
  if (!Number.isInteger(value) || value < 1) throw new RangeError("limit must be a positive integer");
  return Math.min(value, 100);
}

function pageOffset(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) throw new RangeError("offset must be a non-negative integer");
  return value;
}

interface MessageRow {
  readonly source_tool: string;
  readonly message_id: string;
  readonly session_id: string;
  readonly role: string;
  readonly timestamp: string;
  readonly ordinal: number | null;
  readonly body: string | null;
}

export class SqliteFactStore {
  constructor(private readonly db: DatabaseSync) {}

  static open(path = ":memory:"): SqliteFactStore {
    return new SqliteFactStore(new DatabaseSync(path));
  }

  get database(): DatabaseSync {
    return this.db;
  }

  upsertSession(session: Session): void {
    this.persistSession(session, false);
  }

  replaceSession(session: Session): void {
    this.persistSession(session, true);
  }

  setSessionProject(sourceTool: SourceTool, sessionId: string, projectId: string): boolean {
    const result = this.db.prepare(
      "UPDATE sessions SET project_id = ? WHERE source_tool = ? AND session_id = ?"
    ).run(projectId, sourceTool, sessionId);
    return Number(result.changes) > 0;
  }

  beginIngestRun(runId: string, day: string, sourceTool?: SourceTool): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO ingest_runs (run_id, day, source_tool, status, created_at, updated_at)
       VALUES (?, ?, ?, 'running', ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET status='running', updated_at=excluded.updated_at`
    ).run(runId, day, sourceTool ?? null, now, now);
  }

  getIngestCheckpoint(runId: string, sourceTool: SourceTool, sourcePath: string): IngestCheckpoint | undefined {
    const row = this.db.prepare(
      `SELECT run_id, source_tool, source_path, fingerprint, status, attempts, error_code
       FROM ingest_checkpoints WHERE run_id = ? AND source_tool = ? AND source_path = ?`
    ).get(runId, sourceTool, sourcePath) as {
      run_id: string; source_tool: SourceTool; source_path: string; fingerprint: string;
      status: IngestCheckpoint["status"]; attempts: number; error_code: string | null;
    } | undefined;
    return row === undefined ? undefined : {
      runId: row.run_id,
      sourceTool: row.source_tool,
      sourcePath: row.source_path,
      fingerprint: row.fingerprint,
      status: row.status,
      attempts: row.attempts,
      ...(row.error_code !== null ? { errorCode: row.error_code } : {})
    };
  }

  saveIngestCheckpoint(checkpoint: IngestCheckpoint): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO ingest_checkpoints (run_id, source_tool, source_path, fingerprint, status, attempts, error_code, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, source_tool, source_path) DO UPDATE SET
         fingerprint=excluded.fingerprint, status=excluded.status, attempts=excluded.attempts,
         error_code=excluded.error_code, updated_at=excluded.updated_at`
    ).run(checkpoint.runId, checkpoint.sourceTool, checkpoint.sourcePath, checkpoint.fingerprint,
      checkpoint.status, checkpoint.attempts, checkpoint.errorCode ?? null, now);
    this.db.prepare(
      `UPDATE ingest_runs SET scanned_units=(SELECT COUNT(*) FROM ingest_checkpoints WHERE run_id = ?),
       successful_units=(SELECT COUNT(*) FROM ingest_checkpoints WHERE run_id = ? AND status = 'completed'),
       failed_units=(SELECT COUNT(*) FROM ingest_checkpoints WHERE run_id = ? AND status = 'failed'), updated_at=?
       WHERE run_id=?`
    ).run(checkpoint.runId, checkpoint.runId, checkpoint.runId, now, checkpoint.runId);
  }

  finishIngestRun(runId: string): void {
    this.db.prepare(
      `UPDATE ingest_runs SET status=CASE WHEN failed_units > 0 THEN 'completed-with-errors' ELSE 'completed' END, updated_at=? WHERE run_id=?`
    ).run(new Date().toISOString(), runId);
  }


  private persistSession(session: Session, replaceMessages: boolean): void {
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT INTO sessions (source_tool, session_id, started_at, ended_at, work_dir, title, project_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_tool, session_id) DO UPDATE SET
             started_at=excluded.started_at,
             ended_at=excluded.ended_at,
             work_dir=excluded.work_dir,
             title=excluded.title,
             project_id=COALESCE(excluded.project_id, sessions.project_id)`
        )
        .run(
          session.sourceTool,
          session.sessionId,
          session.startedAt,
          session.endedAt ?? null,
          session.workDir ?? null,
          session.title ?? null,
          session.projectId ?? null
        );

      const insertMessage = this.db.prepare(
        `INSERT INTO messages (source_tool, session_id, message_id, role, timestamp, ordinal, body)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_tool, session_id, message_id) DO UPDATE SET
           role=excluded.role,
           timestamp=excluded.timestamp,
           ordinal=excluded.ordinal,
           body=excluded.body`
      );
      if (replaceMessages) {
        this.db.prepare("DELETE FROM messages_fts WHERE source_tool = ? AND session_id = ?").run(
          session.sourceTool,
          session.sessionId
        );
        this.db.prepare("DELETE FROM messages WHERE source_tool = ? AND session_id = ?").run(
          session.sourceTool,
          session.sessionId
        );
      }
      for (const message of session.messages) {
        this.db.prepare(
          "DELETE FROM messages_fts WHERE source_tool = ? AND session_id = ? AND message_id = ?"
        ).run(message.sourceTool, session.sessionId, message.messageId);
        insertMessage.run(
          message.sourceTool,
          session.sessionId,
          message.messageId,
          message.role,
          message.timestamp,
          message.ordinal ?? null,
          message.text ?? null
        );
        if (message.text !== undefined && message.text.length > 0) {
          this.db.prepare(
            "INSERT INTO messages_fts (source_tool, session_id, message_id, body) VALUES (?, ?, ?, ?)"
          ).run(message.sourceTool, session.sessionId, message.messageId, message.text);
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getSession(sourceTool: SourceTool, sessionId: string): Session | undefined {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE source_tool = ? AND session_id = ?")
      .get(sourceTool, sessionId) as SessionRow | undefined;
    if (row === undefined) return undefined;

    const messageRows = this.db
      .prepare("SELECT * FROM messages WHERE source_tool = ? AND session_id = ? ORDER BY COALESCE(ordinal, 2147483647), timestamp ASC")
      .all(sourceTool, sessionId) as unknown as MessageRow[];

    const messages: Message[] = messageRows.map((message) => ({
      messageId: asMessageId(message.message_id),
      sessionId: asSessionId(message.session_id),
      sourceTool: message.source_tool as SourceTool,
      role: message.role as Message["role"],
      timestamp: asInstant(message.timestamp),
      ...(message.ordinal !== null ? { ordinal: message.ordinal } : {}),
      ...(message.body !== null ? { text: message.body } : {})
    }));

    return {
      sessionId: asSessionId(row.session_id),
      sourceTool: row.source_tool as SourceTool,
      startedAt: asInstant(row.started_at),
      ...(row.ended_at !== null ? { endedAt: asInstant(row.ended_at) } : {}),
      ...(row.work_dir !== null ? { workDir: row.work_dir } : {}),
      ...(row.title !== null ? { title: row.title } : {}),
      ...(row.project_id !== null ? { projectId: row.project_id as Session["projectId"] } : {}),
      messages
    };
  }

  readSessionPage(sourceTool: SourceTool, sessionId: string, options: { readonly limit?: number; readonly offset?: number } = {}): SessionReadPage | undefined {
    const limit = pageSize(options.limit, 50);
    const offset = pageOffset(options.offset);
    const row = this.db.prepare(
      `SELECT s.source_tool, s.session_id, s.started_at, s.ended_at, s.work_dir, s.title, s.project_id,
              (SELECT COUNT(*) FROM messages m WHERE m.source_tool = s.source_tool AND m.session_id = s.session_id) AS message_count
       FROM sessions s WHERE s.source_tool = ? AND s.session_id = ?`
    ).get(sourceTool, sessionId) as (SessionRow & { message_count: number }) | undefined;
    if (row === undefined) return undefined;

    const rows = this.db.prepare(
      `SELECT * FROM messages WHERE source_tool = ? AND session_id = ?
       ORDER BY COALESCE(ordinal, 2147483647), timestamp ASC, message_id ASC LIMIT ? OFFSET ?`
    ).all(sourceTool, sessionId, limit, offset) as unknown as MessageRow[];
    const messages = rows.map((message): Message => ({
      messageId: asMessageId(message.message_id),
      sessionId: asSessionId(message.session_id),
      sourceTool: message.source_tool as SourceTool,
      role: message.role as Message["role"],
      timestamp: asInstant(message.timestamp),
      ...(message.ordinal !== null ? { ordinal: message.ordinal } : {}),
      ...(message.body !== null ? { text: message.body } : {})
    }));
    const session: SessionReadPage["session"] = {
      sourceTool: row.source_tool as SourceTool,
      sessionId: row.session_id,
      startedAt: row.started_at,
      ...(row.ended_at !== null ? { endedAt: row.ended_at } : {}),
      ...(row.work_dir !== null ? { workDir: row.work_dir } : {}),
      ...(row.title !== null ? { title: row.title } : {}),
      ...(row.project_id !== null ? { projectId: row.project_id } : {}),
      messageCount: row.message_count
    };
    return {
      session,
      messages,
      totalMessages: row.message_count,
      limit,
      offset,
      hasMore: offset + messages.length < row.message_count
    };
  }

  listSessions(query: SessionListQuery = {}): PagedResult<SessionListItem> {
    const limit = pageSize(query.limit, 50);
    const offset = pageOffset(query.offset);
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    const messageDateClauses: string[] = [];
    const messageDateParams: string[] = [];
    const startDateClauses: string[] = [];
    const startDateParams: string[] = [];
    if (query.dayFrom !== undefined) {
      messageDateClauses.push("substr(m.timestamp, 1, 10) >= ?");
      messageDateParams.push(query.dayFrom);
      startDateClauses.push("substr(s.started_at, 1, 10) >= ?");
      startDateParams.push(query.dayFrom);
    }
    if (query.dayTo !== undefined) {
      messageDateClauses.push("substr(m.timestamp, 1, 10) <= ?");
      messageDateParams.push(query.dayTo);
      startDateClauses.push("substr(s.started_at, 1, 10) <= ?");
      startDateParams.push(query.dayTo);
    }
    if (messageDateClauses.length > 0) {
      clauses.push(`(EXISTS (SELECT 1 FROM messages m WHERE m.source_tool=s.source_tool AND m.session_id=s.session_id AND ${messageDateClauses.join(" AND ")}) OR (NOT EXISTS (SELECT 1 FROM messages me WHERE me.source_tool=s.source_tool AND me.session_id=s.session_id) AND ${startDateClauses.join(" AND ")}))`);
      params.push(...messageDateParams, ...startDateParams);
    }
    if (query.sourceTool !== undefined) { clauses.push("s.source_tool = ?"); params.push(query.sourceTool); }
    if (query.projectId !== undefined) { clauses.push("s.project_id = ?"); params.push(query.projectId); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const messageCountWhere = messageDateClauses.length > 0 ? ` AND ${messageDateClauses.map((clause) => clause.replaceAll("m.timestamp", "mc.timestamp")).join(" AND ")}` : "";
    const totalRow = this.db.prepare(`SELECT COUNT(*) AS total FROM sessions s ${where}`).get(...params) as { total: number };
    const rows = this.db.prepare(
      `SELECT s.source_tool, s.session_id, s.started_at, s.ended_at, s.work_dir, s.title, s.project_id,
              (SELECT COUNT(*) FROM messages mc WHERE mc.source_tool = s.source_tool AND mc.session_id = s.session_id${messageCountWhere}) AS message_count
       FROM sessions s ${where}
       ORDER BY s.started_at DESC, s.source_tool ASC, s.session_id ASC
       LIMIT ? OFFSET ?`
    ).all(...messageDateParams, ...params, limit, offset) as unknown as (SessionRow & { message_count: number })[];
    const items = rows.map((row): SessionListItem => ({
      sourceTool: row.source_tool as SourceTool,
      sessionId: row.session_id,
      startedAt: row.started_at,
      ...(row.ended_at !== null ? { endedAt: row.ended_at } : {}),
      ...(row.work_dir !== null ? { workDir: row.work_dir } : {}),
      ...(row.title !== null ? { title: row.title } : {}),
      ...(row.project_id !== null ? { projectId: row.project_id } : {}),
      messageCount: row.message_count
    }));
    return { items, total: totalRow.total, limit, offset, hasMore: offset + items.length < totalRow.total };
  }

  searchMessages(query: MessageSearchQuery): PagedResult<MessageSearchHit> {
    const text = query.query.trim();
    if (text.length === 0) throw new TypeError("query must not be empty");
    const limit = pageSize(query.limit, 25);
    const offset = pageOffset(query.offset);
    const clauses = ["f.body MATCH ?"];
    const params: (string | number)[] = [`"${text.replace(/"/g, '""')}"`];
    if (query.dayFrom !== undefined) { clauses.push("substr(m.timestamp, 1, 10) >= ?"); params.push(query.dayFrom); }
    if (query.dayTo !== undefined) { clauses.push("substr(m.timestamp, 1, 10) <= ?"); params.push(query.dayTo); }
    if (query.sourceTool !== undefined) { clauses.push("m.source_tool = ?"); params.push(query.sourceTool); }
    if (query.projectId !== undefined) { clauses.push("s.project_id = ?"); params.push(query.projectId); }
    const where = clauses.join(" AND ");
    const totalRow = this.db.prepare(
      `SELECT COUNT(*) AS total FROM messages_fts f
       JOIN messages m ON m.source_tool = f.source_tool AND m.session_id = f.session_id AND m.message_id = f.message_id
       JOIN sessions s ON s.source_tool = m.source_tool AND s.session_id = m.session_id
       WHERE ${where}`
    ).get(...params) as { total: number };
    const rows = this.db.prepare(
      `SELECT m.source_tool, m.session_id, m.message_id, m.role, m.timestamp, m.body, s.project_id
       FROM messages_fts f
       JOIN messages m ON m.source_tool = f.source_tool AND m.session_id = f.session_id AND m.message_id = f.message_id
       JOIN sessions s ON s.source_tool = m.source_tool AND s.session_id = m.session_id
       WHERE ${where}
       ORDER BY m.timestamp DESC, m.source_tool ASC, m.session_id ASC, m.message_id ASC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as unknown as (MessageRow & { project_id: string | null })[];
    const items = rows.map((row): MessageSearchHit => ({
      sourceTool: row.source_tool as SourceTool,
      sessionId: row.session_id,
      messageId: row.message_id,
      role: row.role as Message["role"],
      timestamp: row.timestamp,
      text: row.body ?? "",
      ...(row.project_id !== null ? { projectId: row.project_id } : {})
    }));
    return { items, total: totalRow.total, limit, offset, hasMore: offset + items.length < totalRow.total };
  }

  countMessages(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number };
    return row.count;
  }

  saveProbeResult(source: SourceTool, status: string, completeness: string, payload: unknown, probedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO probe_results (source, status, completeness, payload, probed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(source) DO UPDATE SET
           status=excluded.status,
           completeness=excluded.completeness,
           payload=excluded.payload,
           probed_at=excluded.probed_at`
      )
      .run(source, status, completeness, JSON.stringify(payload), probedAt);
  }

  recordCall(callId: string, tool: string, result: unknown): void {
    this.db
      .prepare(
        `INSERT INTO tool_calls (call_id, tool, result, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(call_id) DO UPDATE SET result=excluded.result`
      )
      .run(callId, tool, JSON.stringify(result), new Date().toISOString());
  }

  getCall(callId: string): unknown {
    const row = this.db.prepare("SELECT result FROM tool_calls WHERE call_id = ?").get(callId) as
      | { result: string }
      | undefined;
    return row === undefined ? undefined : JSON.parse(row.result);
  }

  addPendingIfMissing(source: string, type: string, scope: string, payload?: string): number {
    const existing = this.db
      .prepare("SELECT id FROM pending_items WHERE source = ? AND type = ? AND scope = ?")
      .get(source, type, scope) as { id: number } | undefined;
    if (existing !== undefined) return existing.id;

    const result = this.db
      .prepare("INSERT INTO pending_items (source, type, scope, status, payload) VALUES (?, ?, ?, 'pending', ?)")
      .run(source, type, scope, payload ?? null);
    return Number(result.lastInsertRowid);
  }

  listPending(type?: string): readonly { id: number; source: string; type: string; scope: string; status: string }[] {
    const rows = (
      type === undefined
        ? this.db.prepare("SELECT id, source, type, scope, status FROM pending_items ORDER BY id ASC").all()
        : this.db
            .prepare("SELECT id, source, type, scope, status FROM pending_items WHERE type = ? ORDER BY id ASC")
            .all(type)
    ) as unknown as { id: number; source: string; type: string; scope: string; status: string }[];
    return rows;
  }

  setPendingStatus(id: number, status: "pending" | "confirmed" | "ignored"): boolean {
    const result = this.db.prepare("UPDATE pending_items SET status = ? WHERE id = ?").run(status, id);
    return Number(result.changes) > 0;
  }

  close(): void {
    this.db.close();
  }
}
