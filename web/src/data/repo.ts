import type { IDBPDatabase } from 'idb'

import type { Checklist, Round, Site } from '@rounds/shared'

import type { OutboxEntry, PendingConflict, RoundsDB, StoredPhoto } from './db.ts'

export interface RepoSnapshot {
  sites: Site[]
  checklists: Checklist[]
  rounds: Round[]
  outbox: OutboxEntry[]
  conflicts: PendingConflict[]
  technician: string
  lastSync: number
  loaded: boolean
  /** Something the person should know, e.g. a sign-off that had to be dropped. */
  notice: string | null
}

/**
 * Everything the screens read, held in memory and written through to
 * IndexedDB. The in-memory copy makes rendering synchronous; IndexedDB makes
 * it survive a closed tab, which for a field app is the whole point.
 */
export class Repo {
  private snapshot: RepoSnapshot = {
    sites: [],
    checklists: [],
    rounds: [],
    outbox: [],
    conflicts: [],
    technician: '',
    lastSync: 0,
    loaded: false,
    notice: null,
  }
  private readonly listeners = new Set<() => void>()
  readonly db: IDBPDatabase<RoundsDB>
  /** Writes run one after another; a save and a pull can never interleave their transactions. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(db: IDBPDatabase<RoundsDB>) {
    this.db = db
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work)
    this.chain = next.catch(() => undefined)
    return next
  }

  setNotice(notice: string | null): void {
    this.set({ notice })
  }

  async load(): Promise<void> {
    const [sites, checklists, rounds, outbox, conflicts, technician, lastSync] = await Promise.all([
      this.db.getAll('sites'),
      this.db.getAll('checklists'),
      this.db.getAll('rounds'),
      this.db.getAll('outbox'),
      this.db.getAll('conflicts'),
      this.db.get('meta', 'technician'),
      this.db.get('meta', 'lastSync'),
    ])
    this.snapshot = {
      sites,
      checklists,
      rounds,
      outbox,
      conflicts,
      technician: typeof technician?.value === 'string' ? technician.value : '',
      lastSync: typeof lastSync?.value === 'number' ? lastSync.value : 0,
      loaded: true,
      notice: null,
    }
    this.emit()
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }
  getSnapshot = (): RepoSnapshot => this.snapshot

  private emit(): void {
    for (const l of this.listeners) l()
  }
  private set(patch: Partial<RepoSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.emit()
  }

  async setTechnician(name: string): Promise<void> {
    await this.db.put('meta', { key: 'technician', value: name })
    this.set({ technician: name })
  }

  /**
   * Applies a pull. A round with local edits waiting is left alone entirely:
   * its local copy holds the edits and its server copy stays the version
   * those edits were made from, which is the base the merge needs. The push
   * will hit a 409 and merge against the real current record.
   */
  applyPull(data: {
    now: number
    sites: Site[]
    checklists: Checklist[]
    rounds: Round[]
  }): Promise<void> {
    return this.serial(async () => {
      const pending = new Set(this.snapshot.outbox.map((e) => e.roundId))
      const incoming = data.rounds.filter((r) => !pending.has(r.id))
      // Memory first, so an edit that lands during the transaction builds on the pulled copy.
      const byId = new Map(this.snapshot.rounds.map((r) => [r.id, r]))
      for (const r of incoming) byId.set(r.id, r)
      this.set({ rounds: [...byId.values()], lastSync: data.now })
      const tx = this.db.transaction(
        ['sites', 'checklists', 'rounds', 'serverRounds', 'meta'],
        'readwrite',
      )
      for (const site of data.sites) await tx.objectStore('sites').put(site)
      for (const c of data.checklists) await tx.objectStore('checklists').put(c)
      for (const r of incoming) {
        await tx.objectStore('serverRounds').put(r)
        await tx.objectStore('rounds').put(r)
      }
      await tx.objectStore('meta').put({ key: 'lastSync', value: data.now })
      await tx.done
      await this.reloadLists()
    })
  }

  private async reloadLists(): Promise<void> {
    const [sites, checklists, rounds, outbox, conflicts] = await Promise.all([
      this.db.getAll('sites'),
      this.db.getAll('checklists'),
      this.db.getAll('rounds'),
      this.db.getAll('outbox'),
      this.db.getAll('conflicts'),
    ])
    this.set({ sites, checklists, rounds, outbox, conflicts })
  }

  getRound(id: string): Round | undefined {
    return this.snapshot.rounds.find((r) => r.id === id)
  }

