/** Short random ids for notes, ops and participants. 9 bytes is plenty within one board. */
export function newId(): string {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}
