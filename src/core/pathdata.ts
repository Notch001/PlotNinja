import type { Point, Polyline } from '@shared/types'
import { applyM, distToSegment, type Matrix } from './geom'

/** Maximal erlaubte Abweichung beim Zerlegen von Kurven (mm). */
export const FLATNESS_MM = 0.1

/**
 * Sammelt Teilpfade. Alle Eingabekoordinaten liegen im Benutzerraum (user units); sie werden mit `m`
 * (Benutzerraum -> mm) transformiert, bevor Kurven in Segmente zerlegt werden (so gilt die Toleranz in mm).
 */
export class PathBuilder {
  readonly out: Polyline[] = []
  private cur: Point[] = []
  private curClosed = false
  private last: Point = { x: 0, y: 0 } // letzter Punkt (Benutzerraum)
  private start: Point = { x: 0, y: 0 }

  constructor(private m: Matrix, private tol = FLATNESS_MM) {}

  private flush(): void {
    if (this.cur.length > 0) this.out.push(finishPolyline(this.cur, this.curClosed))
    this.cur = []
    this.curClosed = false
  }

  get current(): Point { return this.last }

  moveTo(x: number, y: number): void {
    this.flush()
    this.last = { x, y }
    this.start = { x, y }
    this.cur = [applyM(this.m, x, y)]
  }

  private ensureStarted(): void {
    if (this.cur.length === 0) this.cur = [applyM(this.m, this.last.x, this.last.y)]
  }

  lineTo(x: number, y: number): void {
    this.ensureStarted()
    this.cur.push(applyM(this.m, x, y))
    this.last = { x, y }
  }

  cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    this.ensureStarted()
    const p0 = this.cur[this.cur.length - 1]
    flattenCubic(p0, applyM(this.m, x1, y1), applyM(this.m, x2, y2), applyM(this.m, x, y), this.tol, this.cur)
    this.last = { x, y }
  }

  quadTo(x1: number, y1: number, x: number, y: number): void {
    const { x: x0, y: y0 } = this.last
    this.cubicTo(
      x0 + (2 / 3) * (x1 - x0), y0 + (2 / 3) * (y1 - y0),
      x + (2 / 3) * (x1 - x), y + (2 / 3) * (y1 - y),
      x, y
    )
  }

  arcTo(rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, x: number, y: number): void {
    const { x: x0, y: y0 } = this.last
    for (const c of arcToCubics(x0, y0, rx, ry, rotDeg, large, sweep, x, y)) {
      this.cubicTo(c[0], c[1], c[2], c[3], c[4], c[5])
    }
    this.last = { x, y }
  }

  close(): void {
    if (this.cur.length === 0) return
    this.curClosed = true
    const s = this.start
    this.flush()
    // Nach Z beginnt ein neuer Teilpfad am Startpunkt
    this.last = { ...s }
  }

  finish(): Polyline[] {
    this.flush()
    return this.out
  }
}

function finishPolyline(points: Point[], closed: boolean): Polyline {
  // Doppelte aufeinanderfolgende Punkte entfernen
  const pts: Point[] = []
  for (const p of points) {
    const q = pts[pts.length - 1]
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) pts.push(p)
  }
  // Endpunkt == Startpunkt -> geschlossen
  if (pts.length >= 3) {
    const a = pts[0], b = pts[pts.length - 1]
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.01) {
      pts.pop()
      closed = true
    }
  }
  return { points: pts, closed: closed && pts.length >= 3 }
}

