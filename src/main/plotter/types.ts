import type { CutJob, DeviceInfo, DeviceStatus, PlotEvent } from '@shared/types'

export interface PlotterDevice {
  readonly info: DeviceInfo
  open(): Promise<void>
  close(): Promise<void>
  /**
   * Führt den Auftrag aus. Meldet Fortschritt, Ende, Abbruch und Fehler über `onEvent`
   * (ein 'error'-Event beendet den Lauf; die Promise wird dann trotzdem normal aufgelöst).
   */
  run(job: CutJob, onEvent: (e: PlotEvent) => void, signal: AbortSignal): Promise<void>
  status(): Promise<DeviceStatus>
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const t = setTimeout(done, ms)
    function done(): void {
      signal?.removeEventListener('abort', done)
      clearTimeout(t)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}
