import type { Checklist, Photo, Round, Site } from './types.ts'

/** `GET /api/sync?since=<ms>`: everything that changed after `since`. */
export interface SyncResponse {
  now: number
  sites: Site[]
  checklists: Checklist[]
  rounds: Round[]
}

/** `PUT /api/rounds/:id` body is a full Round whose `version` is the base the client edited from. */
export type PutRoundResponse =
  | { ok: true; round: Round }
  /** 409: the server moved on. `current` is what it has; the client merges and retries. */
  | { ok: false; conflict: true; current: Round }

export interface PhotoUploadResponse {
  ok: true
  photo: Photo
}
