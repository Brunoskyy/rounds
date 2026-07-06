import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createApp } from './app.ts'

const here = dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT ?? 8788)
const dataDir = resolve(process.env.DATA_DIR ?? join(here, '..', '..', 'data'))
mkdirSync(dataDir, { recursive: true })
const webDist = resolve(process.env.STATIC_DIR ?? join(here, '..', '..', 'web', 'dist'))
const staticDir = existsSync(join(webDist, 'index.html')) ? webDist : undefined

const app = createApp({ dbPath: join(dataDir, 'rounds.db'), staticDir })
const bound = await app.listen(port)
console.log(
  `rounds listening on http://localhost:${bound}${staticDir ? '' : ' (API only; run the web dev server)'}`,
)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0))
  })
}
