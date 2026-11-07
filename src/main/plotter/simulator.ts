import type { CutJob, DeviceInfo, DeviceStatus, PlotEvent, Point } from '@shared/types'
import { pathLength } from '@core/geom'
import { ejectFeedMm } from '@core/gpgl'
import { cutSpeedMmPerS, travelSpeedMmPerS } from '@core/timing'
import { t } from '@shared/i18n'
import { ResumeGate, sleep, type PlotterDevice } from './types'

/** Echtzeit: Geschwindigkeiten kommen aus @core/timing (dieselben wie die Dauerschätzung im Schneiden-Dialog). */
const TICK_MS = 50

/**
 * Fehlerfälle zum Testen der Fehlerpfade (verstecktes Flag, Umgebungsvariable `PLOTNINJA_SIM_FAULT`):
 *  - 'no-media':   pausiert vor dem Start ("kein Medium"), bis "Weiter" gedrückt wird
 *  - 'media-lost': Medium verschwindet nach ca. 30 % des Schnitts -> sicherer Abbruch
 *  - 'disconnect': Gerät verschwindet nach ca. 30 % des Schnitts (Kabel gezogen)
 */
export type SimFault = 'no-media' | 'media-lost' | 'disconnect'

export function simFaultFromEnv(): SimFault | undefined {
  const v = typeof process !== 'undefined' ? process.env?.PLOTNINJA_SIM_FAULT : undefined
  return v === 'no-media' || v === 'media-lost' || v === 'disconnect' ? v : undefined
}

export class SimulatorDevice implements PlotterDevice {
  readonly info: DeviceInfo = { id: 'simulator', name: t('plotter.simulator.name'), kind: 'simulator' }
  private busy = false
  private gate = new ResumeGate()
  private faultReported = false

  constructor(private fault: SimFault | undefined = simFaultFromEnv()) {}

  resume(): void { this.gate.resume() }

  async open(): Promise<void> { /* nichts zu tun */ }
  async close(): Promise<void> { /* nichts zu tun */ }
  async status(): Promise<DeviceStatus> { return this.busy ? 'busy' : 'ready' }

  async run(job: CutJob, onEvent: (e: PlotEvent) => void, signal: AbortSignal): Promise<void> {
    const passes = Math.max(1, Math.round(job.settings.passes))
    const cutSpeed = cutSpeedMmPerS(job.settings.speed) // mm/s
    const travelSpeed = travelSpeedMmPerS(job.settings.speed)
    const paths = job.paths.filter((p) => p.points.length >= 2)
    const totalLength = paths.reduce((s, p) => s + pathLength(p), 0) * passes

    this.busy = true
    onEvent({ type: 'started', totalPaths: paths.length, totalLength })
    this.faultReported = false
    if (this.fault === 'no-media') {
      onEvent({ type: 'paused', reason: 'no-media', message: t('plotter.simulator.noMedia') })
      if (!(await this.gate.wait(signal))) { this.busy = false; return this.cancel(onEvent) }
      onEvent({ type: 'resumed' })
    }
    let pos: Point = { x: 0, y: 0 }
    let cut = 0
    let lastTick = Date.now()

    // Bewegt den Kopf von a nach b mit gegebener Geschwindigkeit; liefert false bei Abbruch.
    const moveTo = async (b: Point, speed: number, cutting: boolean, pathIndex: number): Promise<boolean> => {
      const a = pos
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      let done = 0
      while (done < dist) {
        if (signal.aborted) return false
        await sleep(TICK_MS, signal)
        if (signal.aborted) return false
        const now = Date.now()
        const dt = Math.min((now - lastTick) / 1000, 0.25)
        lastTick = now
        const step = speed * dt
        done = Math.min(dist, done + step)
        if (cutting) cut += Math.min(step, dist - (done - step))
        const f = dist === 0 ? 1 : done / dist
        pos = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
        onEvent({ type: 'progress', pathIndex, x: pos.x, y: pos.y, cutLength: Math.min(cut, totalLength), done: false })
        if ((this.fault === 'media-lost' || this.fault === 'disconnect') && cut >= totalLength * 0.3) {
          this.faultReported = true
          onEvent(this.fault === 'disconnect'
            ? { type: 'error', deviceLost: true, message: t('plotter.simulator.cableUnplugged') }
            : { type: 'error', message: t('plotter.simulator.mediaLost') })
          return false
        }
      }
      pos = b
      return true
    }

    try {
      for (let i = 0; i < paths.length; i++) {
        const pl = paths[i]
        const pts = pl.closed ? [...pl.points, pl.points[0]] : pl.points
        for (let pass = 0; pass < passes; pass++) {
          lastTick = Date.now()
          if (!(await moveTo(pts[0], travelSpeed, false, i))) return this.cancel(onEvent)
          for (let k = 1; k < pts.length; k++) {
            if (!(await moveTo(pts[k], cutSpeed, true, i))) return this.cancel(onEvent)
          }
        }
        onEvent({ type: 'progress', pathIndex: i, x: pos.x, y: pos.y, cutLength: Math.min(cut, totalLength), done: true })
      }
      if (job.ejectExtraMm !== undefined) {
        // Wie am echten Gerät: kein Zurückfahren, sondern Vorschub bis hinter den Auftrag
        onEvent({ type: 'ejecting' })
        if (!(await this.simulateFeed(ejectFeedMm(job), travelSpeed, signal))) return this.cancel(onEvent)
      } else if (!(await moveTo({ x: 0, y: 0 }, travelSpeed, false, paths.length - 1))) return this.cancel(onEvent)
      onEvent({ type: 'finished' })
    } finally {
      this.busy = false
    }
  }

  async eject(feedMm: number, signal: AbortSignal): Promise<void> {
    this.busy = true
    try { await this.simulateFeed(feedMm, travelSpeedMmPerS(5), signal) } finally { this.busy = false }
  }

  /** Simuliert den Materialvorschub (mindestens 0,3 s, höchstens 4 s); false bei Abbruch. */
  private async simulateFeed(feedMm: number, speed: number, signal: AbortSignal): Promise<boolean> {
    await sleep(Math.min(4000, Math.max(300, (feedMm / speed) * 1000)), signal)
    return !signal.aborted
  }

  private cancel(onEvent: (e: PlotEvent) => void): void {
    if (this.faultReported) return
    onEvent({ type: 'cancelled' })
  }
}
