import { useState, type FormEvent } from 'react'

import { roundProgress } from '@rounds/shared'

import { useRepo, useServices } from '../app-context.ts'
import { navigate } from '../lib/router.ts'
import { Link } from './Link.tsx'

export function Home() {
  const { sites, rounds, checklists, technician, loaded, lastSync } = useRepo()
  const { repo } = useServices()
  const [name, setName] = useState('')

  if (!technician) {
    const submit = (e: FormEvent) => {
      e.preventDefault()
      const trimmed = name.trim().slice(0, 60)
      if (trimmed) void repo.setTechnician(trimmed)
    }
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Who's walking today?</h1>
        <p className="text-muted mt-1 text-sm">Your name goes on every round you sign off.</p>
        <form onSubmit={submit} className="mt-6">
          <label htmlFor="tech" className="block text-sm font-medium">
            Name
          </label>
          <input
            id="tech"
            className="border-line bg-panel mt-1.5 w-full rounded-lg border px-3 py-3 text-lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
          <button
            type="submit"
            className="bg-accent mt-4 w-full rounded-lg px-4 py-3 text-lg font-medium text-white"
          >
            Continue
          </button>
        </form>
      </main>
    )
  }

  const open = rounds.filter((r) => r.finishedAt === null).sort((a, b) => b.startedAt - a.startedAt)

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      {open.length > 0 && (
        <section aria-labelledby="open" className="mb-8">
          <h2 id="open" className="text-muted mb-2 text-xs font-semibold tracking-wider uppercase">
            In progress
          </h2>
          <ul className="space-y-2">
            {open.map((r) => {
              const p = roundProgress(r)
              const checklist = checklists.find((c) => c.id === r.checklistId)
              return (
                <li key={r.id}>
                  <Link
                    href={`/rounds/${r.id}`}
                    className="bg-panel border-line block rounded-xl border p-4"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{checklist?.name ?? 'Round'}</span>
                      <span className="text-muted text-sm">
                        {p.done}/{p.total}
                      </span>
                    </div>
                    <div className="bg-line mt-3 h-1.5 overflow-hidden rounded-full">
                      <div
                        className="bg-accent h-full"
                        style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }}
                      />
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="sites">
        <h2 id="sites" className="text-muted mb-2 text-xs font-semibold tracking-wider uppercase">
          Sites
        </h2>
        {sites.length === 0 ? (
          <p className="text-muted text-sm">
            {loaded && lastSync === 0
              ? 'No sites yet. Connect once to fetch them; after that, everything works offline.'
              : 'No sites.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {sites.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sites/${s.id}`}
                  className="bg-panel border-line block rounded-xl border p-4"
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="text-muted block text-sm">{s.address}</span>
                  <span className="text-muted block text-xs">
                    {checklists.filter((c) => c.siteId === s.id).length} checklists
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-muted mt-10 text-xs">
        Signed in as {technician}.{' '}
        <button type="button" className="underline" onClick={() => void repo.setTechnician('')}>
          Change
        </button>
        {' · '}
        <button type="button" className="underline" onClick={() => navigate('/sync')}>
          Sync details
        </button>
      </p>
    </main>
  )
}
