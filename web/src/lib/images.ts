const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 6 * 1024 * 1024
const MAX_EDGE = 1600

/**
 * Phone cameras produce HEIC files of several megabytes; the server takes
 * jpeg, png or webp under 8 MB. Anything else is redrawn on a canvas as a
 * jpeg no wider than 1600px, which is plenty for a gauge or a nameplate.
 * If the browser cannot decode it, the original is kept and the server
 * will say why it refused.
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (ACCEPTED.has(file.type) && file.size <= MAX_BYTES) return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    )
    return blob ?? file
  } catch {
    return file
  }
}
