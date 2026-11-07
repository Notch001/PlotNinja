import { t } from '@shared/i18n'
import { nest, type NestJob, type NestResult } from '../core'

export interface NestRun { promise: Promise<NestResult>; cancel(): void }

/**
 * Startet eine Nesting-Rechnung in einem eigenen Web Worker (Abbruch = Worker beenden). Ist kein Worker möglich,
 * rechnet es nach einem kurzen Zeitversatz im Hauptthread (zeitbegrenzt).
 */
export function runNest(job: NestJob): NestRun {
  let worker: Worker | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let dead = false
  const promise = new Promise<NestResult>((resolve, reject) => {
    const inline = (): void => {
      timer = setTimeout(() => {
        if (dead) return
        try { resolve(nest(job)) } catch (e) { reject(e) }
      }, 20)
    }
    try {
      worker = new Worker(new URL('./nestWorker.ts', import.meta.url), { type: 'module' })
    } catch { inline(); return }
    worker.onmessage = (e: MessageEvent): void => {
      const m = e.data as { result?: NestResult; error?: string }
      worker?.terminate(); worker = null
      if (m.result) resolve(m.result); else reject(new Error(m.error ?? t('nest.failed')))
    }
    worker.onerror = (): void => {
      worker?.terminate(); worker = null
      if (!dead) inline()
    }
    worker.postMessage({ id: 1, job })
  })
  return {
    promise,
    cancel() {
      dead = true
      if (timer) clearTimeout(timer)
      worker?.terminate(); worker = null
    }
  }
}
