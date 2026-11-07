import type { Part, Point } from '@shared/types'
import { partBounds } from '../core'

export interface Box { x: number; y: number; width: number; height: number }

export function unionBounds(parts: Part[]): Box | null {
  if (!parts.length) return null
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const p of parts) {
    const b = partBounds(p)
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y)
    x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height)
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

export function partCenter(p: Part): Point {
  return { x: p.x + (p.width * p.scale) / 2, y: p.y + (p.height * p.scale) / 2 }
}

export function withCenter(p: Part, c: Point): Part {
  return { ...p, x: c.x - (p.width * p.scale) / 2, y: c.y - (p.height * p.scale) / 2 }
}

export function translateParts(parts: Part[], dx: number, dy: number): Part[] {
  return parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }))
}

/** Gleichmäßig um `anchor` skalieren (Faktor f). */
export function scaleParts(parts: Part[], anchor: Point, f: number): Part[] {
  return parts.map((p) => {
    const c = partCenter(p)
    const ns = p.scale * f
    return withCenter({ ...p, scale: ns }, { x: anchor.x + (c.x - anchor.x) * f, y: anchor.y + (c.y - anchor.y) * f })
  })
}

/** Um `center` drehen (deltaDeg im Uhrzeigersinn). */
export function rotateParts(parts: Part[], center: Point, deltaDeg: number): Part[] {
  const a = (deltaDeg * Math.PI) / 180
  const c = Math.cos(a), s = Math.sin(a)
  return parts.map((p) => {
    const pc = partCenter(p)
    const dx = pc.x - center.x, dy = pc.y - center.y
    return withCenter({ ...p, rotation: normDeg(p.rotation + deltaDeg) }, { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c })
  })
}

export function normDeg(d: number): number {
  let r = d % 360
  if (r <= -180) r += 360
  if (r > 180) r -= 360
  return Math.round(r * 1000) / 1000
}

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
  return base * p.scale
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
  return n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

export function fmtDuration(sec: number): string {
  sec = Math.max(0, Math.round(sec))
  if (sec < 60) return `${sec} s`
  const m = Math.floor(sec / 60), s = sec % 60
  if (m < 60) return `${m} min ${s.toString().padStart(2, '0')} s`
  return `${Math.floor(m / 60)} h ${(m % 60).toString().padStart(2, '0')} min`
}
