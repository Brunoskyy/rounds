import { useCallback } from 'react'

import { roundProgress, type Round, type RoundItem } from '@rounds/shared'

import { useRepo, useServices } from '../app-context.ts'
import { newId } from '../lib/ids.ts'
import { ItemRow } from './ItemRow.tsx'
import { Link } from './Link.tsx'

export function RoundPage({ id }: { id: string }) {
  const { rounds, checklists, sites, conflicts } = useRepo()
  const { repo, engine } = useServices()
  const round = rounds.find((r) => r.id === id)
  const checklist = round ? checklists.find((c) => c.id === round.checklistId) : undefined
  const site = round ? sites.find((s) => s.id === round.siteId) : undefined
  const conflict = conflicts.find((c) => c.roundId === id)

  const update = useCallback(
    (next: Round) => {
      void repo.saveRound({ ...next, updatedAt: Date.now() }).then(() => void engine.sync())
    },
    [repo, engine],
  )

  const setItem = useCallback(
    (item: RoundItem) => {
      if (!round) return
      update({
        ...round,
        items: { ...round.items, [item.itemId]: { ...item, updatedAt: Date.now() } },
      })
    },
    [round, update],
  )

  if (!round || !checklist) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <p>
          This round is not on the device.{' '}
          <Link href="/" className="underline">
            Back
          </Link>
        </p>
      </main>
    )
  }

  const attachPhoto = async (itemId: string, file: File) => {
    const photoId = newId()
    await repo.addPhoto({
      id: photoId,
      roundId: round.id,
      itemId,
      mime: file.type,
      blob: file,
      uploaded: false,
    })
    const current = round.items[itemId]
    if (current)
      setItem({ ...current, photoId, status: current.status === 'pending' ? 'ok' : current.status })
  }

  const progress = roundProgress(round)
  const finished = round.finishedAt !== null
  const canFinish = progress.done === progress.total && !finished

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 pb-32">
      <Link href={`/sites/${round.siteId}`} className="text-muted text-sm">
        ← {site?.name ?? 'Site'}
      </Link>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{checklist.name}</h1>
        <span className="text-muted text-sm whitespace-nowrap" aria-live="polite">
          {progress.done} of {progress.total}
        </span>
      </div>
      <p className="text-muted text-sm">
        {round.technician} · started{' '}
        {new Date(round.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        {finished && ' · signed off'}
      </p>

      {conflict && (
        <p className="bg-issue-soft text-issue mt-4 rounded-lg p-3 text-sm">
          Someone else changed this round while you were offline.{' '}
          <Link href="/sync" className="font-medium underline">
            Resolve {conflict.conflicts.length} item{conflict.conflicts.length === 1 ? '' : 's'}
          </Link>
        </p>
      )}

      <ol className="mt-6 space-y-3">
        {checklist.items.map((def) => {
          const item = round.items[def.id] ?? {
            itemId: def.id,
            status: 'pending' as const,
            note: '',
            updatedAt: 0,
          }
          return (
            <li key={def.id}>
              <ItemRow
                def={def}
                item={item}
                readOnly={finished}
                onChange={setItem}
                onPhoto={(file) => void attachPhoto(def.id, file)}
                getPhoto={(photoId) => repo.getPhoto(photoId)}
              />
            </li>
          )
        })}
      </ol>

      <div className="bg-panel/95 border-line fixed inset-x-0 bottom-0 border-t p-4 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <span className="text-muted text-sm">
            {progress.issues
              ? `${progress.issues} issue${progress.issues === 1 ? '' : 's'} flagged`
              : 'No issues so far'}
          </span>
          {finished ? (
            <button
              type="button"
              className="border-line ml-auto rounded-lg border px-4 py-2.5 text-sm"
              onClick={() => update({ ...round, finishedAt: null })}
            >
              Reopen
            </button>
          ) : (
            <button
              type="button"
              disabled={!canFinish}
              className="bg-accent ml-auto rounded-lg px-5 py-2.5 font-medium text-white disabled:opacity-40"
              onClick={() => update({ ...round, finishedAt: Date.now() })}
              title={canFinish ? 'Sign off this round' : 'Every item needs a status first'}
            >
              Sign off
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
