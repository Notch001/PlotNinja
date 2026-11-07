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

/** Liegt `inner` (Pfad) vollständig innerhalb des geschlossenen Polygons `outer`? Stichprobenartig geprüft. */
export function polylineInside(
  outerPts: Point[], outerBox: Box, innerPts: Point[], innerBox: Box
): boolean {
  if (!boxContains(outerBox, innerBox)) return false
  const n = innerPts.length
  if (n === 0) return false
  const samples = [innerPts[0], innerPts[Math.floor(n / 2)], innerPts[n - 1]]
  return samples.every((s) => pointInPolygon(s, outerPts))
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
