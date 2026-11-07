import type { ImageLike } from '../core'

/** Längste Kante (px) des im Dialog gehaltenen Bildes; größere Bilder werden beim Decodieren verkleinert. */
export const DECODE_MAX_EDGE = 2048
/** Bilder mit mehr als dieser Kantenlänge werden mit Hinweis verkleinert. */
export const WARN_EDGE = 8000
/** Ab dieser Dateigröße gibt es eine Warnung. */
export const WARN_BYTES = 50 * 1024 * 1024
/** Absolute Obergrenze der Pixelzahl, damit der Speicher nicht überläuft. */
const MAX_PIXELS = 150_000_000

export interface DecodedImage extends ImageLike {
  data: Uint8ClampedArray
  /** Originalgröße in Pixeln (vor dem Verkleinern). */
  origWidth: number
  origHeight: number
  reduced: boolean
}

const mimeOf = (name: string): string => {
  const e = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase()
  return e === 'png' ? 'image/png' : e === 'jpg' || e === 'jpeg' ? 'image/jpeg' : e === 'bmp' ? 'image/bmp' : e === 'webp' ? 'image/webp' : e === 'gif' ? 'image/gif' : ''
}

/** Decodiert Bytes zu Pixeldaten (Renderer: createImageBitmap + Canvas). Wirft eine verständliche Meldung bei defekten Dateien. */
export async function decodeImage(bytes: Uint8Array, fileName: string): Promise<DecodedImage> {
  if (!bytes.byteLength) throw new Error('Die Datei ist leer.')
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeOf(fileName) }))
  } catch {
    throw new Error('Das Bild ist beschädigt oder das Format wird nicht unterstützt (erlaubt: PNG, JPG, BMP, WebP, GIF).')
  }
  try {
    const ow = bmp.width, oh = bmp.height
    if (!ow || !oh) throw new Error('Das Bild hat keine Größe.')
    if (ow * oh > MAX_PIXELS) throw new Error(`Das Bild ist mit ${ow} × ${oh} Pixeln zu groß (maximal ${(MAX_PIXELS / 1e6).toFixed(0)} Megapixel).`)
    const f = Math.min(1, DECODE_MAX_EDGE / Math.max(ow, oh))
    const w = Math.max(1, Math.round(ow * f)), h = Math.max(1, Math.round(oh * f))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas steht nicht zur Verfügung.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, w, h)
    const id = ctx.getImageData(0, 0, w, h)
    return { width: w, height: h, data: id.data, origWidth: ow, origHeight: oh, reduced: f < 1 }
  } finally {
    bmp.close()
  }
}
