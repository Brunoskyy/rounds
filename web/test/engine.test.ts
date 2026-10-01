import { deleteDB } from 'idb'
import { beforeEach, describe, expect, it } from 'vitest'

import { openRoundsDB } from '../src/data/db.ts'
import { Repo } from '../src/data/repo.ts'
import { RejectedError } from '../src/data/api.ts'
import { SyncEngine } from '../src/sync/engine.ts'
import { FakeApi, newRound } from './fakeApi.ts'

let n = 0
async function setup(online = true) {
  const name = `test-${++n}`
  await deleteDB(name)
  const repo = new Repo(await openRoundsDB(name))
  await repo.load()
  const api = new FakeApi()
  api.offline = !online
  const engine = new SyncEngine(repo, api, { isOnline: () => !api.offline })
  return { repo, api, engine }
}

const setItem = (
  r: ReturnType<typeof newRound>,
  id: string,
  patch: Partial<ReturnType<typeof newRound>['items'][string]>,
) => ({
  ...r,
  items: {
    ...r.items,
    [id]: { ...r.items[id]!, ...patch, updatedAt: (r.items[id]?.updatedAt ?? 0) + 1 },
  },
})

beforeEach(() => {
  n += 0
})

describe('SyncEngine', () => {
  it('pulls reference data and pushes a new round', async () => {
    const { repo, api, engine } = await setup()
    await engine.sync()
    expect(repo.getSnapshot().sites.map((s) => s.name)).toEqual(['Plant'])
    expect(repo.getSnapshot().checklists).toHaveLength(1)

    await repo.saveRound(newRound('r1'))
    expect(repo.getSnapshot().outbox.map((e) => e.roundId)).toEqual(['r1'])
    await engine.sync()
    expect(repo.getSnapshot().outbox).toEqual([])
    expect(api.rounds.get('r1')?.version).toBe(1)
    expect(repo.getRound('r1')?.version).toBe(1)
  })

  it('keeps edits queued while offline and sends them when back', async () => {
    const { repo, api, engine } = await setup(false)
    await repo.saveRound(setItem(newRound('r1'), 'leaks', { status: 'ok' }))
    await engine.sync()
    expect(engine.status.online).toBe(false)
    expect(engine.status.lastError).toBeNull()
    expect(repo.getSnapshot().outbox).toHaveLength(1)
    expect(api.pushes).toBe(0)

    api.offline = false
    await engine.sync()
    expect(engine.status.online).toBe(true)
    expect(repo.getSnapshot().outbox).toEqual([])
    expect(api.rounds.get('r1')?.items.leaks?.status).toBe('ok')
  })

  it('survives the tab closing: the queue is on disk', async () => {
    const { repo, api } = await setup(false)
    await repo.saveRound(newRound('r1'))
    const again = new Repo(repo.db)
    await again.load()
    expect(again.getSnapshot().outbox.map((e) => e.roundId)).toEqual(['r1'])
    api.offline = false
    const engine = new SyncEngine(again, api, { isOnline: () => true })
    await engine.sync()
    expect(again.getSnapshot().outbox).toEqual([])
  })

  it('merges a lost race automatically when the edits do not overlap', async () => {
    const { repo, api, engine } = await setup()
    await repo.saveRound(newRound('r1'))
    await engine.sync()
    api.otherDeviceEdits('r1', (r) => setItem(r, 'pressure', { status: 'ok', reading: 2.2 }))

    const mine = setItem(repo.getRound('r1')!, 'leaks', { status: 'issue', note: 'drip' })
    await repo.saveRound(mine)
    await engine.sync()

    const server = api.rounds.get('r1')!
    expect(server.version).toBe(3)
    expect(server.items.pressure).toMatchObject({ status: 'ok', reading: 2.2 })
    expect(server.items.leaks).toMatchObject({ status: 'issue', note: 'drip' })
    expect(repo.getSnapshot().outbox).toEqual([])
    expect(repo.getSnapshot().conflicts).toEqual([])
    expect(repo.getRound('r1')).toMatchObject({ version: 3, items: { pressure: { reading: 2.2 } } })
  })

  it('parks a real conflict for the person and pushes the rest', async () => {
    const { repo, api, engine } = await setup()
    await repo.saveRound(newRound('r1'))
    await repo.saveRound(newRound('r2'))
    await engine.sync()
    api.otherDeviceEdits('r1', (r) => setItem(r, 'leaks', { status: 'ok' }))

    await repo.saveRound(setItem(repo.getRound('r1')!, 'leaks', { status: 'issue', note: 'rust' }))
    await repo.saveRound(setItem(repo.getRound('r2')!, 'leaks', { status: 'ok' }))
    await engine.sync()

    const snap = repo.getSnapshot()
    expect(snap.conflicts).toHaveLength(1)
    expect(snap.conflicts[0]?.conflicts.map((c) => c.itemId)).toEqual(['leaks'])
    expect(snap.outbox.find((e) => e.roundId === 'r1')?.blocked).toBe(true)
    expect(snap.outbox.find((e) => e.roundId === 'r2')).toBeUndefined()
    expect(api.rounds.get('r1')?.items.leaks?.status).toBe('ok')

    // Nothing moves for r1 until someone decides; a later sync does not retry it.
    const pushesBefore = api.pushes
    await engine.sync()
    expect(api.pushes).toBe(pushesBefore)

    const conflict = snap.conflicts[0]!
    const resolved = {
      ...conflict.merged,
      items: { ...conflict.merged.items, leaks: conflict.conflicts[0]!.mine },
    }
    await repo.resolveConflict('r1', resolved)
    await engine.sync()
    expect(api.rounds.get('r1')?.items.leaks).toMatchObject({ status: 'issue', note: 'rust' })
    expect(repo.getSnapshot().conflicts).toEqual([])
    expect(repo.getSnapshot().outbox).toEqual([])
  })

  it('does not touch a round with local edits on pull, and merges it on push', async () => {
    const { repo, api, engine } = await setup()
    await repo.saveRound(newRound('r1'))
    await engine.sync()
    api.offline = true
    await repo.saveRound(setItem(repo.getRound('r1')!, 'leaks', { status: 'skipped' }))
    api.otherDeviceEdits('r1', (r) => setItem(r, 'pressure', { status: 'ok', reading: 1.5 }))
    api.offline = false

    await engine.pull()
    expect(repo.getRound('r1')?.items.leaks?.status).toBe('skipped')
    expect(repo.getRound('r1')?.items.pressure?.status).toBe('pending')
    // The base stays the version the edits were made from.
    expect((await repo.serverCopy('r1'))?.version).toBe(1)

    await engine.sync()
    expect(api.rounds.get('r1')?.items).toMatchObject({
      leaks: { status: 'skipped' },
      pressure: { reading: 1.5 },
    })
  })

  it('uploads photos after the rounds', async () => {
    const { repo, api, engine } = await setup()
    await repo.saveRound(newRound('r1'))
    await repo.addPhoto({
      id: 'p1',
      roundId: 'r1',
      itemId: 'photo',
      mime: 'image/png',
      blob: new Blob(['x'], { type: 'image/png' }),
      uploaded: false,
    })
    await engine.sync()
    expect(api.photos).toEqual(['p1'])
    expect(await repo.pendingPhotos()).toEqual([])
  })
})

