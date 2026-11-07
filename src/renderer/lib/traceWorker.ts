/// <reference lib="webworker" />
import { traceImage, type ImageLike, type TraceOptions } from '@core/trace'

/** Web Worker: hält das Bild und zeichnet bei Bedarf nach (blockiert so nie die Oberfläche). */
let image: ImageLike | null = null

self.onmessage = (e: MessageEvent): void => {
  const m = e.data as { type: 'image'; img: ImageLike } | { type: 'trace'; id: number; opts: Partial<TraceOptions> }
  if (m.type === 'image') { image = m.img; return }
  try {
    if (!image) throw new Error('No image loaded') // interner Fehler, nie sichtbar (Worker kennt die UI-Sprache nicht)
    const result = traceImage(image, m.opts)
    ;(self as unknown as Worker).postMessage({ type: 'result', id: m.id, result })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) })
  }
}
