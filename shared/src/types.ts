export type Id = string

export interface Site {
  id: Id
  name: string
  address: string
  updatedAt: number
}

export type ItemKind = 'check' | 'reading' | 'photo'

export interface ChecklistItem {
  id: Id
  label: string
  kind: ItemKind
  /** For readings: the unit shown next to the number, e.g. "°C" or "bar". */
  unit?: string
  /** For readings: outside this range the item is flagged. */
  range?: { min: number; max: number }
}

export interface Checklist {
  id: Id
  siteId: Id
  name: string
  items: ChecklistItem[]
  updatedAt: number
}

export type ItemStatus = 'pending' | 'ok' | 'issue' | 'skipped'

export interface RoundItem {
  itemId: Id
  status: ItemStatus
  reading?: number
  note: string
  /** Id of a photo stored locally and uploaded when online. */
  photoId?: string
  updatedAt: number
}

/**
 * One walk through a checklist. `version` is the server's counter: every
 * accepted write bumps it, and a write that names an older version is a
 * conflict the client has to resolve, not something the server guesses at.
 */
export interface Round {
  id: Id
  siteId: Id
  checklistId: Id
  technician: string
  startedAt: number
  finishedAt: number | null
  items: Record<Id, RoundItem>
  version: number
  updatedAt: number
}

export interface Photo {
  id: Id
  roundId: Id
  itemId: Id
  mime: string
  bytes: number
}

export function emptyRound(id: Id, checklist: Checklist, technician: string, at: number): Round {
  const items: Round['items'] = {}
  for (const item of checklist.items) {
    items[item.id] = { itemId: item.id, status: 'pending', note: '', updatedAt: at }
  }
  return {
    id,
    siteId: checklist.siteId,
    checklistId: checklist.id,
    technician,
    startedAt: at,
    finishedAt: null,
    items,
    version: 0,
    updatedAt: at,
  }
}

export function roundProgress(round: Round): { done: number; total: number; issues: number } {
  const items = Object.values(round.items)
  return {
    done: items.filter((i) => i.status !== 'pending').length,
    total: items.length,
    issues: items.filter((i) => i.status === 'issue').length,
  }
}
