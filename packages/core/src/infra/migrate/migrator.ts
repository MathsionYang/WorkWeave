import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "core-tables",
    up: `
      CREATE TABLE IF NOT EXISTS sessions (
        source_tool TEXT NOT NULL,
        session_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        work_dir TEXT,
        title TEXT,
        PRIMARY KEY (source_tool, session_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        source_tool TEXT NOT NULL,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        ordinal INTEGER,
        body TEXT,
        PRIMARY KEY (source_tool, message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (source_tool, session_id);
      CREATE TABLE IF NOT EXISTS probe_results (
        source TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        completeness TEXT NOT NULL,
        payload TEXT NOT NULL,
        probed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tool_calls (
        call_id TEXT PRIMARY KEY,
        tool TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        seq INTEGER PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence_packages (
        package_id TEXT PRIMARY KEY,
        data_version TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reports (
        report_id TEXT PRIMARY KEY,
        report_type TEXT NOT NULL,
        range_from TEXT NOT NULL,
        range_to TEXT NOT NULL,
        data_version TEXT NOT NULL,
        path TEXT NOT NULL,
        generated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        scope TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT
      );
      CREATE TABLE IF NOT EXISTS whitelists (
        path TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE TABLE IF NOT EXISTS classification_rules (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
    `
  }
];

export interface MigrationResult {
  readonly applied: readonly number[];
  readonly currentVersion: number;
}

export function runMigrations(
  db: DatabaseSync,
  migrations: readonly Migration[] = MIGRATIONS
): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const row = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get() as { version: number };
  let currentVersion = row.version;
  const applied: number[] = [];

  for (const migration of [...migrations].sort((left, right) => left.version - right.version)) {
    if (migration.version <= currentVersion) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.up);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        new Date().toISOString()
      );
      db.exec("COMMIT");
      currentVersion = migration.version;
      applied.push(migration.version);
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${migration.version} (${migration.name}) failed: ${String(error)}`);
    }
  }

  return { applied, currentVersion };
}