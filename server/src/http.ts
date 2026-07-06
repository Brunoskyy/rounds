import { createReadStream, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'

import {
  InvalidInput,
  parseId,
  parseRound,
  type PutRoundResponse,
  type SyncResponse,
} from '@rounds/shared'

import { newId } from './ids.ts'
import type { Store } from './store.ts'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
}
const MAX_JSON = 512 * 1024
const MAX_PHOTO = 8 * 1024 * 1024
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export interface HttpOptions {
  store: Store
  staticDir?: string | undefined
  now?: () => number
}

/**
 * A small REST surface. `GET /api/sync` is the pull; `PUT /api/rounds/:id`
 * is the push, with the version check that turns a lost race into a 409
 * carrying the current record. Photos are bytes, uploaded separately so a
 * round can sync before its pictures do.
 */
export function createRequestHandler({ store, staticDir, now = Date.now }: HttpOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (url.pathname === '/health') return json(res, 200, { ok: true })

      if (url.pathname === '/api/sync' && req.method === 'GET') {
        const since = Number(url.searchParams.get('since') ?? 0)
        const body: SyncResponse = {
          now: now(),
          ...store.changedSince(Number.isFinite(since) ? since : 0),
        }
        return json(res, 200, body)
      }

      const roundMatch = /^\/api\/rounds\/([^/]+)$/.exec(url.pathname)
      if (roundMatch) {
        const id = parseId(roundMatch[1], 'round id')
        if (req.method === 'GET') {
          const round = store.getRound(id)
          return round ? json(res, 200, round) : json(res, 404, { error: 'not found' })
        }
        if (req.method === 'PUT') {
          const round = parseRound(await readJson(req))
          if (round.id !== id) throw new InvalidInput('round id in the body does not match the URL')
          const checklist = store.getChecklist(round.checklistId)
          if (!checklist) throw new InvalidInput('unknown checklist')
          const stored = store.putRound(round, round.version, now())
          if (stored) {
            const body: PutRoundResponse = { ok: true, round: stored }
            return json(res, 200, body)
          }
          const current = store.getRound(id)
          if (!current) throw new InvalidInput('round vanished during write')
          const body: PutRoundResponse = { ok: false, conflict: true, current }
          return json(res, 409, body)
        }
      }

      const photoMatch = /^\/api\/photos\/([^/]+)$/.exec(url.pathname)
      if (photoMatch) {
        const id = parseId(photoMatch[1], 'photo id')
        if (req.method === 'GET') {
          const photo = store.getPhoto(id)
          if (!photo) return json(res, 404, { error: 'not found' })
          res.writeHead(200, {
            'content-type': photo.mime,
            'cache-control': 'private, max-age=31536000, immutable',
          })
          res.end(photo.bytes)
          return
        }
        if (req.method === 'PUT') {
          const mime = req.headers['content-type'] ?? ''
          if (!PHOTO_TYPES.has(mime)) return json(res, 415, { error: 'jpeg, png or webp only' })
          const roundId = parseId(url.searchParams.get('round'), 'round id')
          const itemId = parseId(url.searchParams.get('item'), 'item id')
          const bytes = await readBytes(req, MAX_PHOTO)
          const photo = { id, roundId, itemId, mime, bytes: bytes.length }
          store.putPhoto(photo, bytes, now())
          return json(res, 200, { ok: true, photo })
        }
      }

      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' })
      if (staticDir) return serveStatic(res, staticDir, url.pathname)
      return json(res, 404, { error: 'not found' })
    } catch (e) {
      if (res.headersSent) {
        res.destroy()
        return
      }
      if (e instanceof InvalidInput) return json(res, 400, { error: e.message })
      if (e instanceof PayloadTooLarge) return json(res, 413, { error: e.message })
      json(res, 500, { error: 'server error' })
    }
  }
}

class PayloadTooLarge extends Error {}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function readBytes(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) {
        reject(new PayloadTooLarge(`body larger than ${max} bytes`))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const text = (await readBytes(req, MAX_JSON)).toString('utf8')
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new InvalidInput('body is not JSON')
  }
}

function serveStatic(res: ServerResponse, dir: string, pathname: string): void {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(dir, clean)
  if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory())
    file = join(dir, 'index.html')
  const ext = extname(file)
  const immutable = /\/assets\//.test(file)
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // The service worker file itself must never be cached by the browser.
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}

export { newId }
