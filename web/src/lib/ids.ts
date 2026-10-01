/**
 * Random ids made on the device, so a round or a photo started offline has
 * its id before the server ever hears of it. 9 random bytes make a clash
 * between two devices too unlikely to plan for.
 */
export function newId(): string {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}
