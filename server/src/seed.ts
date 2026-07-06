import type { Checklist, Site } from '@rounds/shared'

import type { Store } from './store.ts'

/** Two sites and their checklists, enough to walk a round on a phone. */
export function seed(store: Store, now = Date.now()): void {
  if (store.count('sites') > 0) return
  const sites: Site[] = [
    { id: 'site-harbor', name: 'Harbor Street plant', address: '120 Harbor St', updatedAt: now },
    { id: 'site-north', name: 'North depot', address: '8 Rail Yard Rd', updatedAt: now },
  ]
  const checklists: Checklist[] = [
    {
      id: 'chk-boiler',
      siteId: 'site-harbor',
      name: 'Boiler room, daily',
      updatedAt: now,
      items: [
        {
          id: 'pressure',
          label: 'Steam pressure',
          kind: 'reading',
          unit: 'bar',
          range: { min: 4, max: 7 },
        },
        {
          id: 'feedwater',
          label: 'Feedwater temperature',
          kind: 'reading',
          unit: '°C',
          range: { min: 60, max: 90 },
        },
        { id: 'leaks', label: 'No visible leaks on pump seals', kind: 'check' },
        { id: 'gauge-photo', label: 'Photo of the main gauge', kind: 'photo' },
        { id: 'alarms', label: 'Alarm panel clear', kind: 'check' },
      ],
    },
    {
      id: 'chk-roof',
      siteId: 'site-harbor',
      name: 'Rooftop units, weekly',
      updatedAt: now,
      items: [
        { id: 'filters', label: 'Filters clean', kind: 'check' },
        { id: 'belts', label: 'Belts tensioned, no cracks', kind: 'check' },
        { id: 'drain', label: 'Condensate drain clear', kind: 'check' },
        { id: 'unit-photo', label: 'Photo of unit nameplate', kind: 'photo' },
      ],
    },
    {
      id: 'chk-depot',
      siteId: 'site-north',
      name: 'Depot walk-through',
      updatedAt: now,
      items: [
        { id: 'doors', label: 'Roller doors open and close', kind: 'check' },
        { id: 'lighting', label: 'Yard lighting working', kind: 'check' },
        {
          id: 'fuel',
          label: 'Fuel tank level',
          kind: 'reading',
          unit: '%',
          range: { min: 20, max: 100 },
        },
        { id: 'extinguishers', label: 'Extinguishers in date', kind: 'check' },
      ],
    },
  ]
  for (const s of sites) store.upsertSite(s)
  for (const c of checklists) store.upsertChecklist(c)
}
