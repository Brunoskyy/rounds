import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'

import type { Checklist, Photo, Round, Site } from '@rounds/shared'

const { DatabaseSync } = process.getBuiltinModule('node:sqlite')

/**
 * Sites and checklists are read-mostly reference data; rounds are the
 * thing technicians write. Everything carries `updated_at` so a device can
 * ask "what changed since I last looked" with one query per table.
 */
export class Store {
  private readonly db: DatabaseSyncType

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS checklists (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rounds (id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, round_id TEXT NOT NULL, item_id TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sites_updated ON sites(updated_at);
      CREATE INDEX IF NOT EXISTS checklists_updated ON checklists(updated_at);
      CREATE INDEX IF NOT EXISTS rounds_updated ON rounds(updated_at);
    `)
  }

  upsertSite(site: Site): void {
    this.db
      .prepare('INSERT OR REPLACE INTO sites (id, data, updated_at) VALUES (?, ?, ?)')
      .run(site.id, JSON.stringify(site), site.updatedAt)
  }

  upsertChecklist(c: Checklist): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO checklists (id, site_id, data, updated_at) VALUES (?, ?, ?, ?)',
      )
      .run(c.id, c.siteId, JSON.stringify(c), c.updatedAt)
  }

  getChecklist(id: string): Checklist | null {
    const row = this.db.prepare('SELECT data FROM checklists WHERE id = ?').get(id) as
      { data: string } | undefined
    return row ? (JSON.parse(row.data) as Checklist) : null
  }

  getRound(id: string): Round | null {
    const row = this.db.prepare('SELECT data FROM rounds WHERE id = ?').get(id) as
      { data: string } | undefined
    return row ? (JSON.parse(row.data) as Round) : null
  }

  /**
   * Writes a round if `expectedVersion` is what is stored (or the round is
   * new and the expected version is 0). Returns the stored round on success,
   * null on a version mismatch. The check and the write are one statement,
   * so two devices racing cannot both win.
   */
  putRound(round: Round, expectedVersion: number, now: number): Round | null {
    const next: Round = { ...round, version: expectedVersion + 1, updatedAt: now }
    const data = JSON.stringify(next)
    if (expectedVersion === 0) {
      try {
        this.db
          .prepare('INSERT INTO rounds (id, data, version, updated_at) VALUES (?, ?, 1, ?)')
          .run(round.id, data, now)
        return next
      } catch (e) {
        if (e instanceof Error && /UNIQUE constraint failed/.test(e.message)) return null
        throw e
      }
    }
    const result = this.db
      .prepare(
        'UPDATE rounds SET data = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?',
      )
      .run(data, next.version, now, round.id, expectedVersion)
    return result.changes === 1 ? next : null
  }

  changedSince(since: number): { sites: Site[]; checklists: Checklist[]; rounds: Round[] } {
    const pick = <T>(table: string): T[] =>
      (
        this.db
          .prepare(`SELECT data FROM ${table} WHERE updated_at > ? ORDER BY updated_at`)
          .all(since) as Array<{ data: string }>
      ).map((r) => JSON.parse(r.data) as T)
    return {
      sites: pick<Site>('sites'),
      checklists: pick<Checklist>('checklists'),
      rounds: pick<Round>('rounds'),
    }
  }

  putPhoto(photo: Photo, bytes: Buffer, now: number): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO photos (id, round_id, item_id, mime, bytes, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(photo.id, photo.roundId, photo.itemId, photo.mime, bytes, now)
  }

  getPhoto(id: string): { mime: string; bytes: Buffer } | null {
    const row = this.db.prepare('SELECT mime, bytes FROM photos WHERE id = ?').get(id) as
      { mime: string; bytes: Uint8Array } | undefined
    return row ? { mime: row.mime, bytes: Buffer.from(row.bytes) } : null
  }

  count(table: 'sites' | 'checklists' | 'rounds' | 'photos'): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  }

  close(): void {
    this.db.close()
  }
}
