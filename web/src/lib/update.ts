import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'

/**
 * A new version of the app is never applied on its own: the default
 * behaviour reloads the page when the new worker activates, which would
 * throw away a half-typed note. Instead the person gets a banner.
 */
let apply: (() => void) | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

export function startUpdates(): void {
  const update = registerSW({
    onNeedRefresh() {
      apply = () => void update(true)
      notify()
    },
  })
}

export function useUpdateAvailable(): (() => void) | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => apply,
    () => null,
  )
}
