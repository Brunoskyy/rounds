import type { ChecklistItem } from '@rounds/shared'

/** A reading outside the checklist's expected range is flagged, never silently accepted. */
export function outOfRange(def: ChecklistItem, reading: number | undefined): boolean {
  if (reading === undefined || !def.range) return false
  return reading < def.range.min || reading > def.range.max
}
