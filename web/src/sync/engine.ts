import { mergeRound, type Round } from '@rounds/shared'

import { NetworkError, RejectedError, type Api } from '../data/api.ts'
import type { Repo } from '../data/repo.ts'

export interface SyncStatus {
  online: boolean
  syncing: boolean
  lastError: string | null
}

export interface EngineOptions {
  /** How often to pull while online. */
  pullEveryMs?: number
  /** Injectable for tests. */
  isOnline?: () => boolean
}

const MAX_MERGE_RETRIES = 3

/**
 * Moves data between the device and the server, in both directions, and
 * never loses an edit doing it:
 *
 * - `push` drains the outbox one round at a time. A 409 is merged three
 *   ways against the last server copy; if nothing overlaps the merge is
 *   pushed straight away, otherwise the round is parked until the person
 *   picks, and the rest of the queue carries on.
 * - `pull` fetches what changed since the last sync. Rounds with local
 *   edits waiting are not overwritten; their server copy is updated so the
 *   next merge has the right base.
 * - Going offline is not an error, just a reason to wait.
 */
export class SyncEngine {
  status: SyncStatus
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private running: Promise<void> | null = null
  private readonly isOnline: () => boolean
  private readonly pullEveryMs: number
  private readonly repo: Repo
  private readonly api: Api

  constructor(repo: Repo, api: Api, options: EngineOptions = {}) {
    this.repo = repo
    this.api = api
    this.isOnline =
      options.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine))
    this.pullEveryMs = options.pullEveryMs ?? 30_000
    this.status = { online: this.isOnline(), syncing: false, lastError: null }
  }

  start(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline)
      window.addEventListener('offline', this.onOffline)
    }
    this.timer = setInterval(() => void this.sync(), this.pullEveryMs)
    void this.sync()
  }

  stop(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline)
      window.removeEventListener('offline', this.onOffline)
    }
    if (this.timer) clearInterval(this.timer)
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }
  getSnapshot = (): SyncStatus => this.status

  private onOnline = () => {
    this.set({ online: true })
    void this.sync()
  }
  private onOffline = () => this.set({ online: false })

  private set(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch }
    for (const l of this.listeners) l()
  }

  /** Push, then pull. Calls overlap safely: a second call waits for the first. */
  sync(): Promise<void> {
    if (this.running) return this.running
    this.running = this.run().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async run(): Promise<void> {
    if (!this.isOnline()) {
      this.set({ online: false })
      return
    }
    this.set({ online: true, syncing: true, lastError: null })
    try {
      await this.push()
      await this.pushPhotos()
      await this.pull()
      this.set({ syncing: false })
    } catch (e) {
      const offline = e instanceof NetworkError
      this.set({
        syncing: false,
        online: !offline,
        lastError: offline ? null : e instanceof Error ? e.message : String(e),
      })
    }
  }

  async pull(): Promise<void> {
    const data = await this.api.pull(this.repo.getSnapshot().lastSync)
    await this.repo.applyPull(data)
  }

  /** One round failing for its own reasons must not hold the others, or the pull. */
  async push(): Promise<void> {
    const queue = this.repo.getSnapshot().outbox.filter((e) => !e.blocked)
    for (const entry of queue) {
      try {
        await this.pushOne(entry.roundId)
      } catch (e) {
        if (e instanceof NetworkError) throw e
        await this.repo.markAttempt(entry.roundId, e instanceof Error ? e.message : String(e))
      }
    }
  }

  private async pushOne(roundId: string): Promise<void> {
    for (let attempt = 0; attempt <= MAX_MERGE_RETRIES; attempt += 1) {
      const pushed = this.repo.getRound(roundId)
      if (!pushed) return
      const result = await this.api.pushRound(pushed)
      if (result.status === 200 && result.body.ok) {
        await this.repo.confirmPush(result.body.round, pushed.updatedAt)
        return
      }
      if (result.status !== 409 || result.body.ok)
        throw new RejectedError(result.status, 'unexpected push response')

      const theirs = result.body.current
      const merged = await this.mergeAgainst(pushed, theirs)
      if (merged.conflicts.length > 0) {
        await this.repo.adoptMerge(merged.round, theirs)
        await this.repo.setConflict({
          roundId,
          merged: { ...merged.round, version: theirs.version },
          conflicts: merged.conflicts,
        })
        await this.repo.markAttempt(roundId, 'needs your decision', true)
        return
      }
      await this.repo.adoptMerge(merged.round, theirs)
      await this.repo.markAttempt(roundId)
    }
    await this.repo.markAttempt(roundId, 'kept losing the race; will retry')
  }

  /**
   * Three-way merge of what was pushed against what the server has. The base
   * is the server copy only when it is the version the push was made from;
   * otherwise nothing can be assumed and every difference is a conflict.
   * Edits made while the push was in flight are layered on afterwards.
   */
  private async mergeAgainst(
    pushed: Round,
    theirs: Round,
  ): Promise<{ round: Round; conflicts: ReturnType<typeof mergeRound>['conflicts'] }> {
    const stored = await this.repo.serverCopy(pushed.id)
    const base =
      stored && stored.version === pushed.version
        ? stored
        : { ...theirs, items: {}, finishedAt: null }
    const first = mergeRound(base, pushed, theirs)
    let round = first.merged
    let conflicts = first.conflicts
    if (first.signOffDropped)
      this.repo.setNotice('A round was reopened: items changed while it was being signed off.')

    const latest = this.repo.getRound(pushed.id)
    if (latest && latest.updatedAt !== pushed.updatedAt) {
      const second = mergeRound(pushed, latest, round)
      round = second.merged
      conflicts = [...conflicts, ...second.conflicts]
    }
    return {
      round: { ...round, updatedAt: Math.max(round.updatedAt, latest?.updatedAt ?? 0) },
      conflicts,
    }
  }

  private async pushPhotos(): Promise<void> {
    for (const photo of await this.repo.pendingPhotos()) {
      try {
        await this.api.uploadPhoto(photo.id, photo.roundId, photo.itemId, photo.blob)
        await this.repo.markPhotoUploaded(photo.id)
      } catch (e) {
        if (e instanceof NetworkError) throw e
        if (e instanceof RejectedError && e.status === 404) continue // the round has not synced yet; next time
        await this.repo.markPhotoRejected(photo.id, e instanceof Error ? e.message : String(e))
      }
    }
  }
}
