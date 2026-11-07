import DxfParser from 'dxf-parser'
import type { Part, Point, Polyline } from '@shared/types'
import { finishVectorImport, type VectorImportOptions } from './importCommon'

/* ---------------------------------------------------------------------------------------------
 * DXF-Import: LINE, LWPOLYLINE/POLYLINE (inkl. Bulge), CIRCLE, ARC, ELLIPSE, SPLINE, INSERT (Blöcke).
 * Einheiten aus $INSUNITS (Standard mm), Y-Achse wird umgedreht (DXF: y nach oben, App: y nach unten).
 * Lose Linien/Bögen werden an den Endpunkten (Toleranz 0,01 mm) zu Polylinien verbunden.
 * ------------------------------------------------------------------------------------------- */

type Matrix = [number, number, number, number, number, number]
type Ent = Record<string, any> // dxf-parser liefert je nach Typ unterschiedliche Felder

/** Verbindungstoleranz der Endpunkte (mm). */
export const JOIN_TOL_MM = 0.01
/** Maximale Sehnenabweichung beim Zerlegen von Bögen (mm). */
const ARC_TOL_MM = 0.05
const MAX_BLOCK_DEPTH = 8
const MAX_ARRAY_INSTANCES = 10000

/** mm je Zeicheneinheit nach $INSUNITS. 0 = ohne Einheit -> mm. */
const UNIT_MM: Record<number, number> = {
  0: 1, 1: 25.4, 2: 304.8, 3: 1609344, 4: 1, 5: 10, 6: 1000, 7: 1_000_000,
  8: 0.0000254, 9: 0.0254, 10: 914.4, 11: 1e-7, 12: 1e-6, 13: 0.001, 14: 100, 15: 10_000, 16: 100_000
}

const IGNORED_TYPES: Record<string, string> = {
  TEXT: 'Text', MTEXT: 'Text', ATTDEF: 'Text', ATTRIB: 'Text', HATCH: 'Schraffuren', DIMENSION: 'Bemaßungen',
  IMAGE: 'Bilder', SOLID: 'Flächen (SOLID)', '3DFACE': '3D-Flächen', LEADER: 'Hinweislinien', MLEADER: 'Hinweislinien'
}

const mulM = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]
]
const apply = (m: Matrix, x: number, y: number): Point => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })
/** Maßstab der Matrix (für die Bogenauflösung). */
const scaleOf = (m: Matrix): number => Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]), 1e-9)

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const pt2 = (p: any): { x: number; y: number } | null => (p && fin(p.x) && fin(p.y) ? { x: p.x, y: p.y } : null)

/** Segmentzahl für einen Bogen mit Radius r (mm) und Öffnungswinkel sweep (rad). */
function arcSteps(r: number, sweep: number): number {
  const rr = Math.max(Math.abs(r), 1e-6)
  const stepAngle = rr <= ARC_TOL_MM ? Math.PI / 2 : 2 * Math.acos(Math.max(0, 1 - ARC_TOL_MM / rr))
  return Math.min(2000, Math.max(Math.ceil(Math.abs(sweep) / Math.max(stepAngle, 1e-3)), Math.ceil(Math.abs(sweep) / (Math.PI / 12)), 2))
}

/** Rohkontur im Zeichnungsraum (nach Transformation in mm, y bereits umgedreht). */
interface Raw { points: Point[]; closed: boolean }

interface Ctx {
  blocks: Record<string, any>
  layerOk: (name: string | undefined) => boolean
  out: Raw[]
  ignored: Map<string, number>
  unsupported: Set<string>
}

/** Extrusionsrichtung z < 0 spiegelt die x-Achse (OCS) – nur für Entitäten mit eigener Ebene relevant. */
function flipX(e: Ent): boolean {
  const z = e.extrusionDirectionZ ?? e.extrusionDirection?.z
  return fin(z) && z < 0
}

