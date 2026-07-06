import { createServer, type Server } from 'node:http'

import { createRequestHandler } from './http.ts'
import { seed } from './seed.ts'
import { Store } from './store.ts'

export interface AppOptions {
  dbPath: string
  staticDir?: string | undefined
  seed?: boolean
  now?: () => number
}

export interface App {
  server: Server
  store: Store
  listen(port: number, host?: string): Promise<number>
  close(): Promise<void>
}

export function createApp(options: AppOptions): App {
  const store = new Store(options.dbPath)
  if (options.seed !== false) seed(store, options.now ? options.now() : Date.now())
  const handle = createRequestHandler({
    store,
    staticDir: options.staticDir,
    ...(options.now ? { now: options.now } : {}),
  })
  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  return {
    server,
    store,
    listen: (port, host = '0.0.0.0') =>
      new Promise((resolve) => {
        server.listen(port, host, () => {
          const address = server.address()
          resolve(typeof address === 'object' && address ? address.port : port)
        })
      }),
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      store.close()
    },
  }
}
