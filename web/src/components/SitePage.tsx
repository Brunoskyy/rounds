import { useCallback } from 'react'

import { emptyRound, roundProgress } from '@rounds/shared'

import { useRepo, useServices } from '../app-context.ts'
import { newId } from '../lib/ids.ts'
import { navigate } from '../lib/router.ts'
import { Link } from './Link.tsx'

export function SitePage({ id }: { id: string }) {
  const { sites, checklists, rounds, technician } = useRepo()
  const { repo } = useServices()
  const site = sites.find((s) => s.id === id)
  const lists = checklists.filter((c) => c.siteId === id)
  const history = rounds.filter((r) => r.siteId === id).sort((a, b) => b.startedAt - a.startedAt)

  const start = useCallback(
    async (checklistId: string) => {
      const checklist = lists.find((c) => c.id === checklistId)
      if (!checklist) return
      const round = emptyRound(newId(), checklist, technician || 'unknown', Date.now())
      await repo.saveRound(round)
      navigate(`/rounds/${round.id}`)
    },
    [lists, technician, repo],
  )

  if (!site) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <p>
          This site is not on the device.{' '}
          <Link href="/" className="underline">
            Back
          </Link>
        </p>
      </main>
    )
  }
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/" className="text-muted text-sm">
        ← Sites
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{site.name}</h1>
      <p className="text-muted text-sm">{site.address}</p>

      <h2 className="text-muted mt-8 mb-2 text-xs font-semibold tracking-wider uppercase">
        Start a round
      </h2>
      <ul className="space-y-2">
        {lists.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => void start(c.id)}
              className="bg-panel border-line hover:border-accent flex w-full items-center justify-between rounded-xl border p-4 text-left"
            >
              <span>
                <span className="font-medium">{c.name}</span>
                <span className="text-muted block text-sm">{c.items.length} items</span>
              </span>
              <span className="text-accent text-sm font-medium">Start</span>
            </button>
          </li>
        ))}
      </ul>

      {history.length > 0 && (
        <>
          <h2 className="text-muted mt-8 mb-2 text-xs font-semibold tracking-wider uppercase">
            Recent rounds
          </h2>
          <ul className="space-y-2">
            {history.slice(0, 20).map((r) => {
              const p = roundProgress(r)
              return (
                <li key={r.id}>
                  <Link
                    href={`/rounds/${r.id}`}
                    className="bg-panel border-line flex items-center justify-between rounded-xl border p-3 text-sm"
                  >
                    <span>
                      <span className="font-medium">
                        {lists.find((c) => c.id === r.checklistId)?.name ?? 'Round'}
                      </span>
                      <span className="text-muted block text-xs">
                        {new Date(r.startedAt).toLocaleString()} · {r.technician}
                      </span>
                    </span>
                    <span className={r.finishedAt ? 'text-ok' : 'text-accent'}>
                      {r.finishedAt
                        ? p.issues
                          ? `${p.issues} issue${p.issues === 1 ? '' : 's'}`
                          : 'Done'
                        : `${p.done}/${p.total}`}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </main>
  )
}
