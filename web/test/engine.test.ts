import { deleteDB } from 'idb'
import { beforeEach, describe, expect, it } from 'vitest'

import { openRoundsDB } from '../src/data/db.ts'
import { Repo } from '../src/data/repo.ts'
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