describe('Repo.saveRound', () => {
  it('reflects an edit in memory before the write finishes, so quick edits do not race', async () => {
    const { repo } = await setup()
    const r = newRound('r1')
    const first = repo.saveRound(setItem(r, 'leaks', { status: 'ok' }))
    // Immediately, before awaiting: the next edit must build on the first.
    const latest = repo.getRound('r1')!
    expect(latest.items.leaks?.status).toBe('ok')
    const second = repo.saveRound(setItem(latest, 'pressure', { status: 'issue', reading: 9 }))
    await Promise.all([first, second])
    const again = new Repo(repo.db)
    await again.load()
    expect(again.getRound('r1')?.items).toMatchObject({
      leaks: { status: 'ok' },
      pressure: { status: 'issue', reading: 9 },
    })
    expect(again.getSnapshot().outbox).toHaveLength(1)
  })
})

describe('edits during a push', () => {
  /** An API whose push waits until the test lets it through. */
  function gate(api: FakeApi) {
    let release: () => void = () => {}
    const original = api.pushRound.bind(api)
    api.pushRound = async (round) => {
      await new Promise<void>((r) => (release = r))
      return original(round)
    }
    return () => release()
  }

  it('keeps an edit made while the push is in flight, and sends it next', async () => {
    const { repo, api, engine } = await setup()
    await repo.saveRound(newRound('r1'))
    const release = gate(api)
    const syncing = engine.sync()
    await new Promise((r) => setTimeout(r, 10))
    await repo.saveRound(setItem(repo.getRound('r1')!, 'leaks', { status: 'issue', note: 'late' }))
    release()
    await syncing
    // Still queued, still on the device, base moved to the pushed version.
    expect(repo.getSnapshot().outbox.map((e) => e.roundId)).toEqual(['r1'])
    expect(repo.getRound('r1')).toMatchObject({
      version: 1,
      items: { leaks: { status: 'issue', note: 'late' } },
    })
    api.pushRound = FakeApi.prototype.pushRound.bind(api)
    await engine.sync()
    expect(repo.getSnapshot().outbox).toEqual([])
    expect(api.rounds.get('r1')?.items.leaks).toMatchObject({ status: 'issue', note: 'late' })
  })

  it('layers an in-flight edit on top of a merged 409', async () => {
    const { repo, api, engine } = await setup()
    await repo.saveRound(newRound('r1'))
    await engine.sync()
    api.otherDeviceEdits('r1', (r) => setItem(r, 'pressure', { status: 'ok', reading: 2 }))
    await repo.saveRound(setItem(repo.getRound('r1')!, 'leaks', { status: 'ok' }))
    const release = gate(api)
    const syncing = engine.sync()
    await new Promise((r) => setTimeout(r, 10))
    await repo.saveRound(
      setItem(repo.getRound('r1')!, 'photo', { status: 'skipped', note: 'no camera' }),
    )
    release()
    api.pushRound = FakeApi.prototype.pushRound.bind(api)
    await syncing
    await engine.sync()
    expect(api.rounds.get('r1')?.items).toMatchObject({
      pressure: { reading: 2 },
      leaks: { status: 'ok' },
      photo: { status: 'skipped', note: 'no camera' },
    })
    expect(repo.getSnapshot().outbox).toEqual([])
  })
})

