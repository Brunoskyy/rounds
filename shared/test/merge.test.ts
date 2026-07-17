import { describe, expect, it } from 'vitest'

import { mergeRound, resolveConflicts } from '../src/merge.ts'
import { emptyRound, type Checklist, type Round } from '../src/types.ts'

const checklist: Checklist = {
  id: 'c1',
  siteId: 's1',
  name: 'Boiler room',
  updatedAt: 0,
  items: [
    { id: 'i1', label: 'Pressure', kind: 'reading', unit: 'bar', range: { min: 1, max: 3 } },
    { id: 'i2', label: 'Leaks', kind: 'check' },
    { id: 'i3', label: 'Panel photo', kind: 'photo' },
  ],
}

const base = (): Round => emptyRound('r1', checklist, 'Ana', 1000)
const withItem = (r: Round, id: string, patch: Partial<Round['items'][string]>): Round => ({
  ...r,
  items: { ...r.items, [id]: { ...r.items[id]!, ...patch } },
})

describe('mergeRound', () => {
  it('takes each side’s untouched-by-the-other changes', () => {
    const b = base()
    const mine = withItem(b, 'i1', { status: 'ok', reading: 2.1, updatedAt: 2000 })
    const theirs = {
      ...withItem(b, 'i2', { status: 'issue', note: 'drip under valve', updatedAt: 1500 }),
      version: 1,
    }
    const { merged, conflicts } = mergeRound(b, mine, theirs)
    expect(conflicts).toEqual([])
    expect(merged.items.i1).toMatchObject({ status: 'ok', reading: 2.1 })
    expect(merged.items.i2).toMatchObject({ status: 'issue', note: 'drip under valve' })
    expect(merged.items.i3?.status).toBe('pending')
    expect(merged.version).toBe(1)
  })

  it('lists an item both sides changed differently, defaulting to theirs', () => {
    const b = base()
    const mine = withItem(b, 'i2', { status: 'ok', updatedAt: 2000 })
    const theirs = withItem(b, 'i2', { status: 'issue', note: 'rust', updatedAt: 2100 })
    const { merged, conflicts } = mergeRound(b, mine, theirs)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.itemId).toBe('i2')
    expect(merged.items.i2?.status).toBe('issue')
    const resolved = resolveConflicts(merged, conflicts, { i2: 'mine' })
    expect(resolved.items.i2?.status).toBe('ok')
  })

  it('is not a conflict when both sides made the same change', () => {
    const b = base()
    const mine = withItem(b, 'i2', { status: 'ok', updatedAt: 2000 })
    const theirs = withItem(b, 'i2', { status: 'ok', updatedAt: 2500 })
    expect(mergeRound(b, mine, theirs).conflicts).toEqual([])
  })

  it('keeps a sign-off only when the other side changed nothing', () => {
    const b = base()
    const mine = { ...b, finishedAt: 5000 }
    expect(mergeRound(b, mine, b)).toMatchObject({
      merged: { finishedAt: 5000 },
      signOffDropped: false,
    })
    expect(mergeRound(b, b, { ...b, finishedAt: 6000 }).merged.finishedAt).toBe(6000)

    // They changed an item while I signed off: the sign-off goes, the item stays.
    const theirs = withItem(b, 'i1', { status: 'issue', note: 'noise', updatedAt: 4000 })
    const r = mergeRound(b, mine, theirs)
    expect(r.signOffDropped).toBe(true)
    expect(r.merged.finishedAt).toBeNull()
    expect(r.merged.items.i1?.status).toBe('issue')
    // And the mirror image.
    expect(
      mergeRound(b, withItem(b, 'i2', { status: 'ok' }), { ...b, finishedAt: 7000 }).merged
        .finishedAt,
    ).toBeNull()
  })
})
