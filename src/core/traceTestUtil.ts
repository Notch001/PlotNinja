import type { ImageLike } from './trace'

/** Synthetisches Bild: fn(x,y) liefert [r,g,b,a] oder true (schwarz auf weiß) / false (weiß). */
export function makeImage(w: number, h: number, fn: (x: number, y: number) => boolean | [number, number, number, number]): ImageLike {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = fn(x, y)
      const i = (y * w + x) * 4
      const px: [number, number, number, number] = typeof v === 'boolean' ? (v ? [0, 0, 0, 255] : [255, 255, 255, 255]) : v
      data[i] = px[0]; data[i + 1] = px[1]; data[i + 2] = px[2]; data[i + 3] = px[3]
    }
  }
  return { width: w, height: h, data }
}
export const disc = (cx: number, cy: number, r: number) => (x: number, y: number): boolean => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r