describe('merge base', () => {
  it('treats every difference as a conflict when the base version does not match', async () => {
    const { repo, api, engine } = await setup()
    await repo.saveRound(newRound('r1'))
    await engine.sync()
    // Corrupt the base on purpose: pretend the device saw v1 but the base is missing.
    await repo.db.delete('serverRounds', 'r1')
    api.otherDeviceEdits('r1', (r) => setItem(r, 'pressure', { status: 'ok', reading: 2 }))
    await repo.saveRound(setItem(repo.getRound('r1')!, 'leaks', { status: 'issue' }))
    await engine.sync()
    const conflict = repo.getSnapshot().conflicts[0]
    expect(conflict?.conflicts.map((c) => c.itemId).sort()).toEqual(['leaks', 'pressure'])
    // Nothing was silently reverted on the server.
    expect(api.rounds.get('r1')?.items.pressure?.reading).toBe(2)
  })

  it('moves the base to the server copy after a clean merge, so the next 409 merges right', async () => {
    const { repo, api, engine } = await setup()
    await repo.saveRound(newRound('r1'))
    await engine.sync()
    api.otherDeviceEdits('r1', (r) => setItem(r, 'pressure', { status: 'ok', reading: 2 }))
    await repo.saveRound(setItem(repo.getRound('r1')!, 'leaks', { status: 'ok' }))
    await engine.sync()
    expect((await repo.serverCopy('r1'))?.version).toBe(3)
    // The other device now sets pressure back; with a stale base this would look like our change.
    api.otherDeviceEdits('r1', (r) => setItem(r, 'pressure', { status: 'pending' }))
    await repo.saveRound(setItem(repo.getRound('r1')!, 'photo', { status: 'skipped' }))
    await engine.sync()
    expect(api.rounds.get('r1')?.items.pressure?.status).toBe('pending')
    expect(repo.getSnapshot().conflicts).toEqual([])
  })

  it('moves the base on a parked conflict too, so a later 409 still merges cleanly', async () => {
    const { repo, api, engine } = await setup()
    await repo.saveRound(newRound('r1'))
    await engine.sync()
    api.otherDeviceEdits('r1', (r) => setItem(r, 'leaks', { status: 'ok' }))
    await repo.saveRound(setItem(repo.getRound('r1')!, 'leaks', { status: 'issue', note: 'rust' }))
    await engine.sync()
    expect(repo.getSnapshot().conflicts).toHaveLength(1)
    expect((await repo.serverCopy('r1'))?.version).toBe(2)

    // While the person decides, the other device changes a different item.
    api.otherDeviceEdits('r1', (r) => setItem(r, 'pressure', { status: 'ok', reading: 2 }))
    const conflict = repo.getSnapshot().conflicts[0]!
    await repo.resolveConflict('r1', {
      ...conflict.merged,
      items: { ...conflict.merged.items, leaks: conflict.conflicts[0]!.mine },
    })
    await engine.sync()
    expect(repo.getSnapshot().conflicts).toEqual([])
    expect(repo.getSnapshot().outbox).toEqual([])
    expect(api.rounds.get('r1')?.items).toMatchObject({
      leaks: { status: 'issue', note: 'rust' },
      pressure: { status: 'ok', reading: 2 },
    })
  })
})

