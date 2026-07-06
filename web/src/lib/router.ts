import { useSyncExternalStore } from 'react'

/**
 * Four routes do not justify a router.
 */
export type Route =
  { name: 'home' } | { name: 'site'; id: string } | { name: 'round'; id: string } | { name: 'sync' }

function parse(pathname: string): Route {
  if (pathname === '/sync') return { name: 'sync' }
  const site = /^\/sites\/([A-Za-z0-9_-]+)\/?$/.exec(pathname)
  if (site?.[1]) return { name: 'site', id: site[1] }
  const round = /^\/rounds\/([A-Za-z0-9_-]+)\/?$/.exec(pathname)
  if (round?.[1]) return { name: 'round', id: round[1] }
  return { name: 'home' }
}

const listeners = new Set<() => void>()
function emit() {
  for (const l of listeners) l()
}
if (typeof window !== 'undefined') window.addEventListener('popstate', emit)

export function navigate(path: string): void {
  history.pushState(null, '', path)
  emit()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(
    subscribe,
    () => location.pathname,
    () => '/',
  )
  return parse(pathname)
}
