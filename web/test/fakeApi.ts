import {
  emptyRound,
  type Checklist,
  type PutRoundResponse,
  type Round,
  type Site,
  type SyncResponse,
} from '@rounds/shared'

import { NetworkError, type Api } from '../src/data/api.ts'

export const checklist: Checklist = {
  id: 'chk',
  siteId: 'site',
  name: 'Boiler',
  updatedAt: 1,
  items: [
    { id: 'pressure', label: 'Pressure', kind: 'reading', unit: 'bar', range: { min: 1, max: 3 } },
    { id: 'leaks', label: 'Leaks', kind: 'check' },
    { id: 'photo', label: 'Photo', kind: 'photo' },
  ],
}
export const site: Site = { id: 'site', name: 'Plant', address: '1 Rd', updatedAt: 1 }

/**
 * A server in memory with the same version rule as the real one, plus a
 * switch to simulate the network going away.
 */
export class FakeApi implements Api {
  rounds = new Map<string, Round>()
  offline = false
  pushes = 0
  photos: string[] = []
  clock = 100

  async pull(since: number): Promise<SyncResponse> {
    if (this.offline) throw new NetworkError('offline')
    return {
      now: ++this.clock,
      sites: since === 0 ? [site] : [],
      checklists: since === 0 ? [checklist] : [],
      rounds: [...this.rounds.values()].filter((r) => r.updatedAt > since),
    }
  }

  async pushRound(
    round: Round,
  ): Promise<{ status: 200; body: PutRoundResponse } | { status: 409; body: PutRoundResponse }> {
    if (this.offline) throw new NetworkError('offline')
    this.pushes += 1
    const current = this.rounds.get(round.id)
    const expected = current?.version ?? 0
    if (round.version !== expected) {
      return { status: 409, body: { ok: false, conflict: true, current: current as Round } }
    }
    const stored = { ...round, version: expected + 1, updatedAt: ++this.clock }
    this.rounds.set(round.id, stored)
    return { status: 200, body: { ok: true, round: stored } }
  }

  async uploadPhoto(id: string): Promise<void> {
    if (this.offline) throw new NetworkError('offline')
    this.photos.push(id)
  }

  /** Someone else edits a round on the server. */
  otherDeviceEdits(id: string, patch: (r: Round) => Round): void {
    const current = this.rounds.get(id)
    if (!current) throw new Error('no such round')
    this.rounds.set(id, {
      ...patch(current),
      version: current.version + 1,
      updatedAt: ++this.clock,
    })
  }
}

export const newRound = (id: string, technician = 'Ana') =>
  emptyRound(id, checklist, technician, 50)