export function flattenCubic(p0: Point, p1: Point, p2: Point, p3: Point, tol: number, out: Point[], depth = 0): void {
  // Die Kurve liegt in der konvexen Hülle der Kontrollpunkte. Sind beide inneren Kontrollpunkte nahe an der
  // Sehne (Strecke!), ist die Kurve flach. Abstand zur Strecke statt zur Geraden: sonst werden Schleifen und
  // Spitzen, deren Kontrollpunkte über die Endpunkte hinausragen, fälschlich als gerade Linie ausgegeben.
  if (depth >= 18 || Math.max(distToSegment(p1, p0, p3), distToSegment(p2, p0, p3)) <= tol) {
    out.push(p3)
    return
  }
  const m01 = mid(p0, p1), m12 = mid(p1, p2), m23 = mid(p2, p3)
  const m012 = mid(m01, m12), m123 = mid(m12, m23)
  const m = mid(m012, m123)
  flattenCubic(p0, m01, m012, m, tol, out, depth + 1)
  flattenCubic(m, m123, m23, p3, tol, out, depth + 1)
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** SVG-Bogen (Endpunkt-Parametrisierung) -> kubische Beziers (jeweils max. 90 Grad). */
export function arcToCubics(
  x1: number, y1: number, rxIn: number, ryIn: number, rotDeg: number,
  large: boolean, sweep: boolean, x2: number, y2: number
): number[][] {
  let rx = Math.abs(rxIn), ry = Math.abs(ryIn)
  if ((x1 === x2 && y1 === y2)) return []
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]] // Gerade
  const phi = (rotDeg * Math.PI) / 180
  const cosP = Math.cos(phi), sinP = Math.sin(phi)
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2
  const x1p = cosP * dx + sinP * dy
  const y1p = -sinP * dx + cosP * dy
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lam > 1) {
    const s = Math.sqrt(lam)
    rx *= s
    ry *= s
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den))
  if (large === sweep) coef = -coef
  const cxp = (coef * rx * y1p) / ry
  const cyp = (-coef * ry * x1p) / rx
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number): number => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    return a
  }
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dth > 0) dth -= 2 * Math.PI
  else if (sweep && dth < 0) dth += 2 * Math.PI

  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9))
  const step = dth / n
  const t = (4 / 3) * Math.tan(step / 4)
  const res: number[][] = []
  let a = th1
  const pt = (ang_: number, ddx: number, ddy: number): [number, number] => {
    // Punkt/Tangente auf der gedrehten Ellipse
    const ex = rx * Math.cos(ang_) + ddx, ey = ry * Math.sin(ang_) + ddy
    return [cosP * ex - sinP * ey + cx, sinP * ex + cosP * ey + cy]
  }
  for (let i = 0; i < n; i++) {
    const b = a + step
    const c1 = pt(a, -t * rx * Math.sin(a), t * ry * Math.cos(a))
    const c2 = pt(b, t * rx * Math.sin(b), -t * ry * Math.cos(b))
    const e = i === n - 1 ? [x2, y2] : pt(b, 0, 0)
    res.push([c1[0], c1[1], c2[0], c2[1], e[0], e[1]])
    a = b
  }
  return res
}

const NUM_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y

