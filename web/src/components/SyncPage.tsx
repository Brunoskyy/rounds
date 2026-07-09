import { useState } from 'react'

import { resolveConflicts, type ItemConflict, type RoundItem } from '@rounds/shared'

import { useRepo, useServices, useSyncStatus } from '../app-context.ts'
import { Link } from './Link.tsx'

export function SyncPage() {
  const status = useSyncStatus()
  const { outbox, conflicts, lastSync, checklists } = useRepo()
  const { engine, repo } = useServices()

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/" className="text-muted text-sm">
        ← Home
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Sync</h1>
      <p className="text-muted mt-1 text-sm">
        {status.online
          ? 'Connected.'
          : 'No connection. Everything you do is saved on this device and sent later.'}{' '}
        {lastSync ? `Last synced ${new Date(lastSync).toLocaleString()}.` : 'Never synced.'}
      </p>
      {status.lastError && <p className="text-issue mt-2 text-sm">{status.lastError}</p>}
      <button
        type="button"
        onClick={() => void engine.sync()}
        disabled={status.syncing || !status.online}
        className="border-line mt-3 rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
      >
        {status.syncing ? 'Syncing…' : 'Sync now'}
      </button>

      {conflicts.length > 0 && (
        <section className="mt-8" aria-labelledby="conflicts">
          <h2 id="conflicts" className="text-lg font-semibold">
            Needs your decision
          </h2>
          <p className="text-muted text-sm">
            Someone else changed these items while your edits were waiting. Pick the version that
            matches what you saw.
          </p>
          <ul className="mt-3 space-y-4">
            {conflicts.map((c) => (
              <li key={c.roundId}>
                <ConflictCard
                  roundId={c.roundId}
                  title={checklists.find((l) => l.id === c.merged.checklistId)?.name ?? 'Round'}
                  items={c.conflicts}
                  labels={Object.fromEntries(
                    (checklists.find((l) => l.id === c.merged.checklistId)?.items ?? []).map(
                      (i) => [i.id, i.label],
                    ),
                  )}
                  onResolve={(choices) => {
                    void repo
                      .resolveConflict(c.roundId, resolveConflicts(c.merged, c.conflicts, choices))
                      .then(() => void engine.sync())
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8" aria-labelledby="queue">
        <h2 id="queue" className="text-lg font-semibold">
          Waiting to send
        </h2>
        {outbox.length === 0 ? (
          <p className="text-muted text-sm">
            Nothing. Every change on this device is on the server.
          </p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {outbox.map((e) => (
              <li
                key={e.roundId}
                className="bg-panel border-line flex items-center justify-between rounded-lg border p-3"
              >
                <Link href={`/rounds/${e.roundId}`} className="underline">
                  Round {e.roundId.slice(0, 6)}
                </Link>
                <span className="text-muted">
                  {e.blocked
                    ? 'waiting for your decision'
                    : e.attempts
                      ? `tried ${e.attempts}×`
                      : 'queued'}
                  {e.lastError && !e.blocked ? ` · ${e.lastError}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function describe(item: RoundItem): string {
  const parts: string[] = [item.status]
  if (item.reading !== undefined) parts.push(`${item.reading}`)
  if (item.note) parts.push(`“${item.note}”`)
  if (item.photoId) parts.push('photo')
  return parts.join(' · ')
}

export function ConflictCard({
  roundId,
  title,
  items,
  labels,
  onResolve,
}: {
  roundId: string
  title: string
  items: ItemConflict[]
  labels: Record<string, string>
  onResolve: (choices: Record<string, 'mine' | 'theirs'>) => void
}) {
  const [choices, setChoices] = useState<Record<string, 'mine' | 'theirs'>>({})
  const complete = items.every((i) => choices[i.itemId])
  return (
    <div className="bg-panel border-line rounded-xl border p-4">
      <p className="font-medium">
        {title} <span className="text-muted font-normal">· {roundId.slice(0, 6)}</span>
      </p>
      <ul className="mt-3 space-y-3">
        {items.map((c) => (
          <li key={c.itemId}>
            <p className="text-sm font-medium">{labels[c.itemId] ?? c.itemId}</p>
            <div
              role="radiogroup"
              aria-label={`${labels[c.itemId] ?? c.itemId}: which version`}
              className="mt-1 grid gap-2 sm:grid-cols-2"
            >
              {(['mine', 'theirs'] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  role="radio"
                  aria-checked={choices[c.itemId] === side}
                  onClick={() => setChoices({ ...choices, [c.itemId]: side })}
                  className={`rounded-lg border p-3 text-left text-sm ${
                    choices[c.itemId] === side ? 'border-accent bg-accent-soft' : 'border-line'
                  }`}
                >
                  <span className="text-muted block text-xs uppercase">
                    {side === 'mine' ? 'This device' : 'Server'}
                  </span>
                  {describe(side === 'mine' ? c.mine : c.theirs)}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={!complete}
        onClick={() => onResolve(choices)}
        className="bg-accent mt-4 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        Keep these and send
      </button>
    </div>
  )
}