function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, sc: number): Point[] {
  let sweep = a1 - a0
  while (sweep <= 0) sweep += Math.PI * 2
  if (sweep > Math.PI * 2) sweep = Math.PI * 2
  const n = arcSteps(r * sc, sweep)
  const pts: Point[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
  }
  return pts
}

/** Bulge-Segment p0 -> p1 als Punktfolge (ohne p0, mit p1). */
function bulgePoints(p0: { x: number; y: number }, p1: { x: number; y: number }, bulge: number, sc: number): Point[] {
  const dx = p1.x - p0.x, dy = p1.y - p0.y
  const L = Math.hypot(dx, dy)
  if (!fin(bulge) || Math.abs(bulge) < 1e-9 || L < 1e-12) return [{ x: p1.x, y: p1.y }]
  const theta = 4 * Math.atan(bulge) // vorzeichenbehafteter Öffnungswinkel (positiv = gegen den Uhrzeigersinn)
  const h = (L / 2) * ((1 - bulge * bulge) / (2 * bulge))
  const cx = (p0.x + p1.x) / 2 + (-dy / L) * h
  const cy = (p0.y + p1.y) / 2 + (dx / L) * h
  const r = Math.hypot(p0.x - cx, p0.y - cy)
  const a0 = Math.atan2(p0.y - cy, p0.x - cx)
  const n = arcSteps(r * sc, theta)
  const pts: Point[] = []
  for (let i = 1; i <= n; i++) {
    if (i === n) { pts.push({ x: p1.x, y: p1.y }); break }
    const a = a0 + (theta * i) / n
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
  }
  return pts
}

/** De-Boor-Auswertung einer (nicht-rationalen) B-Spline-Kurve. */
function splinePoints(e: Ent): { pts: { x: number; y: number }[]; closed: boolean } | null {
  const cps = ((e.controlPoints ?? []) as any[]).map(pt2).filter((p): p is { x: number; y: number } => !!p)
  const fits = ((e.fitPoints ?? []) as any[]).map(pt2).filter((p): p is { x: number; y: number } => !!p)
  const closed = !!e.closed
  if (cps.length < 2) {
    return fits.length >= 2 ? { pts: fits, closed } : null
  }
  const degree = Math.max(1, Math.min(fin(e.degreeOfSplineCurve) ? Math.round(e.degreeOfSplineCurve) : 3, cps.length - 1))
  let knots: number[] = Array.isArray(e.knotValues) ? (e.knotValues as number[]).filter(fin) : []
  const need = cps.length + degree + 1
  if (knots.length !== need) {
    // Ungültiger Knotenvektor: geklemmt-gleichmäßig ersetzen
    knots = []
    const inner = need - 2 * (degree + 1)
    for (let i = 0; i <= degree; i++) knots.push(0)
    for (let i = 1; i <= inner; i++) knots.push(i)
    for (let i = 0; i <= degree; i++) knots.push(inner + 1)
  }
  const t0 = knots[degree], t1 = knots[cps.length]
  if (!(t1 > t0)) return { pts: cps, closed }
  const samples = Math.min(4000, Math.max(32, cps.length * 12))
  const out: { x: number; y: number }[] = []
  for (let s = 0; s <= samples; s++) {
    const t = s === samples ? t1 : t0 + ((t1 - t0) * s) / samples
    // Knotenintervall finden
    let k = degree
    while (k < cps.length - 1 && t >= knots[k + 1]) k++
    const d = cps.slice(k - degree, k + 1).map((p) => ({ x: p.x, y: p.y }))
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const i = k - degree + j
        const den = knots[i + degree - r + 1] - knots[i]
        const a = den === 0 ? 0 : (t - knots[i]) / den
        d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y }
      }
    }
    out.push(d[degree])
  }
  return { pts: out, closed }
}

function emit(ctx: Ctx, pts: Point[], closed: boolean): void {
  if (pts.length >= 2) ctx.out.push({ points: pts, closed })
}

