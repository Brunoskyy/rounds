import { useEffect, useRef, useState } from 'react'

import type { ChecklistItem, ItemStatus, RoundItem } from '@rounds/shared'

import type { StoredPhoto } from '../data/db.ts'
import { outOfRange } from '../lib/readings.ts'

interface Props {
  def: ChecklistItem
  item: RoundItem
  readOnly: boolean
  onPatch: (patch: Partial<RoundItem>) => void
  onPhoto: (file: File) => void
  getPhoto: (id: string) => Promise<StoredPhoto | undefined>
}

const STATUS: Array<{ value: ItemStatus; label: string; tone: string }> = [
  { value: 'ok', label: 'OK', tone: 'bg-ok-soft text-ok' },
  { value: 'issue', label: 'Issue', tone: 'bg-issue-soft text-issue' },
  { value: 'skipped', label: 'Skip', tone: 'bg-skip-soft text-skip' },
]

/**
 * One line of the checklist, sized for a thumb: three big status buttons,
 * a number field for readings that flags values outside the expected
 * range, a note, and a photo that is stored on the device until there is
 * signal.
 */
export function ItemRow({ def, item, readOnly, onPatch, onPhoto, getPhoto }: Props) {
  // Drafts for the two typed fields. When the item changes underneath (a
  // sync brought a new value), the draft follows; while typing, it leads.
  // A field being typed into keeps its draft even if a pull changes the
  // item underneath; the draft is reconciled on blur.
  const [editing, setEditing] = useState<'note' | 'reading' | null>(null)
  const [note, setNote] = useState(item.note)
  const [seenNote, setSeenNote] = useState(item.note)
  if (item.note !== seenNote) {
    setSeenNote(item.note)
    if (editing !== 'note') setNote(item.note)
  }
  const readingText = item.reading === undefined ? '' : String(item.reading)
  const [reading, setReading] = useState(readingText)
  const [seenReading, setSeenReading] = useState(readingText)
  if (readingText !== seenReading) {
    setSeenReading(readingText)
    if (editing !== 'reading') setReading(readingText)
  }
  const flagged = outOfRange(def, item.reading)

  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null)
  useEffect(() => {
    const photoId = item.photoId
    if (!photoId) return
    let url: string | null = null
    let active = true
    void getPhoto(photoId).then((p) => {
      if (!active) return
      url = p ? URL.createObjectURL(p.blob) : `/api/photos/${photoId}`
      setPhoto({ id: photoId, url })
    })
    return () => {
      active = false
      if (url && url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }, [item.photoId, getPhoto])
  const photoUrl = item.photoId && photo?.id === item.photoId ? photo.url : null
  const fileInput = useRef<HTMLInputElement>(null)

  const commitReading = () => {
    const n = reading.trim() === '' ? undefined : Number(reading)
    if (n !== undefined && !Number.isFinite(n)) return
    if (n === item.reading) return
    const patch: Partial<RoundItem> =
      n === undefined ? { reading: undefined as unknown as number } : { reading: n }
    // A reading outside the range is an issue until someone says otherwise.
    if (n !== undefined && item.status === 'pending')
      patch.status = outOfRange(def, n) ? 'issue' : 'ok'
    onPatch(patch)
  }

  return (
    <div className={`bg-panel border-line rounded-xl border p-4 ${flagged ? 'border-issue' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{def.label}</p>
        {flagged && (
          <span className="text-issue text-xs font-medium whitespace-nowrap">
            outside {def.range?.min}–{def.range?.max} {def.unit}
          </span>
        )}
      </div>

      {def.kind === 'reading' && (
        <div className="mt-3 block">
          <span className="flex items-center gap-2">
            <input
              type="number"
              aria-label={`${def.label} reading`}
              inputMode="decimal"
              step="any"
              className="border-line bg-paper w-32 rounded-lg border px-3 py-2 text-lg"
              value={reading}
              disabled={readOnly}
              onChange={(e) => setReading(e.target.value)}
              onFocus={() => setEditing('reading')}
              onBlur={() => {
                setEditing(null)
                commitReading()
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              aria-describedby={def.range ? `${def.id}-range` : undefined}
            />
            {def.unit && <span className="text-muted">{def.unit}</span>}
            {def.range && (
              <span id={`${def.id}-range`} className="text-muted text-xs">
                expected {def.range.min}–{def.range.max}
              </span>
            )}
          </span>
        </div>
      )}

      <div role="group" aria-label={`${def.label} status`} className="mt-3 grid grid-cols-3 gap-2">
        {STATUS.map((s) => (
          <button
            key={s.value}
            type="button"
            disabled={readOnly}
            aria-pressed={item.status === s.value}
            onClick={() => onPatch({ status: item.status === s.value ? 'pending' : s.value })}
            className={`rounded-lg border py-3 text-sm font-medium disabled:opacity-60 ${
              item.status === s.value
                ? `${s.tone} border-current`
                : 'border-line text-muted hover:text-ink'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {(def.kind === 'photo' || item.photoId) && (
        <div className="mt-3 flex items-center gap-3">
          {photoUrl && (
            <img
              src={photoUrl}
              alt={`Photo for ${def.label}`}
              className="border-line h-16 w-16 rounded-lg border object-cover"
            />
          )}
          {!readOnly && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                aria-label={`${def.label} photo`}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onPhoto(f)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="border-line rounded-lg border px-3 py-2 text-sm"
              >
                {item.photoId ? 'Retake' : 'Take photo'}
              </button>
            </>
          )}
        </div>
      )}

      <label className="mt-3 block">
        <span className="sr-only">{def.label} note</span>
        <textarea
          className="border-line bg-paper w-full resize-none rounded-lg border px-3 py-2 text-sm"
          rows={1}
          placeholder={item.status === 'issue' ? 'What did you see?' : 'Note (optional)'}
          value={note}
          disabled={readOnly}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
          onFocus={() => setEditing('note')}
          onBlur={() => {
            setEditing(null)
            if (note !== item.note) onPatch({ note })
          }}
        />
      </label>
    </div>
  )
}
