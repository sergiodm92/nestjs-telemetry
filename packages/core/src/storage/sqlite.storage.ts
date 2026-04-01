import Database, { Database as DatabaseType, Statement } from 'better-sqlite3';
import { TelemetryEntry } from '../model/telemetry-entry';
import { TelemetryEntryType } from '../model/telemetry-entry-type';
import { EntryFilters, TelemetryStorage } from './telemetry-storage.interface';

interface DbRow {
  uuid: string;
  type: string;
  created_at: string;
  batch_id: string;
  content: string;
  user_identifier: string;
  tenant_id: string;
  tags: string;
}

export class SqliteTelemetryStorage implements TelemetryStorage {
  private readonly db: DatabaseType;
  private readonly buffer: TelemetryEntry[] = [];
  private enabled_ = true;

  private readonly stmtInsert: Statement;
  private readonly stmtSelectByUuid: Statement;
  private readonly stmtSelectByBatch: Statement;
  private readonly stmtDeleteAll: Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS telemetry_entries (
        uuid             TEXT PRIMARY KEY,
        type             TEXT NOT NULL,
        created_at       TEXT NOT NULL,
        batch_id         TEXT NOT NULL,
        content          TEXT NOT NULL,
        user_identifier  TEXT NOT NULL,
        tenant_id        TEXT NOT NULL,
        tags             TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_te_type        ON telemetry_entries(type);
      CREATE INDEX IF NOT EXISTS idx_te_created_at  ON telemetry_entries(created_at);
      CREATE INDEX IF NOT EXISTS idx_te_batch_id    ON telemetry_entries(batch_id);
      CREATE INDEX IF NOT EXISTS idx_te_user        ON telemetry_entries(user_identifier);
      CREATE INDEX IF NOT EXISTS idx_te_tenant      ON telemetry_entries(tenant_id);
    `);

    this.stmtInsert = this.db.prepare(`
      INSERT OR IGNORE INTO telemetry_entries
        (uuid, type, created_at, batch_id, content, user_identifier, tenant_id, tags)
      VALUES
        (@uuid, @type, @created_at, @batch_id, @content, @user_identifier, @tenant_id, @tags)
    `);

    this.stmtSelectByUuid = this.db.prepare(
      'SELECT * FROM telemetry_entries WHERE uuid = ?',
    );

    this.stmtSelectByBatch = this.db.prepare(
      'SELECT * FROM telemetry_entries WHERE batch_id = ? ORDER BY created_at ASC',
    );

    this.stmtDeleteAll = this.db.prepare('DELETE FROM telemetry_entries');
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private rowToEntry(row: DbRow): TelemetryEntry {
    return {
      uuid: row.uuid,
      type: row.type as TelemetryEntryType,
      createdAt: new Date(row.created_at),
      batchId: row.batch_id,
      content: JSON.parse(row.content) as Record<string, any>,
      userIdentifier: row.user_identifier,
      tenantId: row.tenant_id,
      tags: JSON.parse(row.tags) as string[],
    };
  }

  private entryToRow(entry: TelemetryEntry): Record<string, string> {
    return {
      uuid: entry.uuid,
      type: entry.type,
      created_at: entry.createdAt.toISOString(),
      batch_id: entry.batchId,
      content: JSON.stringify(entry.content),
      user_identifier: entry.userIdentifier,
      tenant_id: entry.tenantId,
      tags: JSON.stringify(entry.tags),
    };
  }

  private applyPostFilters(entries: TelemetryEntry[], filters: EntryFilters): TelemetryEntry[] {
    return entries.filter((e) => {
      if (filters.method) {
        const entryMethod = e.content?.method as string | undefined;
        if (!entryMethod || entryMethod.toUpperCase() !== filters.method.toUpperCase()) return false;
      }
      if (filters.statusGroup) {
        const status = e.content?.status as number | undefined;
        if (status === undefined) return false;
        const group = filters.statusGroup.toLowerCase();
        const hundreds = Math.floor(status / 100);
        if (group !== `${hundreds}xx`) return false;
      }
      if (filters.search) {
        const term = filters.search.toLowerCase();
        const matched = Object.values(e.content ?? {}).some(
          (v) => v !== null && v !== undefined && String(v).toLowerCase().includes(term),
        );
        if (!matched) return false;
      }
      return true;
    });
  }

  private dbCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM telemetry_entries').get() as { cnt: number };
    return row.cnt;
  }

  // ── TelemetryStorage ──────────────────────────────────────────────────────

  isEnabled(): boolean {
    return this.enabled_;
  }

  setEnabled(enabled: boolean): void {
    this.enabled_ = enabled;
  }

  async store(entry: TelemetryEntry): Promise<void> {
    if (!this.enabled_) return;
    this.buffer.push(entry);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const BATCH = 200;
    const toFlush = this.buffer.splice(0, BATCH);

    const insertMany = this.db.transaction((rows: ReturnType<typeof this.entryToRow>[]) => {
      for (const row of rows) {
        this.stmtInsert.run(row);
      }
    });

    try {
      insertMany(toFlush.map((e) => this.entryToRow(e)));
    } catch (err) {
      // re-queue failed entries at the front
      this.buffer.unshift(...toFlush);
      throw err;
    }

    // recursively flush if more remain
    if (this.buffer.length > 0) {
      await this.flush();
    }
  }

  async getByType(
    type: TelemetryEntryType,
    filters: EntryFilters,
    page: number,
    size: number,
  ): Promise<TelemetryEntry[]> {
    await this.flush();

    const params: (string | number)[] = [type];
    let where = 'WHERE type = ?';

    if (filters.userIdentifier) {
      where += ' AND user_identifier = ?';
      params.push(filters.userIdentifier);
    }
    if (filters.tenantId) {
      where += ' AND tenant_id = ?';
      params.push(filters.tenantId);
    }

    params.push(size, page * size);
    const sql = `SELECT * FROM telemetry_entries ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...params) as DbRow[];
    const entries = rows.map((r) => this.rowToEntry(r));
    return this.applyPostFilters(entries, filters);
  }

  async countByType(type: TelemetryEntryType, filters: EntryFilters): Promise<number> {
    await this.flush();

    const params: (string | number)[] = [type];
    let where = 'WHERE type = ?';

    if (filters.userIdentifier) {
      where += ' AND user_identifier = ?';
      params.push(filters.userIdentifier);
    }
    if (filters.tenantId) {
      where += ' AND tenant_id = ?';
      params.push(filters.tenantId);
    }

    const sql = `SELECT COUNT(*) as cnt FROM telemetry_entries ${where}`;
    const row = this.db.prepare(sql).get(...params) as { cnt: number };
    return row.cnt;
  }

  async getByUuid(uuid: string): Promise<TelemetryEntry | null> {
    // check buffer first
    const buffered = this.buffer.find((e) => e.uuid === uuid);
    if (buffered) return buffered;

    const row = this.stmtSelectByUuid.get(uuid) as DbRow | undefined;
    return row ? this.rowToEntry(row) : null;
  }

  async getByBatchId(batchId: string): Promise<TelemetryEntry[]> {
    await this.flush();

    const dbRows = this.stmtSelectByBatch.all(batchId) as DbRow[];
    const dbEntries = dbRows.map((r) => this.rowToEntry(r));
    const bufferEntries = this.buffer.filter((e) => e.batchId === batchId);

    // merge + deduplicate by uuid
    const seen = new Set<string>(dbEntries.map((e) => e.uuid));
    for (const e of bufferEntries) {
      if (!seen.has(e.uuid)) {
        seen.add(e.uuid);
        dbEntries.push(e);
      }
    }

    return dbEntries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async getStats(): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};

    // seed with zeros for all known types
    for (const t of Object.values(TelemetryEntryType)) {
      stats[t] = 0;
    }

    // DB counts
    const rows = this.db
      .prepare('SELECT type, COUNT(*) as cnt FROM telemetry_entries GROUP BY type')
      .all() as { type: string; cnt: number }[];
    for (const row of rows) {
      stats[row.type] = (stats[row.type] ?? 0) + row.cnt;
    }

    // buffer counts
    for (const entry of this.buffer) {
      stats[entry.type] = (stats[entry.type] ?? 0) + 1;
    }

    return stats;
  }

  async clear(): Promise<void> {
    this.buffer.length = 0;
    this.stmtDeleteAll.run();
  }

  async clearByType(type: TelemetryEntryType): Promise<void> {
    // remove from buffer
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].type === type) this.buffer.splice(i, 1);
    }
    this.db.prepare('DELETE FROM telemetry_entries WHERE type = ?').run(type);
  }

  async pruneOlderThan(date: Date): Promise<number> {
    const iso = date.toISOString();

    // prune buffer
    let pruned = 0;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].createdAt < date) {
        this.buffer.splice(i, 1);
        pruned++;
      }
    }

    // prune DB
    const result = this.db.prepare('DELETE FROM telemetry_entries WHERE created_at < ?').run(iso);
    pruned += result.changes;

    return pruned;
  }

  async getDistinctTags(): Promise<string[]> {
    await this.flush();
    const rows = this.db
      .prepare('SELECT DISTINCT tags FROM telemetry_entries WHERE tags != ?')
      .all('[]') as { tags: string }[];

    const tagSet = new Set<string>();
    for (const row of rows) {
      const parsed = JSON.parse(row.tags) as string[];
      for (const tag of parsed) tagSet.add(tag);
    }
    return Array.from(tagSet).sort();
  }

  async getDistinctUserIdentifiers(): Promise<string[]> {
    await this.flush();
    const rows = this.db
      .prepare("SELECT DISTINCT user_identifier FROM telemetry_entries WHERE user_identifier != ''")
      .all() as { user_identifier: string }[];
    return rows.map((r) => r.user_identifier).sort();
  }

  async getDistinctTenantIds(): Promise<string[]> {
    await this.flush();
    const rows = this.db
      .prepare("SELECT DISTINCT tenant_id FROM telemetry_entries WHERE tenant_id != ''")
      .all() as { tenant_id: string }[];
    return rows.map((r) => r.tenant_id).sort();
  }

  async getMemoryInfo(): Promise<Record<string, any>> {
    const dbEntries = this.dbCount();
    const bufferSize = this.buffer.length;
    return {
      type: 'sqlite',
      bufferSize,
      dbEntries,
      totalEntries: bufferSize + dbEntries,
      enabled: this.enabled_,
    };
  }

  close(): void {
    this.db.close();
  }
}