function processEntity(ctx: Ctx, e: Ent, m: Matrix, depth: number): void {
  if (!e || typeof e.type !== 'string') return
  if (e.visible === false || e.inPaperSpace) return
  if (!ctx.layerOk(e.layer)) return
  const sc = scaleOf(m)
  const tf = (pts: { x: number; y: number }[]): Point[] => pts.map((p) => apply(m, p.x, p.y))

  switch (e.type) {
    case 'LINE': {
      const v = (e.vertices ?? []) as any[]
      const a = pt2(v[0]), b = pt2(v[1])
      if (a && b) emit(ctx, tf([a, b]), false)
      break
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const fx = e.type === 'LWPOLYLINE' && flipX(e)
      const vs = ((e.vertices ?? []) as any[])
        .filter((v) => pt2(v))
        .map((v) => ({ x: fx ? -v.x : v.x, y: v.y, bulge: fin(v.bulge) ? (fx ? -v.bulge : v.bulge) : 0 }))
      if (vs.length < 2) break
      const closed = !!e.shape
      const pts: { x: number; y: number }[] = [{ x: vs[0].x, y: vs[0].y }]
      const segs = closed ? vs.length : vs.length - 1
      for (let i = 0; i < segs; i++) {
        const a = vs[i], b = vs[(i + 1) % vs.length]
        pts.push(...bulgePoints(a, b, a.bulge, sc))
      }
      if (closed) pts.pop() // letzter Punkt == Startpunkt
      emit(ctx, tf(pts), closed)
      break
    }
    case 'CIRCLE': {
      const c = pt2(e.center)
      if (!c || !fin(e.radius) || e.radius <= 0) break
      const cx = flipX(e) ? -c.x : c.x
      const pts = arcPoints(cx, c.y, e.radius, 0, Math.PI * 2, sc)
      pts.pop() // Start == Ende
      emit(ctx, tf(pts), true)
      break
    }
    case 'ARC': {
      const c = pt2(e.center)
      if (!c || !fin(e.radius) || e.radius <= 0 || !fin(e.startAngle) || !fin(e.endAngle)) break
      let a0 = e.startAngle, a1 = e.endAngle
      let cx = c.x
      if (flipX(e)) { cx = -c.x; const s0 = Math.PI - a1, s1 = Math.PI - a0; a0 = s0; a1 = s1 }
      emit(ctx, tf(arcPoints(cx, c.y, e.radius, a0, a1, sc)), false)
      break
    }
    case 'ELLIPSE': {
      const c = pt2(e.center), maj = pt2(e.majorAxisEndPoint)
      if (!c || !maj || !fin(e.axisRatio)) break
      const ratio = e.axisRatio
      const min = { x: -maj.y * ratio, y: maj.x * ratio }
      let t0 = fin(e.startAngle) ? e.startAngle : 0
      let t1 = fin(e.endAngle) ? e.endAngle : Math.PI * 2
      let sweep = t1 - t0
      while (sweep <= 0) sweep += Math.PI * 2
      const full = Math.abs(sweep - Math.PI * 2) < 1e-6 || Math.abs(sweep) < 1e-9
      if (full) sweep = Math.PI * 2
      const rMax = Math.max(Math.hypot(maj.x, maj.y), Math.hypot(min.x, min.y))
      const n = arcSteps(rMax * sc, sweep)
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= n; i++) {
        const t = t0 + (sweep * i) / n
        pts.push({ x: c.x + Math.cos(t) * maj.x + Math.sin(t) * min.x, y: c.y + Math.cos(t) * maj.y + Math.sin(t) * min.y })
      }
      if (full) pts.pop()
      emit(ctx, tf(pts), full)
      break
    }
    case 'SPLINE': {
      const s = splinePoints(e)
      if (!s) break
      const pts = tf(s.pts)
      let closed = s.closed
      if (closed && pts.length > 2) {
        const a = pts[0], b = pts[pts.length - 1]
        if (Math.hypot(a.x - b.x, a.y - b.y) < JOIN_TOL_MM) pts.pop()
      } else closed = false
      emit(ctx, pts, closed)
      break
    }
    case 'INSERT': {
      if (depth >= MAX_BLOCK_DEPTH) { ctx.unsupported.add('zu tief verschachtelte Blöcke'); break }
      const block = ctx.blocks[e.name]
      const pos = pt2(e.position)
      if (!block || !pos || !Array.isArray(block.entities)) break
      const base = pt2(block.position) ?? { x: 0, y: 0 }
      const sx = fin(e.xScale) && e.xScale !== 0 ? e.xScale : 1
      const sy = fin(e.yScale) && e.yScale !== 0 ? e.yScale : 1
      const rot = ((fin(e.rotation) ? e.rotation : 0) * Math.PI) / 180
      const cos = Math.cos(rot), sin = Math.sin(rot)
      const cols = Math.min(Math.max(1, Math.round(e.columnCount ?? 1)), MAX_ARRAY_INSTANCES)
      const rows = Math.min(Math.max(1, Math.round(e.rowCount ?? 1)), MAX_ARRAY_INSTANCES)
      const cs = fin(e.columnSpacing) ? e.columnSpacing : 0
      const rs = fin(e.rowSpacing) ? e.rowSpacing : 0
      let count = 0
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (++count > MAX_ARRAY_INSTANCES) return
          // Instanz-Matrix: p' = pos + Spalten/Zeilen-Versatz (gedreht) + R * S * (p - base)
          const ox = cs * c, oy = rs * r
          const tx = pos.x + cos * ox - sin * oy
          const ty = pos.y + sin * ox + cos * oy
          const inst: Matrix = [cos * sx, sin * sx, -sin * sy, cos * sy, tx - (cos * sx * base.x - sin * sy * base.y), ty - (sin * sx * base.x + cos * sy * base.y)]
          const mm = mulM(m, inst)
          for (const be of block.entities as Ent[]) processEntity(ctx, be, mm, depth + 1)
        }
      }
      break
    }
    default: {
      const label = IGNORED_TYPES[e.type]
      if (label) ctx.ignored.set(label, (ctx.ignored.get(label) ?? 0) + 1)
    }
  }
}

