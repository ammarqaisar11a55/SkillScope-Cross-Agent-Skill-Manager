import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Database, SqlValue } from 'sql.js';
import initSqlJs from 'sql.js/dist/sql-wasm-inline.js';
import type {
  InstallationReceipt,
  InventorySnapshot,
  OperationRecord,
  Settings,
} from '@skillscope/shared';
import { normalizeSettings } from '@skillscope/shared';

export const SCHEMA_VERSION = 1;

const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generated_at TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      finished_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      unique_skills INTEGER NOT NULL,
      availability_records INTEGER NOT NULL,
      problems INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      package_name TEXT NOT NULL,
      version TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      destination_key TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS receipts_destination ON receipts (destination_key);
    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      started_at TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS operations_started ON operations (started_at);
  `,
};

export interface ScanHistoryEntry {
  finishedAt: string;
  durationMs: number;
  uniqueSkills: number;
  availabilityRecords: number;
  problems: number;
}

/**
 * Application-owned records only: settings, the last inventory (for offline viewing), scan
 * history, installation receipts and the operation log. The filesystem remains the source of
 * truth for which skills exist.
 *
 * The database lives in memory and is flushed to disk atomically (temp file + rename) after
 * every write. Pass `file = null` for an in-memory store (tests).
 */
export class SkillScopeStore {
  private constructor(
    private readonly db: Database,
    private readonly file: string | null,
  ) {}

  static async open(file: string | null): Promise<SkillScopeStore> {
    const SQL = await initSqlJs();
    let data: Uint8Array | undefined;
    let corrupted = false;
    if (file) {
      try {
        data = new Uint8Array(await readFile(file));
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') throw error;
      }
    }
    let db: Database;
    try {
      db = new SQL.Database(data);
      db.exec('PRAGMA user_version');
    } catch {
      // A corrupted database must not prevent the app from starting; keep a copy and start fresh.
      corrupted = true;
      db = new SQL.Database();
    }
    if (corrupted && file)
      await rename(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined);
    const store = new SkillScopeStore(db, file);
    store.migrate();
    await store.flush();
    return store;
  }

  private migrate(): void {
    const current = this.scalar<number>('PRAGMA user_version') ?? 0;
    for (let v = current + 1; v <= SCHEMA_VERSION; v += 1) {
      const sql = MIGRATIONS[v];
      if (!sql) throw new Error(`Missing migration ${v}`);
      this.db.exec('BEGIN');
      this.db.exec(sql);
      this.db.exec(`PRAGMA user_version = ${v}`);
      this.db.exec('COMMIT');
    }
  }

  private scalar<T extends SqlValue>(sql: string, params: SqlValue[] = []): T | null {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      if (!stmt.step()) return null;
      return (stmt.get()[0] ?? null) as T | null;
    } finally {
      stmt.free();
    }
  }

  private rows(sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
    const stmt = this.db.prepare(sql);
    const out: Record<string, SqlValue>[] = [];
    try {
      stmt.bind(params);
      while (stmt.step()) out.push(stmt.getAsObject());
    } finally {
      stmt.free();
    }
    return out;
  }

  private async flush(): Promise<void> {
    if (!this.file) return;
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    await writeFile(tmp, this.db.export());
    try {
      await rename(tmp, this.file);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }

  // ---- settings -------------------------------------------------------------------------

  getSettings(): Settings {
    const json = this.scalar<string>('SELECT json FROM settings WHERE id = 1');
    if (!json) return normalizeSettings(null);
    try {
      return normalizeSettings(JSON.parse(json));
    } catch {
      return normalizeSettings(null);
    }
  }

  async saveSettings(settings: Settings): Promise<void> {
    this.db.run(
      'INSERT INTO settings (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json',
      [JSON.stringify(settings)],
    );
    await this.flush();
  }

  // ---- inventory snapshots and scan history ---------------------------------------------

  async saveSnapshot(snapshot: InventorySnapshot): Promise<void> {
    this.db.run('DELETE FROM snapshots');
    this.db.run('INSERT INTO snapshots (generated_at, json) VALUES (?, ?)', [
      snapshot.generatedAt,
      JSON.stringify(snapshot),
    ]);
    this.db.run(
      'INSERT INTO scans (finished_at, duration_ms, unique_skills, availability_records, problems) VALUES (?, ?, ?, ?, ?)',
      [
        snapshot.generatedAt,
        snapshot.scanDurationMs,
        snapshot.stats.uniqueSkills,
        snapshot.stats.availabilityRecords,
        snapshot.stats.problematicSkills,
      ],
    );
    await this.flush();
  }

  latestSnapshot(): InventorySnapshot | null {
    const json = this.scalar<string>('SELECT json FROM snapshots ORDER BY id DESC LIMIT 1');
    if (!json) return null;
    try {
      return { ...(JSON.parse(json) as InventorySnapshot), fromCache: true };
    } catch {
      return null;
    }
  }

  scanHistory(limit = 50): ScanHistoryEntry[] {
    return this.rows('SELECT * FROM scans ORDER BY id DESC LIMIT ?', [limit]).map((r) => ({
      finishedAt: String(r.finished_at),
      durationMs: Number(r.duration_ms),
      uniqueSkills: Number(r.unique_skills),
      availabilityRecords: Number(r.availability_records),
      problems: Number(r.problems),
    }));
  }

  // ---- installation receipts ------------------------------------------------------------

  async saveReceipt(receipt: InstallationReceipt, destinationKey: string): Promise<void> {
    this.putReceipt(receipt, destinationKey);
    await this.flush();
  }

  /** Save several receipts in one transaction (used by multi-target installs). */
  async saveReceipts(
    entries: { receipt: InstallationReceipt; destinationKey: string }[],
  ): Promise<void> {
    this.db.exec('BEGIN');
    try {
      for (const e of entries) this.putReceipt(e.receipt, e.destinationKey);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    await this.flush();
  }

  private putReceipt(receipt: InstallationReceipt, destinationKey: string): void {
    this.db.run(
      `INSERT INTO receipts (id, package_name, version, skill_name, destination_key, status, updated_at, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET package_name = excluded.package_name, version = excluded.version,
         skill_name = excluded.skill_name, destination_key = excluded.destination_key,
         status = excluded.status, updated_at = excluded.updated_at, json = excluded.json`,
      [
        receipt.id,
        receipt.packageName,
        receipt.version,
        receipt.skillName,
        destinationKey,
        receipt.status,
        receipt.updatedAt,
        JSON.stringify(receipt),
      ],
    );
  }

  getReceipt(id: string): InstallationReceipt | null {
    const json = this.scalar<string>('SELECT json FROM receipts WHERE id = ?', [id]);
    return json ? (JSON.parse(json) as InstallationReceipt) : null;
  }

  activeReceiptAt(destinationKey: string): InstallationReceipt | null {
    const json = this.scalar<string>(
      "SELECT json FROM receipts WHERE destination_key = ? AND status = 'installed' ORDER BY updated_at DESC LIMIT 1",
      [destinationKey],
    );
    return json ? (JSON.parse(json) as InstallationReceipt) : null;
  }

  listReceipts(includeRemoved = false): InstallationReceipt[] {
    const sql = includeRemoved
      ? 'SELECT json FROM receipts ORDER BY updated_at DESC'
      : "SELECT json FROM receipts WHERE status = 'installed' ORDER BY updated_at DESC";
    return this.rows(sql).map((r) => JSON.parse(String(r.json)) as InstallationReceipt);
  }

  // ---- operation log --------------------------------------------------------------------

  async saveOperation(op: OperationRecord): Promise<void> {
    this.db.run(
      `INSERT INTO operations (id, kind, state, started_at, json) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET state = excluded.state, json = excluded.json`,
      [op.id, op.kind, op.state, op.startedAt, JSON.stringify(op)],
    );
    await this.flush();
  }

  listOperations(limit = 200): OperationRecord[] {
    return this.rows('SELECT json FROM operations ORDER BY started_at DESC LIMIT ?', [limit]).map(
      (r) => JSON.parse(String(r.json)) as OperationRecord,
    );
  }

  /** Delete history older than the retention window. Receipts of installed skills are kept. */
  async pruneHistory(retentionDays: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
    this.db.run('DELETE FROM operations WHERE started_at < ?', [cutoff]);
    let removed = this.db.getRowsModified();
    this.db.run('DELETE FROM scans WHERE finished_at < ?', [cutoff]);
    removed += this.db.getRowsModified();
    this.db.run("DELETE FROM receipts WHERE status = 'removed' AND updated_at < ?", [cutoff]);
    removed += this.db.getRowsModified();
    await this.flush();
    return removed;
  }

  close(): void {
    this.db.close();
  }
}
