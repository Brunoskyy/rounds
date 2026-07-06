import { randomBytes } from 'node:crypto'

export function newId(bytes = 9): string {
  return randomBytes(bytes).toString('base64url')
}