/* ---------------------------------------------------------------- Verbinden */

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/** Fügt offene Konturen, deren Endpunkte näher als `tol` beieinander liegen, zu Polylinien zusammen. */
export function joinContours(raws: Raw[], tol = JOIN_TOL_MM): Raw[] {
  const closedOnes = raws.filter((r) => r.closed)
  const open = raws.filter((r) => !r.closed && r.points.length >= 2)
  const cell = Math.max(tol * 4, 1e-6)
  const key = (x: number, y: number): string => `${Math.floor(x / cell)},${Math.floor(y / cell)}`
  // Raster der Endpunkte: key -> [index, atStart]
  const grid = new Map<string, { i: number; start: boolean }[]>()
  const add = (i: number, start: boolean, p: Point): void => {
    const k = key(p.x, p.y)
    const l = grid.get(k)
    if (l) l.push({ i, start }); else grid.set(k, [{ i, start }])
  }
  open.forEach((r, i) => { add(i, true, r.points[0]); add(i, false, r.points[r.points.length - 1]) })
  const used = new Array<boolean>(open.length).fill(false)

  const findNext = (p: Point): { i: number; start: boolean } | null => {
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell)
    let best: { i: number; start: boolean } | null = null
    let bestD = Infinity
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const l = grid.get(`${cx + dx},${cy + dy}`)
        if (!l) continue
        for (const c of l) {
          if (used[c.i]) continue
          const q = c.start ? open[c.i].points[0] : open[c.i].points[open[c.i].points.length - 1]
          const d = dist(p, q)
          if (d <= tol && d < bestD) { best = c; bestD = d }
        }
      }
    }
    return best
  }

  const result: Raw[] = [...closedOnes]
  for (let s = 0; s < open.length; s++) {
    if (used[s]) continue
    used[s] = true
    let pts = open[s].points.slice()
    // am Ende anfügen
    for (;;) {
      const nx = findNext(pts[pts.length - 1])
      if (!nx) break
      used[nx.i] = true
      const seg = nx.start ? open[nx.i].points : open[nx.i].points.slice().reverse()
      pts = pts.concat(seg.slice(1))
    }
    // am Anfang anfügen
    for (;;) {
      const nx = findNext(pts[0])
      if (!nx) break
      used[nx.i] = true
      const seg = nx.start ? open[nx.i].points.slice().reverse() : open[nx.i].points
      pts = seg.slice(0, -1).concat(pts)
    }
    let closed = false
    if (pts.length >= 4 && dist(pts[0], pts[pts.length - 1]) <= tol) { pts.pop(); closed = true }
    else if (pts.length === 3 && dist(pts[0], pts[2]) <= tol) { pts = pts.slice(0, 2) }
    result.push({ points: pts, closed })
  }
  return result
}

