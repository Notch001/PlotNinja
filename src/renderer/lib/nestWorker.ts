/// <reference lib="webworker" />
import { nest, type NestJob } from '@core/nest'

/** Web Worker: rechnet das Nesting abseits der Oberfläche (zeitbegrenzt, liefert sonst den besten Stand). */
self.onmessage = (e: MessageEvent): void => {
  const m = e.data as { id: number; job: NestJob }
  try {
    ;(self as unknown as Worker).postMessage({ id: m.id, result: nest(m.job) })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) })
  }
}
