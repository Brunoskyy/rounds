import type { Id, Round, RoundItem } from './types.ts'

/**
 * Three-way merge of a round: `base` is the last copy both sides agreed on,
 * `mine` is what this device has, `theirs` is what the server has now.
 *
 * Items only one side touched are taken from that side. Items both sides
 * touched are conflicts: the merge does not pick a winner, it lists them
 * and lets the person choose. Anything else on a maintenance round is too
 * consequential to resolve with a timestamp.
 */
export interface ItemConflict {
  itemId: Id
  mine: RoundItem
  theirs: RoundItem
}

export interface MergeResult {
  merged: Round
  conflicts: ItemConflict[]
  /**
   * True when one side signed the round off while the other side was still
   * changing items. The sign-off is dropped: whoever signed did not see those
   * changes, and a signed-off round with an unreviewed item is worse than one
   * that asks to be signed again.
   */
  signOffDropped: boolean
}

const sameItem = (a: RoundItem | undefined, b: RoundItem | undefined): boolean =>
  a?.status === b?.status &&
  a?.reading === b?.reading &&
  a?.note === b?.note &&
  a?.photoId === b?.photoId

export function mergeRound(base: Round, mine: Round, theirs: Round): MergeResult {
  const items: Round['items'] = {}
  const conflicts: ItemConflict[] = []
  const ids = new Set([
    ...Object.keys(base.items),
    ...Object.keys(mine.items),
    ...Object.keys(theirs.items),
  ])

  for (const id of ids) {
    const b = base.items[id]
    const m = mine.items[id]
    const t = theirs.items[id]
    const mineChanged = !sameItem(b, m)
    const theirsChanged = !sameItem(b, t)
    if (mineChanged && theirsChanged && !sameItem(m, t) && m && t) {
      conflicts.push({ itemId: id, mine: m, theirs: t })
      items[id] = t
    } else if (mineChanged && m) {
      items[id] = m
    } else if (t) {
      items[id] = t
    } else if (m) {
      items[id] = m
    }
  }

  const mineSigned = mine.finishedAt !== base.finishedAt && mine.finishedAt !== null
  const theirsSigned = theirs.finishedAt !== base.finishedAt && theirs.finishedAt !== null
  const touched = (side: Round) =>
    Object.keys(side.items).some((id) => !sameItem(base.items[id], side.items[id]))
  const signOffDropped = (mineSigned && touched(theirs)) || (theirsSigned && touched(mine))
  const finishedAt = signOffDropped
    ? null
    : mine.finishedAt !== base.finishedAt
      ? mine.finishedAt
      : theirs.finishedAt

  return {
    merged: { ...theirs, items, finishedAt, updatedAt: Math.max(mine.updatedAt, theirs.updatedAt) },
    conflicts,
    signOffDropped,
  }
}

/** Applies the person's choices on top of a merge result. */
export function resolveConflicts(
  merged: Round,
  conflicts: readonly ItemConflict[],
  choices: Record<Id, 'mine' | 'theirs'>,
): Round {
  const items = { ...merged.items }
  for (const c of conflicts) {
    const pick = choices[c.itemId]
    if (pick === 'mine') items[c.itemId] = c.mine
    else if (pick === 'theirs') items[c.itemId] = c.theirs
  }
  return { ...merged, items }
}
