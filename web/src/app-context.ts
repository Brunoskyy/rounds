import { createContext, useContext, useSyncExternalStore } from 'react'

import type { Repo, RepoSnapshot } from './data/repo.ts'
import type { SyncEngine, SyncStatus } from './sync/engine.ts'

export interface AppServices {
  repo: Repo
  engine: SyncEngine
}

export const AppContext = createContext<AppServices | null>(null)

export function useServices(): AppServices {
  const s = useContext(AppContext)
  if (!s) throw new Error('AppContext missing')
  return s
}

export function useRepo(): RepoSnapshot {
  const { repo } = useServices()
  return useSyncExternalStore(repo.subscribe, repo.getSnapshot, repo.getSnapshot)
}

export function useSyncStatus(): SyncStatus {
  const { engine } = useServices()
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot)
}
