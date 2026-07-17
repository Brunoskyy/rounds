import type { PutRoundResponse, Round, SyncResponse } from '@rounds/shared'

/** The network, behind an interface small enough to fake in tests. */
export interface Api {
  pull(since: number): Promise<SyncResponse>
  pushRound(
    round: Round,
  ): Promise<{ status: 200; body: PutRoundResponse } | { status: 409; body: PutRoundResponse }>
  uploadPhoto(id: string, roundId: string, itemId: string, blob: Blob): Promise<void>
}

export class NetworkError extends Error {}
/** The server understood and said no: retrying the same thing will not help. */
export class RejectedError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function createApi(base = ''): Api {
  const call = async (path: string, init?: RequestInit): Promise<Response> => {
    let res: Response
    try {
      res = await fetch(base + path, init)
    } catch (e) {
      throw new NetworkError(e instanceof Error ? e.message : 'network')
    }
    if (res.status >= 500) throw new NetworkError(`server answered ${res.status}`)
    return res
  }
  return {
    async pull(since) {
      const res = await call(`/api/sync?since=${since}`)
      if (!res.ok) throw new NetworkError(`pull failed with ${res.status}`)
      return (await res.json()) as SyncResponse
    },
    async pushRound(round) {
      const res = await call(`/api/rounds/${round.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(round),
      })
      const body = (await res.json()) as PutRoundResponse
      if (res.status === 200) return { status: 200, body }
      if (res.status === 409) return { status: 409, body }
      throw new RejectedError(
        res.status,
        (body as { error?: string }).error ?? `push rejected with ${res.status}`,
      )
    },
    async uploadPhoto(id, roundId, itemId, blob) {
      const res = await call(`/api/photos/${id}?round=${roundId}&item=${itemId}`, {
        method: 'PUT',
        headers: { 'content-type': blob.type },
        body: blob,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new RejectedError(res.status, body.error ?? `photo rejected with ${res.status}`)
      }
    },
  }
}
