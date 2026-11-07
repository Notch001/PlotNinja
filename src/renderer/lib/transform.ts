import type { Part, Point } from '@shared/types'
import { groupBounds, normDeg, partScale, partCenter, rotateParts, scaleParts, translateParts, withCenter } from '../core'

export interface Box { x: number; y: number; width: number; height: number }

/** Gemeinsame Bounding-Box (Gruppe oder Auswahl); die Transformationen liegen in src/core/group.ts. */
export const unionBounds = (parts: Part[]): Box | null => groupBounds(parts)

export { normDeg, partCenter, withCenter, translateParts, scaleParts, rotateParts }

const lenCache = new WeakMap<object, number>()
/** Schnittlänge eines Bauteils in mm (Pfade * Skalierung). */
export function partCutLength(p: Part): number {
  let base = lenCache.get(p.paths)
  if (base === undefined) {
    base = 0
    for (const pl of p.paths) {
      const pts = pl.points
      for (let i = 1; i < pts.length; i++) base += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
      if (pl.closed && pts.length > 1) base += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y)
    }
    lenCache.set(p.paths, base)
  }
  const sc = partScale(p)
  if (Math.abs(sc.x - sc.y) < 1e-9) return base * sc.x
  // Ungleiche Skalierung: Segmente einzeln umrechnen (nicht gecacht, selten)
  let len = 0
  for (const pl of p.paths) {
    const pts = pl.points
    const n = pl.closed && pts.length > 1 ? pts.length : pts.length - 1
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      len += Math.hypot((b.x - a.x) * sc.x, (b.y - a.y) * sc.y)
    }
  }
  return len
}

export function polylineLength(points: Point[], closed: boolean): number {
  let l = 0
  for (let i = 1; i < points.length; i++) l += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  if (closed && points.length > 1) l += Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y)
  return l
}

export function pathD(points: Point[], closed: boolean): string {
  if (!points.length) return ''
  let d = 'M' + points[0].x.toFixed(2) + ' ' + points[0].y.toFixed(2)
  for (let i = 1; i < points.length; i++) d += 'L' + points[i].x.toFixed(2) + ' ' + points[i].y.toFixed(2)
  return closed ? d + 'Z' : d
}

export function fmt(n: number, digits = 1): string {
  return formatNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: digits })
}