/** Parst das `d`-Attribut und füttert den Builder. Fehlerhafte Reste werden ignoriert. */
export function parsePathData(d: string, b: PathBuilder): void {
  let i = 0
  const n = d.length
  const skipWs = (): void => {
    while (i < n && (d[i] === ' ' || d[i] === ',' || d[i] === '\t' || d[i] === '\n' || d[i] === '\r')) i++
  }
  const num = (): number | null => {
    skipWs()
    NUM_RE.lastIndex = i
    const m = NUM_RE.exec(d)
    if (!m) return null
    i = NUM_RE.lastIndex
    return parseFloat(m[0])
  }
  const flag = (): boolean | null => {
    skipWs()
    if (d[i] === '0') { i++; return false }
    if (d[i] === '1') { i++; return true }
    return null
  }
  const nums = (k: number): number[] | null => {
    const r: number[] = []
    for (let j = 0; j < k; j++) {
      const v = num()
      if (v === null) return null
      r.push(v)
    }
    return r
  }

  let cmd = ''
  let cx = 0, cy = 0 // aktueller Punkt
  let sx = 0, sy = 0 // Teilpfad-Start
  let lcx = 0, lcy = 0 // letzter Kontrollpunkt (für S/T)
  let prev = '' // vorheriges Kommando (großgeschrieben)
  let started = false

  while (true) {
    skipWs()
    if (i >= n) break
    const ch = d[i]
    if (/[A-Za-z]/.test(ch)) {
      cmd = ch
      i++
      if (cmd === 'z' || cmd === 'Z') {
        b.close()
        cx = sx; cy = sy
        prev = 'Z'
        continue
      }
    } else if (cmd === '' || cmd === 'z' || cmd === 'Z') {
      break
    }
    // Wenn nach Z direkt Koordinaten kommen -> implizit M ist ungültig; wir brechen ab
    const rel = cmd === cmd.toLowerCase()
    const C = cmd.toUpperCase()
    const ox = rel ? cx : 0, oy = rel ? cy : 0
    let v: number[] | null
    switch (C) {
      case 'M': {
        v = nums(2)
        if (!v) return
        cx = v[0] + ox; cy = v[1] + oy
        sx = cx; sy = cy
        b.moveTo(cx, cy)
        started = true
        cmd = rel ? 'l' : 'L' // folgende Paare sind LineTo
        prev = 'M'
        break
      }
      case 'L': {
        v = nums(2); if (!v) return
        cx = v[0] + ox; cy = v[1] + oy
        if (!started) { b.moveTo(cx, cy); sx = cx; sy = cy; started = true } else b.lineTo(cx, cy)
        prev = 'L'
        break
      }
      case 'H': {
        v = nums(1); if (!v) return
        cx = v[0] + ox
        b.lineTo(cx, cy)
        prev = 'H'
        break
      }
      case 'V': {
        v = nums(1); if (!v) return
        cy = v[0] + oy
        b.lineTo(cx, cy)
        prev = 'V'
        break
      }
      case 'C': {
        v = nums(6); if (!v) return
        b.cubicTo(v[0] + ox, v[1] + oy, v[2] + ox, v[3] + oy, v[4] + ox, v[5] + oy)
        lcx = v[2] + ox; lcy = v[3] + oy
        cx = v[4] + ox; cy = v[5] + oy
        prev = 'C'
        break
      }
      case 'S': {
        v = nums(4); if (!v) return
        const x1 = prev === 'C' || prev === 'S' ? 2 * cx - lcx : cx
        const y1 = prev === 'C' || prev === 'S' ? 2 * cy - lcy : cy
        b.cubicTo(x1, y1, v[0] + ox, v[1] + oy, v[2] + ox, v[3] + oy)
        lcx = v[0] + ox; lcy = v[1] + oy
        cx = v[2] + ox; cy = v[3] + oy
        prev = 'S'
        break
      }
      case 'Q': {
        v = nums(4); if (!v) return
        b.quadTo(v[0] + ox, v[1] + oy, v[2] + ox, v[3] + oy)
        lcx = v[0] + ox; lcy = v[1] + oy
        cx = v[2] + ox; cy = v[3] + oy
        prev = 'Q'
        break
      }
      case 'T': {
        v = nums(2); if (!v) return
        const x1 = prev === 'Q' || prev === 'T' ? 2 * cx - lcx : cx
        const y1 = prev === 'Q' || prev === 'T' ? 2 * cy - lcy : cy
        b.quadTo(x1, y1, v[0] + ox, v[1] + oy)
        lcx = x1; lcy = y1
        cx = v[0] + ox; cy = v[1] + oy
        prev = 'T'
        break
      }
      case 'A': {
        const r = nums(3); if (!r) return
        const f1 = flag(); if (f1 === null) return
        const f2 = flag(); if (f2 === null) return
        const e = nums(2); if (!e) return
        const ex = e[0] + ox, ey = e[1] + oy
        b.arcTo(r[0], r[1], r[2], f1, f2, ex, ey)
        cx = ex; cy = ey
        prev = 'A'
        break
      }
      default:
        return // unbekanntes Kommando
    }
  }
}
