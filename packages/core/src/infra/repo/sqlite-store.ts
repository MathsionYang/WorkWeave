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
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT INTO sessions (source_tool, session_id, started_at, ended_at, work_dir, title)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_tool, session_id) DO UPDATE SET
             started_at=excluded.started_at,
             ended_at=excluded.ended_at,
             work_dir=excluded.work_dir,
             title=excluded.title`
        )
        .run(
          session.sourceTool,
          session.sessionId,
          session.startedAt,
          session.endedAt ?? null,
          session.workDir ?? null,
          session.title ?? null
        );

      const insertMessage = this.db.prepare(
        `INSERT INTO messages (source_tool, message_id, session_id, role, timestamp, ordinal, body)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_tool, message_id) DO UPDATE SET
           role=excluded.role,
           timestamp=excluded.timestamp,
           ordinal=excluded.ordinal,
           body=excluded.body`
      );
      for (const message of session.messages) {
        insertMessage.run(
          message.sourceTool,
          message.messageId,
          session.sessionId,
          message.role,
          message.timestamp,
          message.ordinal ?? null,
          message.text ?? null
        );
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
      .prepare("SELECT * FROM messages WHERE source_tool = ? AND session_id = ? ORDER BY timestamp ASC")
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
      messages
    };
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