import type { CutJob, DeviceInfo, DeviceStatus, PlotEvent, Point } from '@shared/types'
import { pathLength } from '@core/geom'
import { sleep, type PlotterDevice } from './types'

/** Beschleunigungsfaktor gegenüber der geschätzten Realgeschwindigkeit. */
const SPEEDUP = 4
const TICK_MS = 50
/** Geschätzte Schneidgeschwindigkeit in mm/s je Geschwindigkeitsstufe (Stufe 1-10). */
const MM_PER_S_PER_LEVEL = 15
/** Leerfahrten sind schneller als Schneiden. */
const TRAVEL_FACTOR = 3

export class SimulatorDevice implements PlotterDevice {
  readonly info: DeviceInfo = { id: 'simulator', name: 'Simulator (ohne Plotter testen)', kind: 'simulator' }
  private busy = false

  async open(): Promise<void> { /* nichts zu tun */ }
  async close(): Promise<void> { /* nichts zu tun */ }
  async status(): Promise<DeviceStatus> { return this.busy ? 'busy' : 'ready' }

  async run(job: CutJob, onEvent: (e: PlotEvent) => void, signal: AbortSignal): Promise<void> {
    const passes = Math.max(1, Math.round(job.settings.passes))
    const cutSpeed = Math.max(1, job.settings.speed) * MM_PER_S_PER_LEVEL * SPEEDUP // mm/s
    const travelSpeed = cutSpeed * TRAVEL_FACTOR
    const paths = job.paths.filter((p) => p.points.length >= 2)
    const totalLength = paths.reduce((s, p) => s + pathLength(p), 0) * passes

    this.busy = true
    onEvent({ type: 'started', totalPaths: paths.length, totalLength })
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
        const t = dist === 0 ? 1 : done / dist
        pos = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        onEvent({ type: 'progress', pathIndex, x: pos.x, y: pos.y, cutLength: Math.min(cut, totalLength), done: false })
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
      if (!(await moveTo({ x: 0, y: 0 }, travelSpeed, false, paths.length - 1))) return this.cancel(onEvent)
      onEvent({ type: 'finished' })
    } finally {
      this.busy = false
    }
  }

  private cancel(onEvent: (e: PlotEvent) => void): void {
    onEvent({ type: 'cancelled' })
  }
}