describe('failures that are not the network', () => {
  it('records a rejected round and still pulls', async () => {
    const { repo, api, engine } = await setup()
    await repo.saveRound(newRound('r1'))
    await repo.saveRound(newRound('r2'))
    const original = api.pushRound.bind(api)
    api.pushRound = async (round) => {
      if (round.id === 'r1') throw new RejectedError(400, 'unknown checklist')
      return original(round)
    }
    await engine.sync()
    expect(repo.getSnapshot().sites).toHaveLength(1)
    expect(repo.getSnapshot().outbox.find((e) => e.roundId === 'r1')).toMatchObject({
      attempts: 1,
      lastError: 'unknown checklist',
    })
    expect(repo.getSnapshot().outbox.find((e) => e.roundId === 'r2')).toBeUndefined()
    expect(engine.status.online).toBe(true)
  })

  it('parks a refused photo instead of retrying it forever', async () => {
    const { repo, api, engine } = await setup()
    await repo.saveRound(newRound('r1'))
    api.uploadPhoto = () => Promise.reject(new RejectedError(415, 'jpeg, png or webp only'))
    await repo.addPhoto({
      id: 'p1',
      roundId: 'r1',
      itemId: 'photo',
      mime: 'image/gif',
      blob: new Blob(['x']),
      uploaded: false,
    })
    await engine.sync()
    expect(await repo.pendingPhotos()).toEqual([])
    expect((await repo.getPhoto('p1'))?.error).toMatch(/jpeg/)
    expect(repo.getSnapshot().sites).toHaveLength(1)
  })
})

describe('sign-off', () => {
  it('reopens a round signed off while the other side changed an item', async () => {
    const { repo, api, engine } = await setup()
    await repo.saveRound(newRound('r1'))
    await engine.sync()
    api.otherDeviceEdits('r1', (r) => setItem(r, 'leaks', { status: 'issue', note: 'found late' }))
    await repo.saveRound({ ...repo.getRound('r1')!, finishedAt: 999 })
    await engine.sync()
    expect(api.rounds.get('r1')?.finishedAt).toBeNull()
    expect(repo.getSnapshot().notice).toMatch(/reopened/)
  })
})