  /**
   * Saves a local edit and queues the round for push. Memory is updated
   * before the disk write starts, so two taps in quick succession both see
   * the first one's result instead of racing an IndexedDB transaction.
   */
  saveRound(input: Round): Promise<void> {
    const prev = this.snapshot.rounds.find((r) => r.id === input.id)
    // updatedAt is this device's revision marker; it must move on every save.
    const round: Round = {
      ...input,
      updatedAt: Math.max(input.updatedAt, (prev?.updatedAt ?? 0) + 1),
    }
    const rounds = prev
      ? this.snapshot.rounds.map((r) => (r.id === round.id ? round : r))
      : [...this.snapshot.rounds, round]
    const queued = this.snapshot.outbox.some((e) => e.roundId === round.id)
    this.set({
      rounds,
      outbox: queued
        ? this.snapshot.outbox
        : [...this.snapshot.outbox, { roundId: round.id, enqueuedAt: Date.now(), attempts: 0 }],
    })
    return this.serial(async () => {
      const tx = this.db.transaction(['rounds', 'outbox'], 'readwrite')
      await tx.objectStore('rounds').put(round)
      const existing = await tx.objectStore('outbox').get(round.id)
      if (!existing)
        await tx
          .objectStore('outbox')
          .put({ roundId: round.id, enqueuedAt: Date.now(), attempts: 0 })
      await tx.done
      await this.reloadLists()
    })
  }

  async serverCopy(id: string): Promise<Round | undefined> {
    return this.db.get('serverRounds', id)
  }

  /**
   * After a successful push. The stored round is the new server copy. The
   * local copy adopts the new version; it leaves the queue only if nobody
   * edited it while the push was in flight.
   */
  confirmPush(stored: Round, pushedRevision: number): Promise<void> {
    return this.serial(async () => {
      const tx = this.db.transaction(['rounds', 'serverRounds', 'outbox'], 'readwrite')
      await tx.objectStore('serverRounds').put(stored)
      const local = await tx.objectStore('rounds').get(stored.id)
      if (local) await tx.objectStore('rounds').put({ ...local, version: stored.version })
      if (!local || local.updatedAt === pushedRevision)
        await tx.objectStore('outbox').delete(stored.id)
      else {
        const entry = await tx.objectStore('outbox').get(stored.id)
        await tx
          .objectStore('outbox')
          .put({ roundId: stored.id, enqueuedAt: entry?.enqueuedAt ?? Date.now(), attempts: 0 })
      }
      await tx.done
      await this.reloadLists()
    })
  }

  /**
   * After a 409 was merged: the server's current record becomes the base,
   * the merged round becomes the local copy (still queued), and its version
   * is the server's, so the next push names the right one.
   */
  adoptMerge(merged: Round, theirs: Round): Promise<void> {
    return this.serial(async () => {
      const tx = this.db.transaction(['rounds', 'serverRounds'], 'readwrite')
      await tx.objectStore('serverRounds').put(theirs)
      await tx.objectStore('rounds').put({ ...merged, version: theirs.version })
      await tx.done
      await this.reloadLists()
    })
  }

  async markAttempt(roundId: string, error?: string, blocked = false): Promise<void> {
    const entry = await this.db.get('outbox', roundId)
    if (!entry) return
    const next: OutboxEntry = { ...entry, attempts: entry.attempts + 1, blocked }
    if (error !== undefined) next.lastError = error
    else delete next.lastError
    await this.db.put('outbox', next)
    await this.reloadLists()
  }

  async setConflict(conflict: PendingConflict): Promise<void> {
    await this.db.put('conflicts', conflict)
    await this.reloadLists()
  }

  /** The person chose; the resolved round becomes local and goes back in the queue. */
  async resolveConflict(roundId: string, resolved: Round): Promise<void> {
    const tx = this.db.transaction(['rounds', 'conflicts', 'outbox'], 'readwrite')
    await tx.objectStore('rounds').put(resolved)
    await tx.objectStore('conflicts').delete(roundId)
    const entry = await tx.objectStore('outbox').get(roundId)
    await tx
      .objectStore('outbox')
      .put({ roundId, enqueuedAt: entry?.enqueuedAt ?? Date.now(), attempts: 0 })
    await tx.done
    await this.reloadLists()
  }

  async addPhoto(photo: StoredPhoto): Promise<void> {
    await this.db.put('photos', photo)
  }
  async getPhoto(id: string): Promise<StoredPhoto | undefined> {
    return this.db.get('photos', id)
  }
  async pendingPhotos(): Promise<StoredPhoto[]> {
    return (await this.db.getAll('photos')).filter((p) => !p.uploaded && !p.error)
  }
  async markPhotoUploaded(id: string): Promise<void> {
    const p = await this.db.get('photos', id)
    if (p) await this.db.put('photos', { ...p, uploaded: true })
  }
  /** A photo the server refused is kept, with the reason, and not retried until it is replaced. */
  async markPhotoRejected(id: string, error: string): Promise<void> {
    const p = await this.db.get('photos', id)
    if (p) await this.db.put('photos', { ...p, error })
  }
}
