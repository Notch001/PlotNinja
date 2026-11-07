import type { CutJob, Point } from '@shared/types'
import { pathLength } from './geom'

/** Schneidgeschwindigkeit in mm/s je Geschwindigkeitsstufe (Stufe 1-10 = 10-100 mm/s). */
export const MM_PER_S_PER_LEVEL = 10
/** Leerfahrten (Stift/Messer oben) sind um diesen Faktor schneller als das Schneiden. */
export const TRAVEL_FACTOR = 3

export const cutSpeedMmPerS = (speedLevel: number): number => Math.max(1, speedLevel) * MM_PER_S_PER_LEVEL
export const travelSpeedMmPerS = (speedLevel: number): number => cutSpeedMmPerS(speedLevel) * TRAVEL_FACTOR

/**
 * Reine Bewegungszeit eines Jobs in Sekunden (genau das, was der Simulator in Echtzeit abspielt):
 * Schneiden mit Schneidgeschwindigkeit, Leerfahrten (Start -> Pfadanfang, Pfadende -> Pfadanfang bei weiteren
 * Durchgängen, letzter Pfad -> Ursprung) mit Leerfahrtgeschwindigkeit.
 */
export function motionSeconds(job: CutJob): number {
  const passes = Math.max(1, Math.round(job.settings.passes))
  const cutV = cutSpeedMmPerS(job.settings.speed)
  const travelV = travelSpeedMmPerS(job.settings.speed)
  let cut = 0, travel = 0
  let pos: Point = { x: 0, y: 0 }
  for (const p of job.paths) {
    if (p.points.length < 2) continue
    const start = p.points[0]
    const end = p.closed ? p.points[0] : p.points[p.points.length - 1]
    cut += pathLength(p) * passes
    travel += Math.hypot(start.x - pos.x, start.y - pos.y)
    travel += (passes - 1) * Math.hypot(start.x - end.x, start.y - end.y)
    pos = end
  }
  travel += Math.hypot(pos.x, pos.y)
  return cut / cutV + travel / travelV
}

/** Dauerschätzung für die Anzeige: Bewegungszeit plus Anlauf-/Pfadwechsel-Zuschlag der echten Hardware. */
export function estimateDurationSeconds(job: CutJob): number {
  const paths = job.paths.filter((p) => p.points.length >= 2).length
  return motionSeconds(job) + paths * 0.15 + 5
}
