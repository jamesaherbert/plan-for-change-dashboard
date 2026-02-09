import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "cache", "dashboard.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
  }
  return _db;
}

export function initDb(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS kpi_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      milestone_slug TEXT NOT NULL,
      value REAL NOT NULL,
      date TEXT NOT NULL,
      label TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(milestone_slug, date)
    );

    CREATE TABLE IF NOT EXISTS outputs (
      id TEXT PRIMARY KEY,
      milestone_slug TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      url TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT DEFAULT '',
      published_date TEXT,
      last_updated TEXT,
      department TEXT,
      confidence TEXT NOT NULL DEFAULT 'medium',
      dismissed INTEGER NOT NULL DEFAULT 0,
      rationale TEXT,
      rationale_updated_at TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bill_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      output_id TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      house TEXT NOT NULL,
      date TEXT,
      completed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS media_articles (
      id TEXT PRIMARY KEY,
      milestone_slug TEXT NOT NULL,
      output_id TEXT,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      published_date TEXT,
      excerpt TEXT,
      thumbnail_url TEXT,
      api_source TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS committee_inquiries (
      id TEXT PRIMARY KEY,
      milestone_slug TEXT NOT NULL,
      committee_name TEXT NOT NULL,
      committee_id INTEGER NOT NULL,
      inquiry_title TEXT NOT NULL,
      status TEXT DEFAULT 'Open',
      url TEXT,
      evidence_sessions INTEGER DEFAULT 0,
      reports_published INTEGER DEFAULT 0,
      last_activity TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS debates (
      id TEXT PRIMARY KEY,
      milestone_slug TEXT NOT NULL,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      house TEXT NOT NULL,
      url TEXT NOT NULL,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS written_questions (
      id TEXT PRIMARY KEY,
      milestone_slug TEXT NOT NULL,
      question_title TEXT NOT NULL,
      asked_by TEXT,
      date TEXT NOT NULL,
      url TEXT,
      answered INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_kpi_milestone ON kpi_snapshots(milestone_slug);
    CREATE INDEX IF NOT EXISTS idx_outputs_milestone ON outputs(milestone_slug);
    CREATE INDEX IF NOT EXISTS idx_outputs_type ON outputs(type);
    CREATE INDEX IF NOT EXISTS idx_media_milestone ON media_articles(milestone_slug);
    CREATE INDEX IF NOT EXISTS idx_media_output ON media_articles(output_id);
    CREATE INDEX IF NOT EXISTS idx_media_date ON media_articles(published_date);
    CREATE TABLE IF NOT EXISTS milestone_briefings (
      milestone_slug TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      data_hash TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_debates_milestone ON debates(milestone_slug);
    CREATE INDEX IF NOT EXISTS idx_committees_milestone ON committee_inquiries(milestone_slug);
  `);

  // Migration: add rationale columns if missing (for existing DBs)
  const cols = db.prepare("PRAGMA table_info(outputs)").all() as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has("rationale")) {
    db.exec("ALTER TABLE outputs ADD COLUMN rationale TEXT");
    db.exec("ALTER TABLE outputs ADD COLUMN rationale_updated_at TEXT");
  }
}
