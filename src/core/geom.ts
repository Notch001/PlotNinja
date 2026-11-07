import type { Point, Polyline } from '@shared/types'

export interface Box { x: number; y: number; width: number; height: number }

export type Matrix = [number, number, number, number, number, number] // a b c d e f

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** m1 * m2 (m2 wird zuerst angewandt). */
export function mul(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ]
}

export function applyM(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}

export function pointsBox(points: Point[]): Box | null {
  if (points.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function pathsBox(paths: Polyline[]): Box | null {
  const pts: Point[] = []
  for (const p of paths) for (const q of p.points) pts.push(q)
  return pointsBox(pts)
}

export function polygonArea(points: Point[]): number {
  let a = 0
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i], q = points[(i + 1) % n]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}

/** Ray-Casting Punkt-in-Polygon. */
export function pointInPolygon(pt: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

export function boxContains(outer: Box, inner: Box, eps = 1e-6): boolean {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.width <= outer.x + outer.width + eps &&
    inner.y + inner.height <= outer.y + outer.height + eps
  )
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** Abstand eines Punktes zur STRECKE a-b (nicht zur unendlichen Geraden). */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  if (l2 < 1e-18) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Kleinster Abstand von `pt` zum Rand des (geschlossenen) Polygons. */
export function distToPolygonEdge(pt: Point, poly: Point[]): number {
  let best = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    best = Math.min(best, distToSegment(pt, poly[j], poly[i]))
  }
  return best
}

/**
 * Liegt der Pfad `inner` vollständig innerhalb des geschlossenen Polygons `outer` (Even-Odd)?
 * Geprüft werden bis zu `maxSamples` gleichmäßig verteilte Punkte des Pfades. Punkte, die (fast) auf dem Rand
 * von `outer` liegen, zählen neutral; mindestens ein Punkt muss echt innen liegen.
 */
export function polylineInside(
  outerPts: Point[], outerBox: Box, innerPts: Point[], innerBox: Box, maxSamples = 12, edgeEps = 1e-4
): boolean {
  if (!boxContains(outerBox, innerBox, 1e-4)) return false
  const n = innerPts.length
  if (n === 0 || outerPts.length < 3) return false
  const k = Math.min(n, maxSamples)
  let strictlyInside = 0
  for (let s = 0; s < k; s++) {
    const pt = innerPts[Math.floor((s * n) / k)]
    if (pointInPolygon(pt, outerPts)) {
      strictlyInside++
    } else if (distToPolygonEdge(pt, outerPts) > edgeEps) {
      return false
    }
  }
  return strictlyInside > 0
}

function orient(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/** Schneiden sich die Strecken a-b und c-d echt (Kreuzung im Inneren beider Strecken)? */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b)
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))
}

/** Kreuzen sich zwei Polylinien (Kanten schneiden sich echt)? `closed` schließt jeweils den Pfad. */
export function polylinesCross(
  a: Point[], aClosed: boolean, b: Point[], bClosed: boolean, budget?: { ops: number }
): boolean {
  const na = aClosed ? a.length : a.length - 1
  const nb = bClosed ? b.length : b.length - 1
  for (let i = 0; i < na; i++) {
    const p = a[i], q = a[(i + 1) % a.length]
    const minX = Math.min(p.x, q.x), maxX = Math.max(p.x, q.x)
    const minY = Math.min(p.y, q.y), maxY = Math.max(p.y, q.y)
    for (let j = 0; j < nb; j++) {
      const r = b[j], t = b[(j + 1) % b.length]
      if (budget && --budget.ops < 0) return false
      if (Math.max(r.x, t.x) < minX || Math.min(r.x, t.x) > maxX) continue
      if (Math.max(r.y, t.y) < minY || Math.min(r.y, t.y) > maxY) continue
      if (segmentsCross(p, q, r, t)) return true
    }
  }
  return false
}

export function pathLength(pl: Polyline): number {
  let len = 0
  const pts = pl.points
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  if (pl.closed && pts.length > 1) {
    len += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y)
  }
  return len
}
