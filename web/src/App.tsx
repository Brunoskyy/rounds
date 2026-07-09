import { useEffect, useState } from 'react'

import { AppContext, type AppServices } from './app-context.ts'
import { Header } from './components/Header.tsx'
import { Home } from './components/Home.tsx'
import { RoundPage } from './components/RoundPage.tsx'
import { SitePage } from './components/SitePage.tsx'
import { SyncPage } from './components/SyncPage.tsx'
import { createApi } from './data/api.ts'
import { openRoundsDB } from './data/db.ts'
import { Repo } from './data/repo.ts'
import { useRoute } from './lib/router.ts'
import { SyncEngine } from './sync/engine.ts'

export function App() {
  const [services, setServices] = useState<AppServices | null>(null)
  useEffect(() => {
    let engine: SyncEngine | null = null
    let cancelled = false
    void (async () => {
      const repo = new Repo(await openRoundsDB())
      await repo.load()
      if (cancelled) return
      engine = new SyncEngine(repo, createApi())
      engine.start()
      setServices({ repo, engine })
    })()
    return () => {
      cancelled = true
      engine?.stop()
    }
  }, [])

  if (!services) {
    return (
      <main className="text-muted flex min-h-dvh items-center justify-center" aria-busy="true">
        Opening your rounds…
      </main>
    )
  }
  return (
    <AppContext.Provider value={services}>
      <Header />
      <Routes />
    </AppContext.Provider>
  )
}

function Routes() {
  const route = useRoute()
  switch (route.name) {
    case 'site':
      return <SitePage id={route.id} />
    case 'round':
      return <RoundPage key={route.id} id={route.id} />
    case 'sync':
      return <SyncPage />
    default:
      return <Home />
  }
}
