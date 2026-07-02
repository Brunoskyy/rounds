import { describe, expect, it } from 'vitest'

import { InvalidInput, parseRound } from '../src/validate.ts'

const good = {
  id: 'r1',
  siteId: 's1',
  checklistId: 'c1',
  technician: 'Ana',
  startedAt: 1,
  finishedAt: null,
  version: 3,
  updatedAt: 2,
  items: {
    i1: { status: 'ok', reading: 2.5, note: '', updatedAt: 2 },
    i2: { status: 'pending', note: 'x' },
  },
}

describe('parseRound', () => {
  it('accepts a well-formed round and fills defaults', () => {
    const r = parseRound(good)
    expect(r.version).toBe(3)
    expect(r.items.i1).toMatchObject({ itemId: 'i1', status: 'ok', reading: 2.5 })
    expect(r.items.i2?.itemId).toBe('i2')
    expect(typeof r.items.i2?.updatedAt).toBe('number')
  })

  it('rejects what a client should never send', () => {
    const bad = (patch: Record<string, unknown>) =>
      expect(() => parseRound({ ...good, ...patch })).toThrow(InvalidInput)
    bad({ id: '../x' })
    bad({ items: { constructor: { status: 'ok', note: '' } } })
    bad({ items: { i1: { status: 'done', note: '' } } })
    bad({ items: { i1: { status: 'ok', note: 'x'.repeat(1001) } } })
    bad({ items: { i1: { status: 'ok', note: '', reading: 'hot' } } })
    bad({ technician: 42 })
    bad({ startedAt: 'yesterday' })
  })

  it('drops unknown fields', () => {
    const r = parseRound({
      ...good,
      admin: true,
      items: { i1: { status: 'ok', note: '', extra: 1 } },
    })
    expect('admin' in r).toBe(false)
    expect('extra' in r.items.i1!).toBe(false)
  })
})
