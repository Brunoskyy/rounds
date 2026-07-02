import type { Id, ItemStatus, Round, RoundItem } from './types.ts'

export class InvalidInput extends Error {}

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/
const RESERVED = new Set(Object.getOwnPropertyNames(Object.prototype))
const STATUSES: readonly ItemStatus[] = ['pending', 'ok', 'issue', 'skipped']

export const LIMITS = { note: 1000, technician: 60, itemsPerRound: 500 } as const

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

export function parseId(v: unknown, what = 'id'): Id {
  if (typeof v !== 'string' || !ID_RE.test(v) || RESERVED.has(v))
    throw new InvalidInput(`${what} is not a valid id`)
  return v
}

function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v))
    throw new InvalidInput(`${what} must be a finite number`)
  return v
}

function text(v: unknown, what: string, max: number): string {
  if (typeof v !== 'string') throw new InvalidInput(`${what} must be a string`)
  if (v.length > max) throw new InvalidInput(`${what} is longer than ${max} characters`)
  return v
}

export function parseRoundItem(v: unknown, itemId: Id): RoundItem {
  if (!isRecord(v)) throw new InvalidInput('item must be an object')
  if (typeof v.status !== 'string' || !(STATUSES as readonly string[]).includes(v.status)) {
    throw new InvalidInput(`item ${itemId} has an unknown status`)
  }
  const item: RoundItem = {
    itemId,
    status: v.status as ItemStatus,
    note: text(v.note ?? '', 'note', LIMITS.note),
    updatedAt: num(v.updatedAt ?? Date.now(), 'updatedAt'),
  }
  if (v.reading !== undefined && v.reading !== null) item.reading = num(v.reading, 'reading')
  if (v.photoId !== undefined && v.photoId !== null) item.photoId = parseId(v.photoId, 'photoId')
  return item
}

/** Full round from untrusted JSON. `version` is taken as the client's base version. */
export function parseRound(v: unknown): Round {
  if (!isRecord(v)) throw new InvalidInput('round must be an object')
  if (!isRecord(v.items)) throw new InvalidInput('round.items must be an object')
  const entries = Object.entries(v.items)
  if (entries.length > LIMITS.itemsPerRound) throw new InvalidInput('too many items')
  const items: Round['items'] = {}
  for (const [key, value] of entries) {
    const id = parseId(key, 'item id')
    items[id] = parseRoundItem(value, id)
  }
  const finishedAt =
    v.finishedAt === null || v.finishedAt === undefined ? null : num(v.finishedAt, 'finishedAt')
  return {
    id: parseId(v.id, 'round id'),
    siteId: parseId(v.siteId, 'site id'),
    checklistId: parseId(v.checklistId, 'checklist id'),
    technician: text(v.technician, 'technician', LIMITS.technician).trim() || 'unknown',
    startedAt: num(v.startedAt, 'startedAt'),
    finishedAt,
    items,
    version: Number.isInteger(v.version) ? (v.version as number) : 0,
    updatedAt: num(v.updatedAt ?? Date.now(), 'updatedAt'),
  }
}