/* ------------------------------------------------------------------ Import */

function unitFactor(header: Record<string, any> | undefined): number {
  const v = header?.['$INSUNITS']
  const code = fin(v) ? Math.round(v) : 0
  return UNIT_MM[code] ?? 1
}

/**
 * Liest eine DXF-Datei (ASCII) und liefert Bauteile (ohne `split`: genau eines). Wirft bei kaputten
 * oder leeren Dateien einen Error mit deutscher Meldung. Weld ist hier standardmäßig AUS.
 */
export function importDxf(text: string, fileName: string, sourcePath: string, opts?: VectorImportOptions): Part[] {
  if (/^\s*AutoCAD Binary DXF/.test(text.slice(0, 40))) throw new Error('Binäre DXF-Dateien werden nicht unterstützt (bitte als ASCII-DXF speichern).')
  let dxf: any
  try {
    dxf = new DxfParser().parseSync(text)
  } catch (e) {
    throw new Error('Die Datei ist keine gültige DXF-Datei (' + (e instanceof Error ? e.message : String(e)) + ').')
  }
  if (!dxf || !Array.isArray(dxf.entities)) throw new Error('Die Datei ist keine gültige DXF-Datei (keine Zeichnungsdaten gefunden).')

  const layers: Record<string, any> = dxf.tables?.layer?.layers ?? {}
  const layerOk = (name: string | undefined): boolean => {
    const l = name ? layers[name] : undefined
    return !l || (l.visible !== false && !l.frozen)
  }
  const ctx: Ctx = { blocks: dxf.blocks ?? {}, layerOk, out: [], ignored: new Map(), unsupported: new Set() }
  const u = unitFactor(dxf.header)
  const base: Matrix = [u, 0, 0, -u, 0, 0] // Einheiten -> mm, y umdrehen
  for (const e of dxf.entities as Ent[]) processEntity(ctx, e, base, 0)

  const joined = joinContours(ctx.out)
  const paths: Polyline[] = joined.map((r) => ({ points: r.points, closed: r.closed }))

  if (opts?.onNotice) {
    if (ctx.ignored.size) {
      const list = Array.from(new Set(ctx.ignored.keys())).join(', ')
      opts.onNotice(`„${fileName}“: ${list} in der DXF-Datei werden nicht geschnitten und wurden ignoriert`)
    }
    if (ctx.unsupported.size) opts.onNotice(`„${fileName}“: ${Array.from(ctx.unsupported).join(', ')} wurden ignoriert`)
  }
  return finishVectorImport(paths, fileName, sourcePath, { split: opts?.split, weld: opts?.weld ?? false },
    'Die DXF-Datei enthält keine schneidbaren Konturen (nur Text, Bemaßungen oder leere Zeichnung).')
}
