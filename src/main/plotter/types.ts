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
  /** Setzt einen pausierten Auftrag fort ("Weiter" nach 'paused'). Ohne wartenden Auftrag wirkungslos. */
  resume?(): void
  /** Fährt Material ohne Auftrag um `feedMm` vor. Wirft bei Fehlern (mit verständlicher Meldung). */
  eject(feedMm: number, signal: AbortSignal): Promise<void>
}

/** Gerät mitten im Betrieb verschwunden (Kabel gezogen o. ä.); die Meldung ist übersetzt. */
export class DeviceLostError extends Error {
  constructor(message: string) { super(message); this.name = 'DeviceLostError' }
}

/** Wartepunkt für 'paused': `wait` endet bei `resume()` oder Abbruch (liefert dann false). */
export class ResumeGate {
  private waiter: ((ok: boolean) => void) | null = null

  wait(signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve(false)
      const onAbort = (): void => finish(false)
      const finish = (ok: boolean): void => {
        signal.removeEventListener('abort', onAbort)
        this.waiter = null
        resolve(ok)
      }
      this.waiter = finish
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  resume(): void {
    this.waiter?.(true)
  }
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
