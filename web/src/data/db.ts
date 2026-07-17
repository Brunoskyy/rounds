import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import type { Checklist, ItemConflict, Round, Site } from '@rounds/shared'

/** A round waiting to be pushed. One entry per round, however many edits. */
export interface OutboxEntry {
  roundId: string
  enqueuedAt: number
  attempts: number
  lastError?: string
  /** Set when a push hit a conflict the person has to resolve first. */
  blocked?: boolean
}

export interface StoredPhoto {
  id: string
  roundId: string
  itemId: string
  mime: string
  blob: Blob
  uploaded: boolean
  /** Set when the server refused it (wrong type, too large); shown, not retried. */
  error?: string
}

export interface PendingConflict {
  roundId: string
  merged: Round
  conflicts: ItemConflict[]
}

export interface RoundsDB extends DBSchema {
  sites: { key: string; value: Site }
  checklists: { key: string; value: Checklist; indexes: { bySite: string } }
  /** The copy this device edits. */
  rounds: { key: string; value: Round; indexes: { bySite: string } }
  /** The last copy the server confirmed, per round: the base for merges. */
  serverRounds: { key: string; value: Round }
  outbox: { key: string; value: OutboxEntry }
  photos: { key: string; value: StoredPhoto; indexes: { byUploaded: number } }
  conflicts: { key: string; value: PendingConflict }
  meta: { key: string; value: { key: string; value: unknown } }
}

export const DB_NAME = 'rounds'

export function openRoundsDB(name = DB_NAME): Promise<IDBPDatabase<RoundsDB>> {
  return openDB<RoundsDB>(name, 1, {
    upgrade(db) {
      db.createObjectStore('sites', { keyPath: 'id' })
      db.createObjectStore('checklists', { keyPath: 'id' }).createIndex('bySite', 'siteId')
      db.createObjectStore('rounds', { keyPath: 'id' }).createIndex('bySite', 'siteId')
      db.createObjectStore('serverRounds', { keyPath: 'id' })
      db.createObjectStore('outbox', { keyPath: 'roundId' })
      db.createObjectStore('photos', { keyPath: 'id' }).createIndex('byUploaded', 'uploaded')
      db.createObjectStore('conflicts', { keyPath: 'roundId' })
      db.createObjectStore('meta', { keyPath: 'key' })
    },
  })
}
