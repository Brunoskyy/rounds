import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  emptyRound,
  type Checklist,
  type PutRoundResponse,
  type Round,
  type SyncResponse,
} from '@rounds/shared'
import { afterEach, describe, expect, it } from 'vitest'

import { createApp, type App } from '../src/app.ts'

interface T {
  app: App
  base: string
  dir: string
}
const apps: T[] = []
let clock = 1_000_000

async function boot(): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'rounds-'))
  const app = createApp({ dbPath: join(dir, 'test.db'), now: () => (clock += 1) })
  const port = await app.listen(0, '127.0.0.1')
  const t = { app, base: `http://127.0.0.1:${port}`, dir }
  apps.push(t)
  return t
}
afterEach(async () => {
  for (const t of apps.splice(0)) {
    await t.app.close()
    await rm(t.dir, { recursive: true, force: true })
  }
})

const sync = async (t: T, since = 0) =>
  (await (await fetch(`${t.base}/api/sync?since=${since}`)).json()) as SyncResponse
const put = async (t: T, round: Round) => {
  const res = await fetch(`${t.base}/api/rounds/${round.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(round),
  })
  return { status: res.status, body: (await res.json()) as PutRoundResponse }
}

describe('sync pull', () => {
  it('returns the seeded reference data and only what changed after a timestamp', async () => {
    const t = await boot()
    const all = await sync(t)
    expect(all.sites.map((s) => s.id)).toEqual(['site-harbor', 'site-north'])
    expect(all.checklists).toHaveLength(3)
    expect(all.rounds).toEqual([])
    const later = await sync(t, all.now)
    expect(later.sites).toEqual([])
    expect(later.checklists).toEqual([])
  })
})

describe('sync cursor', () => {
  it('delivers a write stamped in the same millisecond as the cursor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rounds-'))
    // A clock that stands still: every request sees the same millisecond.
    const app = createApp({ dbPath: join(dir, 'test.db'), now: () => 5000 })
    const port = await app.listen(0, '127.0.0.1')
    const t = { app, base: `http://127.0.0.1:${port}`, dir }
    apps.push(t)
    const first = await sync(t)
    expect(first.now).toBe(5000)
    const checklist = first.checklists[0] as Checklist
    await put(t, emptyRound('r1', checklist, 'Ana', 5))
    const second = await sync(t, first.now)
    expect(second.rounds.map((r) => r.id)).toEqual(['r1'])
  })
})

describe('rounds', () => {
  it('creates a round, then rejects a stale write with the current record', async () => {
    const t = await boot()
    const checklist = (await sync(t)).checklists.find((c) => c.id === 'chk-boiler') as Checklist
    const fresh = emptyRound('r1', checklist, 'Ana', 5)
    const created = await put(t, fresh)
    expect(created.status).toBe(200)
    expect(created.body).toMatchObject({ ok: true, round: { id: 'r1', version: 1 } })

    // Device A edits from version 1 and wins.
    const v1 = (created.body as { round: Round }).round
    const a = {
      ...v1,
      items: {
        ...v1.items,
        pressure: { ...v1.items.pressure!, status: 'ok' as const, reading: 5.2 },
      },
    }
    expect((await put(t, a)).body).toMatchObject({ ok: true, round: { version: 2 } })

    // Device B also edits from version 1 and loses, but gets what to merge against.
    const b = {
      ...v1,
      items: {
        ...v1.items,
        leaks: { ...v1.items.leaks!, status: 'issue' as const, note: 'seal weeping' },
      },
    }
    const lost = await put(t, b)
    expect(lost.status).toBe(409)
    expect(lost.body).toMatchObject({ ok: false, conflict: true, current: { version: 2 } })
    expect((lost.body as { current: Round }).current.items.pressure?.reading).toBe(5.2)

    // The pull now carries the round.
    const pulled = await sync(t)
    expect(pulled.rounds.map((r) => [r.id, r.version])).toEqual([['r1', 2]])
  })

  it('refuses a second create with the same id and validates input', async () => {
    const t = await boot()
    const checklist = (await sync(t)).checklists[0] as Checklist
    const fresh = emptyRound('r2', checklist, 'Ana', 5)
    await put(t, fresh)
    const again = await put(t, fresh)
    expect(again.status).toBe(409)

    const bad = await fetch(`${t.base}/api/rounds/r3`, {
      method: 'PUT',
      body: '{"id":"r3"}',
      headers: { 'content-type': 'application/json' },
    })
    expect(bad.status).toBe(400)
    const mismatch = await fetch(`${t.base}/api/rounds/other`, {
      method: 'PUT',
      body: JSON.stringify(fresh),
      headers: { 'content-type': 'application/json' },
    })
    expect(await mismatch.json()).toMatchObject({ error: /does not match/ })
    const unknownChecklist = await put(t, { ...fresh, id: 'r4', checklistId: 'nope' })
    expect(unknownChecklist.status).toBe(400)
    expect((await fetch(`${t.base}/api/rounds/..%2Fetc`)).status).toBe(400)
  })
})

describe('photos', () => {
  it('stores and serves bytes, once per id, and refuses other types', async () => {
    const t = await boot()
    const checklist = (await sync(t)).checklists.find((c) => c.id === 'chk-boiler') as Checklist
    await put(t, emptyRound('r1', checklist, 'Ana', 5))
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])
    const upload = (id: string, query: string, body: Buffer | string, type = 'image/png') =>
      fetch(`${t.base}/api/photos/${id}?${query}`, {
        method: 'PUT',
        headers: { 'content-type': type },
        body,
      })

    const up = await upload('p1', 'round=r1&item=gauge-photo', png)
    expect(up.status).toBe(200)
    expect(await up.json()).toMatchObject({
      ok: true,
      photo: { id: 'p1', mime: 'image/png', bytes: 8 },
    })
    const down = await fetch(`${t.base}/api/photos/p1`)
    expect(down.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await down.arrayBuffer()).equals(png)).toBe(true)

    // A retry with the same bytes is fine; different bytes for a stored id are not.
    expect((await upload('p1', 'round=r1&item=gauge-photo', png)).status).toBe(200)
    expect((await upload('p1', 'round=r1&item=gauge-photo', Buffer.from('evil'))).status).toBe(409)
    expect(
      Buffer.from(await (await fetch(`${t.base}/api/photos/p1`)).arrayBuffer()).equals(png),
    ).toBe(true)

    expect((await upload('p2', 'round=r1&item=gauge-photo', 'hi', 'text/plain')).status).toBe(415)
    expect((await upload('p3', 'round=nope&item=gauge-photo', png)).status).toBe(404)
    expect((await upload('p4', 'round=r1&item=nope', png)).status).toBe(400)
    expect((await fetch(`${t.base}/api/photos/missing`)).status).toBe(404)
  })
})
