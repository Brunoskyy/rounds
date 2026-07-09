import { useRepo, useSyncStatus } from '../app-context.ts'
import { navigate } from '../lib/router.ts'

export function Header() {
  const status = useSyncStatus()
  const { outbox, conflicts } = useRepo()
  const pending = outbox.length
  const label = !status.online
    ? pending
      ? `Offline · ${pending} to send`
      : 'Offline'
    : status.syncing
      ? 'Syncing…'
      : conflicts.length
        ? `${conflicts.length} to resolve`
        : pending
          ? `${pending} to send`
          : 'Up to date'
  const tone = !status.online
    ? 'bg-skip'
    : conflicts.length
      ? 'bg-issue'
      : pending || status.syncing
        ? 'bg-accent'
        : 'bg-ok'

  return (
    <header className="border-line bg-panel sticky top-0 z-20 flex items-center gap-3 border-b px-4 py-3">
      <a
        href="/"
        onClick={(e) => {
          e.preventDefault()
          navigate('/')
        }}
        className="font-semibold tracking-tight"
      >
        Rounds
      </a>
      <a
        href="/sync"
        onClick={(e) => {
          e.preventDefault()
          navigate('/sync')
        }}
        className="text-muted hover:text-ink ml-auto flex items-center gap-2 text-sm"
        aria-label={`Sync status: ${label}`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${tone}`} aria-hidden="true" />
        <span role="status">{label}</span>
      </a>
    </header>
  )
}
