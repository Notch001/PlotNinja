/**
 * Formbasiertes Nesting („Mehrfach platzieren“, „Kompakt anordnen“): reine Funktionen ohne DOM.
 *
 * Verfahren: Alle Formen werden auf ein Raster (Zellgröße ca. 0.5–2 mm, adaptiv) gebracht. Die belegten Zellen der
 * Matte liegen als Bit-Array vor (Uint32 je 32 Zellen); platzierte Formen werden um den Abstand aufgeweitet (Scheibe)
 * eingetragen. Jede Einheit wird in mehreren Drehungen gerastert (konservativ: jede Zelle, die die Form berührt) und per
 * First-Fit mit Zeilenscan (oben links beginnend) an die erste freie Stelle gesetzt; unter den Drehungen gewinnt die
 * mit der niedrigsten Unterkante. Größere Einheiten kommen zuerst. Gruppen sind starre Einheiten, nur x, y und
 * rotation ändern sich (über die vorhandenen Gruppen-Funktionen).
 *
 * Genauigkeit: Der Mindestabstand wird eingehalten (Raster ist konservativ, Aufweitung = Abstand + 1 Zelle); der
 * tatsächliche Abstand kann bis etwa 1–2 Zellen größer sein. Deterministisch; nur die Zeitbegrenzung hängt von der Uhr ab.
 */
import type { NestRotate, Part, Point, WorkArea } from '@shared/types'
import { NEST_MAX_COUNT } from '@shared/types'
import type { Box } from './geom'
import { duplicateParts, rotateParts, translateParts } from './group'
import { partPaths, unionBox, unitsOf } from './layout'

/* ---------- Typen ---------- */

/** Form einer Einheit in Arbeitsflächen-Koordinaten. */
export interface NestShape {
  /** Gefüllte Flächen: die Ringe einer Gruppe werden even-odd gefüllt (Löcher bleiben leer), die Gruppen vereinigt. */
  fills: Point[][][]
  /** Offene Linien: belegen nur die Zellen entlang der Linie. */
  strokes: Point[][]
}

export interface NestItem { shape: NestShape; copies: number }

export interface NestJob {
  width: number
  height: number
  /** Mindestabstand zwischen Teilen (mm). */
  gap: number
  /** Randabstand zur Matte (mm). */
  margin: number
  rotate: NestRotate
  /** Zeitbegrenzung der Rechnung in ms (danach bester Stand). */
  timeLimitMs: number
  obstacles: NestShape[]
  items: NestItem[]
  /** Zellgröße in mm (Standard: adaptiv). */
  cell?: number
}

export interface NestPlacement {
  item: number
  copy: number
  /** Drehung in Grad (im Uhrzeigersinn) um (cx, cy), relativ zur aktuellen Lage. */
  rotation: number
  cx: number
  cy: number
  /** Linke obere Ecke der (gedrehten) Form-Hülle auf der Matte. */
  x: number
  y: number
}

export interface NestResult {
  placements: NestPlacement[]
  placedPerItem: number[]
  /** Einheit ist (in keiner erlaubten Drehung) kleiner als die nutzbare Matte. */
  tooBig: boolean[]
  timedOut: boolean
  /** Belegte Fläche (neue Teile + Hindernisse) / Mattenfläche, 0–1. */
  utilization: number
  cell: number
  elapsedMs: number
}

/* ---------- Geometrie-Helfer ---------- */

function pointsBox(pts: Iterable<Point>): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of pts) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return x0 === Infinity ? null : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

function* shapePoints(s: NestShape): Generator<Point> {
  for (const g of s.fills) for (const r of g) yield* r
  for (const l of s.strokes) yield* l
}

export function shapeBox(s: NestShape): Box | null {
  return pointsBox(shapePoints(s))
}

function snapTrig(v: number): number {
  return Math.abs(v) < 1e-12 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-12 ? Math.sign(v) : v
}

function rotateShape(s: NestShape, cx: number, cy: number, deg: number): NestShape {
  if (!deg) return s
  const a = (deg * Math.PI) / 180
  const c = snapTrig(Math.cos(a)), sn = snapTrig(Math.sin(a))
  const rot = (p: Point): Point => {
    const dx = p.x - cx, dy = p.y - cy
    return { x: cx + dx * c - dy * sn, y: cy + dx * sn + dy * c }
  }
  return { fills: s.fills.map((g) => g.map((r) => r.map(rot))), strokes: s.strokes.map((l) => l.map(rot)) }
}

/* ---------- Raster ---------- */

interface Raster {
  w: number
  h: number
  /** Konservativ: Zellen, die die Form berühren. */
  cells: Uint8Array
  /** Nur Zellen, deren Mittelpunkt in der gefüllten Fläche liegt (für Flächenangaben). */
  fillCount: number
  fill: Uint8Array
}

function fillGroup(rings: Point[][], ox: number, oy: number, cell: number, w: number, h: number, dst: Uint8Array): void {
  const rows: (number[] | undefined)[] = new Array(h)
  for (const ring of rings) {
    const n = ring.length
    if (n < 3) continue
    for (let i = 0; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n]
      if (p.y === q.y) continue
      const a = p.y < q.y ? p : q, b = p.y < q.y ? q : p
      const j0 = Math.max(0, Math.ceil((a.y - oy) / cell - 0.5))
      const j1 = Math.min(h - 1, Math.ceil((b.y - oy) / cell - 0.5) - 1)
      if (j1 < j0) continue
      const inv = (b.x - a.x) / (b.y - a.y)
      for (let j = j0; j <= j1; j++) {
        const yc = oy + (j + 0.5) * cell
        const x = a.x + (yc - a.y) * inv
        const r = rows[j]
        if (r) r.push(x); else rows[j] = [x]
      }
    }
  }
  for (let j = 0; j < h; j++) {
    const r = rows[j]
    if (!r || r.length < 2) continue
    r.sort((m, n) => m - n)
    for (let k = 0; k + 1 < r.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((r[k] - ox) / cell - 0.5))
      const i1 = Math.min(w - 1, Math.ceil((r[k + 1] - ox) / cell - 0.5) - 1)
      for (let i = i0; i <= i1; i++) dst[j * w + i] = 1
    }
  }
}

/** Markiert alle Zellen, die die Strecke (in Zelleinheiten) berührt (Amanatides-Woo, am Fenster [0,w]×[0,h] beschnitten). */
function markEdge(ax: number, ay: number, bx: number, by: number, w: number, h: number, cells: Uint8Array): void {
  const dx = bx - ax, dy = by - ay
  let t0 = 0, t1 = 1
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0
    const r = q / p
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r } else { if (r < t0) return false; if (r < t1) t1 = r }
    return true
  }
  if (!clip(-dx, ax) || !clip(dx, w - ax) || !clip(-dy, ay) || !clip(dy, h - ay)) return
  const x0 = ax + t0 * dx, y0 = ay + t0 * dy, x1 = ax + t1 * dx, y1 = ay + t1 * dy
  const cl = (v: number, m: number): number => Math.min(m - 1, Math.max(0, Math.floor(v)))
  let x = cl(x0, w), y = cl(y0, h)
  const ex = cl(x1, w), ey = cl(y1, h)
  const ddx = x1 - x0, ddy = y1 - y0
  const sx = ddx > 0 ? 1 : -1, sy = ddy > 0 ? 1 : -1
  const tdx = ddx !== 0 ? 1 / Math.abs(ddx) : Infinity
  const tdy = ddy !== 0 ? 1 / Math.abs(ddy) : Infinity
  let tmx = ddx === 0 ? Infinity : (ddx > 0 ? x + 1 - x0 : x0 - x) * tdx
  let tmy = ddy === 0 ? Infinity : (ddy > 0 ? y + 1 - y0 : y0 - y) * tdy
  cells[y * w + x] = 1
  let n = Math.abs(ex - x) + Math.abs(ey - y)
  while (n-- > 0) {
    if (tmx < tmy) { x += sx; tmx += tdx } else { y += sy; tmy += tdy }
    if (x < 0 || y < 0 || x >= w || y >= h) break
    cells[y * w + x] = 1
  }
}

function rasterize(s: NestShape, ox: number, oy: number, cell: number, w: number, h: number): Raster {
  const fill = new Uint8Array(w * h)
  for (const g of s.fills) fillGroup(g, ox, oy, cell, w, h, fill)
  const cells = fill.slice()
  const toGrid = (p: Point): [number, number] => [(p.x - ox) / cell, (p.y - oy) / cell]
  for (const g of s.fills) {
    for (const ring of g) {
      const n = ring.length
      for (let i = 0; i < n; i++) {
        const [ax, ay] = toGrid(ring[i]), [bx, by] = toGrid(ring[(i + 1) % n])
        markEdge(ax, ay, bx, by, w, h, cells)
      }
    }
  }
  for (const l of s.strokes) {
    if (l.length === 1) { const [ax, ay] = toGrid(l[0]); markEdge(ax, ay, ax, ay, w, h, cells) }
    for (let i = 0; i + 1 < l.length; i++) {
      const [ax, ay] = toGrid(l[i]), [bx, by] = toGrid(l[i + 1])
      markEdge(ax, ay, bx, by, w, h, cells)
    }
  }
  let fillCount = 0
  for (let i = 0; i < fill.length; i++) fillCount += fill[i]
  return { w, h, cells, fill, fillCount }
}

/* ---------- Belegungsgitter der Matte ---------- */

class Grid {
  readonly rowWords: number
  readonly occ: Uint32Array
  constructor(readonly gw: number, readonly gh: number) {
    this.rowWords = ((gw + 31) >> 5) + 2
    this.occ = new Uint32Array((gh + 1) * this.rowWords)
  }

  setRun(row: number, x0: number, x1: number): void {
    if (row < 0 || row >= this.gh) return
    if (x0 < 0) x0 = 0
    if (x1 >= this.gw) x1 = this.gw - 1
    if (x1 < x0) return
    const base = row * this.rowWords
    const w0 = x0 >> 5, w1 = x1 >> 5
    const m0 = (0xffffffff << (x0 & 31)) >>> 0
    const m1 = (0xffffffff >>> (31 - (x1 & 31))) >>> 0
    if (w0 === w1) { this.occ[base + w0] |= m0 & m1; return }
    this.occ[base + w0] |= m0
    for (let k = w0 + 1; k < w1; k++) this.occ[base + k] = 0xffffffff
    this.occ[base + w1] |= m1
  }

  /** Trägt die Zellen (Versatz ox/oy im Gitter) um die Scheibe `stencil` aufgeweitet ein. */
  stamp(cells: Uint8Array, w: number, h: number, ox: number, oy: number, stencil: Int32Array): void {
    const R = stencil.length - 1
    for (let y = 0; y < h; y++) {
      let x = 0
      const rowBase = y * w
      while (x < w) {
        if (!cells[rowBase + x]) { x++; continue }
        const a = x
        while (x < w && cells[rowBase + x]) x++
        const b = x - 1
        for (let dy = -R; dy <= R; dy++) {
          const k = stencil[Math.abs(dy)]
          if (k < 0) continue
          this.setRun(oy + y + dy, ox + a - k, ox + b + k)
        }
      }
    }
  }
}

/** Halbe Breite der Scheibe je Zeilenabstand; r = 0 -> keine Aufweitung. Rückgabe[d] = -1: Zeile nicht betroffen. */
function makeStencil(r: number): Int32Array {
  const R = Math.ceil(r)
  const st = new Int32Array(R + 1)
  for (let d = 0; d <= R; d++) st[d] = r * r - d * d >= 0 ? Math.floor(Math.sqrt(r * r - d * d) + 1e-9) : -1
  return st
}

/* ---------- Kandidaten (Form in einer Drehung) ---------- */

interface Cand {
  rot: number
  w: number
  h: number
  raster: Raster
  nw1: number
  na: number
  rowIdx: Int32Array
  /** [shift][aktive Zeile][Wort] */
  sh: Uint32Array
  done: boolean
  py: number
  px: number
}

function buildCand(rot: number, r: Raster): Cand {
  const { w, h, cells } = r
  const nw1 = ((w + 30) >> 5) + 1
  const rows: { y: number; pop: number }[] = []
  for (let y = 0; y < h; y++) {
    let pop = 0
    for (let x = 0; x < w; x++) pop += cells[y * w + x]
    if (pop > 0) rows.push({ y, pop })
  }
  // Breiteste Zeile zuerst (scheitert am ehesten), Rest von oben nach unten
  let best = 0
  for (let i = 1; i < rows.length; i++) if (rows[i].pop > rows[best].pop) best = i
  const order = rows.length ? [rows[best], ...rows.filter((_, i) => i !== best)] : []
  const na = order.length
  const rowIdx = Int32Array.from(order.map((o) => o.y))
  const sh = new Uint32Array(32 * na * nw1)
  for (let a = 0; a < na; a++) {
    const y = rowIdx[a]
    for (let x = 0; x < w; x++) {
      if (!cells[y * w + x]) continue
      for (let s = 0; s < 32; s++) {
        const bit = x + s
        sh[(s * na + a) * nw1 + (bit >> 5)] |= (1 << (bit & 31)) >>> 0
      }
    }
  }
  return { rot, w, h, raster: r, nw1, na, rowIdx, sh, done: false, py: 0, px: 0 }
}

function fits(g: Grid, c: Cand, gx: number, gy: number): boolean {
  const off = gx >> 5
  const base0 = (gx & 31) * c.na * c.nw1
  const { occ, rowWords } = g
  const { sh, nw1, rowIdx } = c
  for (let a = 0; a < c.na; a++) {
    const m = (gy + rowIdx[a]) * rowWords + off
    const b = base0 + a * nw1
    for (let k = 0; k < nw1; k++) if (sh[b + k] & occ[m + k]) return false
  }
  return true
}

/* ---------- Engine ---------- */

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function angles(rotate: NestRotate): number[] {
  if (rotate === 'off') return [0]
  if (rotate === '90') return [0, 90, 180, 270]
  const out: number[] = []
  for (let a = 0; a < 360; a += 15) out.push(a)
  return out
}

/** Zellgröße: fein genug für die kleinste Einheit, grob genug für Speicher und Zeit. */
export function pickCell(usableW: number, usableH: number, smallest: number): number {
  const area = Math.max(1, usableW * usableH)
  let c = Math.min(2, Math.max(0.5, Math.sqrt(area / 400_000)))
  if (smallest > 0) c = Math.min(c, Math.max(0.5, smallest / 10))
  return Math.max(c, Math.sqrt(area / 900_000))
}

export function nest(job: NestJob, now: () => number = defaultNow): NestResult {
  const start = now()
  const deadline = start + job.timeLimitMs
  const items = job.items
  const placedPerItem = items.map(() => 0)
  const tooBig = items.map(() => false)
  const placements: NestPlacement[] = []
  const m = Math.max(0, job.margin)
  const uw = job.width - 2 * m, uh = job.height - 2 * m
  const finish = (cell: number, area: number, timedOut: boolean): NestResult => ({
    placements, placedPerItem, tooBig, timedOut, cell, elapsedMs: now() - start,
    utilization: job.width > 0 && job.height > 0 ? Math.min(1, area / (job.width * job.height)) : 0
  })
  if (uw <= 0 || uh <= 0) { tooBig.fill(true); return finish(1, 0, false) }

  const boxes = items.map((it) => shapeBox(it.shape))
  let smallest = Infinity
  for (const b of boxes) if (b) smallest = Math.min(smallest, Math.max(0.01, Math.min(b.width, b.height) || Math.max(b.width, b.height)))
  const cell = job.cell ?? pickCell(uw, uh, Number.isFinite(smallest) ? smallest : 0)
  const gw = Math.max(1, Math.floor(uw / cell + 1e-9)), gh = Math.max(1, Math.floor(uh / cell + 1e-9))
  const grid = new Grid(gw, gh)
  const ox = m, oy = m
  const r = job.gap > 0 ? job.gap / cell + 1 : 0
  const stencil = makeStencil(r)
  const R = stencil.length - 1
  const cellArea = cell * cell
  let area = 0

  // Hindernisse (im um R erweiterten Mattenfenster)
  for (const ob of job.obstacles) {
    const b = shapeBox(ob)
    if (!b) continue
    const i0 = Math.max(-R - 1, Math.floor((b.x - ox) / cell)), i1 = Math.min(gw + R + 1, Math.ceil((b.x + b.width - ox) / cell))
    const j0 = Math.max(-R - 1, Math.floor((b.y - oy) / cell)), j1 = Math.min(gh + R + 1, Math.ceil((b.y + b.height - oy) / cell))
    if (i1 < i0 || j1 < j0 || i1 < -R || j1 < -R || i0 > gw + R || j0 > gh + R) continue
    const w = Math.max(1, i1 - i0), h = Math.max(1, j1 - j0)
    const rs = rasterize(ob, ox + i0 * cell, oy + j0 * cell, cell, w, h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = i0 + x, gy = j0 + y
      if (rs.fill[y * w + x] && gx >= 0 && gy >= 0 && gx < gw && gy < gh) area += cellArea
    }
    grid.stamp(rs.cells, w, h, i0, j0, stencil)
  }

  // Reihenfolge: größere Einheiten zuerst (Hüllfläche), sonst Eingabereihenfolge
  const order = items.map((_, i) => i).filter((i) => boxes[i]).sort((a, b) => {
    const ba = boxes[a] as Box, bb = boxes[b] as Box
    return bb.width * bb.height - ba.width * ba.height || a - b
  })
  for (let i = 0; i < items.length; i++) if (!boxes[i]) tooBig[i] = true
  const rots = angles(job.rotate)
  let timedOut = false
  let aborted = false

  const scan = (c: Cand, maxBottom: number): { gx: number; gy: number } | null => {
    const maxY = gh - c.h, maxX = gw - c.w
    let y = c.py, x0 = c.px
    for (; y <= maxY; y++, x0 = 0) {
      if (y + c.h > maxBottom) { c.py = y; c.px = 0; return null }
      if ((y & 15) === 0 && now() > deadline) { aborted = true; c.py = y; c.px = x0; return null }
      for (let x = x0; x <= maxX; x++) {
        if (fits(grid, c, x, y)) { c.py = y; c.px = x; return { gx: x, gy: y } }
      }
    }
    c.py = maxY + 1; c.px = 0; c.done = true
    return null
  }

  outer:
  for (const idx of order) {
    const item = items[idx]
    const b = boxes[idx] as Box
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2
    const cands: Cand[] = []
    for (const rot of rots) {
      const rs = rotateShape(item.shape, cx, cy, rot)
      const rb = shapeBox(rs) as Box
      const w = Math.max(1, Math.ceil(rb.width / cell - 1e-9)), h = Math.max(1, Math.ceil(rb.height / cell - 1e-9))
      if (w > gw || h > gh) continue
      const ras = rasterize(rs, rb.x, rb.y, cell, w, h)
      if (cands.some((c) => c.w === w && c.h === h && c.raster.cells.every((v, i) => v === ras.cells[i]))) continue
      cands.push(buildCand(rot, ras))
    }
    if (!cands.length) { tooBig[idx] = true; continue }
    for (let copy = 0; copy < item.copies; copy++) {
      if (now() > deadline) { timedOut = true; break outer }
      let best: { c: Cand; gx: number; gy: number } | null = null
      for (const c of cands) {
        if (c.done) continue
        const found = scan(c, best ? best.gy + best.c.h : Infinity)
        if (aborted) { timedOut = true; break outer }
        if (!found) continue
        const bottom = found.gy + c.h
        if (!best || bottom < best.gy + best.c.h || (bottom === best.gy + best.c.h && found.gx < best.gx)) best = { c, gx: found.gx, gy: found.gy }
      }
      if (!best) break // passt kein weiteres Exemplar
      grid.stamp(best.c.raster.cells, best.c.w, best.c.h, best.gx, best.gy, stencil)
      area += best.c.raster.fillCount * cellArea
      placedPerItem[idx]++
      placements.push({ item: idx, copy, rotation: best.c.rot, cx, cy, x: ox + best.gx * cell, y: oy + best.gy * cell })
    }
  }
  return finish(cell, area, timedOut)
}

/* ---------- Anbindung an Teile ---------- */

/** Form einer Einheit aus Teilen. `holes`: Löcher bleiben frei (sonst wird die Außenhülle gefüllt). Schnittränder zählen immer als Fläche. */
export function buildShape(parts: Part[], holes: boolean): NestShape {
  const fills: Point[][][] = []
  const strokes: Point[][] = []
  for (const p of parts) {
    const solid: Point[][] = []
    for (const pl of partPaths(p)) {
      const pts = pl.points
      if (pts.length < 2) continue
      if (!pl.closed || pts.length < 3) strokes.push(pts)
      else if (p.role === 'border' || pl.filled === false) fills.push([pts])
      else solid.push(pts)
    }
    if (holes) { if (solid.length) fills.push(solid) } else for (const s of solid) fills.push([s])
  }
  if (!fills.length && !strokes.length) {
    const b = unionBox(parts)
    if (b) fills.push([[{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }]])
  }
  return { fills, strokes }
}

/** Setzt eine Einheit starr: erst um (cx, cy) drehen, dann so schieben, dass die Hülle bei (x, y) liegt. Geometrie bleibt unverändert. */
export function placeUnitAt(parts: Part[], pl: Pick<NestPlacement, 'rotation' | 'cx' | 'cy' | 'x' | 'y'>): Part[] {
  const rotated = pl.rotation ? rotateParts(parts, { x: pl.cx, y: pl.cy }, pl.rotation) : parts
  const b = shapeBox(buildShape(rotated, false))
  if (!b) return rotated
  return translateParts(rotated, pl.x - b.x, pl.y - b.y)
}

/** Linke obere Ecke der Hülle der Form nach der Drehung um (cx, cy) – für Vorschau-Transformationen (translate + rotate). */
export function rotatedOrigin(shape: NestShape, cx: number, cy: number, deg: number): { x: number; y: number } {
  const b = shapeBox(rotateShape(shape, cx, cy, deg))
  return b ? { x: b.x, y: b.y } : { x: cx, y: cy }
}

export interface NestOptions {
  gap: number
  margin: number
  rotate: NestRotate
  holes: boolean
  timeLimitMs?: number
}

export const NEST_PREVIEW_MS = 1500

/* ---------- Mehrfach platzieren ---------- */

export interface MultiOptions extends NestOptions {
  /** Anzahl neuer Kopien oder 'fill' (so viele wie passen). */
  count: number | 'fill'
  includeOriginal: boolean
}

export interface MultiPlan {
  /** Neue Lage des Originals (nur mit includeOriginal und wenn es passt). */
  original: NestPlacement | null
  copies: NestPlacement[]
  /** Gewünschte Kopien ('fill' = unbegrenzt). */
  requested: number | 'fill'
  utilization: number
  timedOut: boolean
  tooBig: boolean
  cell: number
}

export function buildMultiJob(all: Part[], template: Part[], wa: WorkArea, o: MultiOptions): NestJob {
  const ids = new Set(template.map((p) => p.id))
  const rest = o.includeOriginal ? all.filter((p) => !ids.has(p.id)) : all
  const n = o.count === 'fill' ? NEST_MAX_COUNT : Math.max(1, Math.min(NEST_MAX_COUNT, Math.round(o.count)))
  return {
    width: wa.width, height: wa.height, gap: o.gap, margin: o.margin, rotate: o.rotate,
    timeLimitMs: o.timeLimitMs ?? NEST_PREVIEW_MS,
    obstacles: rest.map((p) => buildShape([p], o.holes)),
    items: [{ shape: buildShape(template, o.holes), copies: n + (o.includeOriginal ? 1 : 0) }]
  }
}

export function interpretMulti(res: NestResult, o: MultiOptions): MultiPlan {
  let list = res.placements
  let original: NestPlacement | null = null
  if (o.includeOriginal && list.length) { original = list[0]; list = list.slice(1) }
  return { original, copies: list, requested: o.count, utilization: res.utilization, timedOut: res.timedOut, tooBig: res.tooBig[0] === true, cell: res.cell }
}

/** Wendet einen Plan an: das Original wird verschoben/gedreht, die Kopien entstehen mit neuen ids/groupIds (duplicateParts). */
export function applyMulti(template: Part[], plan: MultiPlan): { original: Part[] | null; copies: Part[]; units: Part[][] } {
  const original = plan.original ? placeUnitAt(template, plan.original) : null
  const units = plan.copies.map((pl) => placeUnitAt(duplicateParts(template), pl))
  return { original, copies: units.flat(), units }
}

/** Komplett synchron (Tests, Fallback ohne Worker). */
export function nestMultiple(all: Part[], template: Part[], wa: WorkArea, o: MultiOptions, now?: () => number): { plan: MultiPlan; original: Part[] | null; copies: Part[]; units: Part[][] } {
  const plan = interpretMulti(nest(buildMultiJob(all, template, wa, o), now), o)
  return { plan, ...applyMulti(template, plan) }
}

/* ---------- Kompakt anordnen ---------- */

export interface ArrangeJob {
  job: NestJob
  /** Indizes (in `parts`) je Einheit; Reihenfolge = job.items. */
  groups: number[][]
}

/** `ids` = zu ordnende Teile (null = alle); alle anderen Teile sind Hindernisse. */
export function buildArrangeJob(parts: Part[], ids: string[] | null, wa: WorkArea, o: NestOptions): ArrangeJob {
  const want = ids ? new Set(ids) : null
  const movable: number[] = [], fixed: Part[] = []
  parts.forEach((p, i) => { if (!want || want.has(p.id)) movable.push(i); else fixed.push(p) })
  const units = unitsOf(movable.map((i) => parts[i]))
  const groups = units.map((u) => u.indices.map((k) => movable[k]))
  return {
    groups,
    job: {
      width: wa.width, height: wa.height, gap: o.gap, margin: o.margin, rotate: o.rotate, timeLimitMs: o.timeLimitMs ?? NEST_PREVIEW_MS,
      obstacles: fixed.map((p) => buildShape([p], o.holes)),
      items: groups.map((g) => ({ shape: buildShape(g.map((i) => parts[i]), o.holes), copies: 1 }))
    }
  }
}

export interface ArrangeOutcome { parts: Part[]; placed: number; unplaced: number }

/** Setzt das Ergebnis um. Einheiten, die nicht passen, kommen in Reihen unterhalb der Matte (rot markiert) – nichts geht verloren. */
export function applyArrange(parts: Part[], groups: number[][], res: NestResult, wa: WorkArea, o: Pick<NestOptions, 'gap' | 'margin'>): ArrangeOutcome {
  const out = parts.map((p) => p)
  const done = new Set<number>()
  for (const pl of res.placements) {
    const g = groups[pl.item]
    const moved = placeUnitAt(g.map((i) => parts[i]), pl)
    g.forEach((i, k) => { out[i] = moved[k] })
    done.add(pl.item)
  }
  const left = groups.map((_, k) => k).filter((k) => !done.has(k))
  let x = o.margin, y = wa.height + 10, rowH = 0
  for (const k of left) {
    const g = groups[k]
    const b = unionBox(g.map((i) => parts[i]))
    if (!b) continue
    if (x > o.margin && x + b.width > wa.width - o.margin) { x = o.margin; y += rowH + Math.max(o.gap, 3); rowH = 0 }
    const moved = translateParts(g.map((i) => parts[i]), x - b.x, y - b.y)
    g.forEach((i, j) => { out[i] = moved[j] })
    x += b.width + Math.max(o.gap, 3)
    rowH = Math.max(rowH, b.height)
  }
  return { parts: out, placed: done.size, unplaced: left.length }
}

export function nestArrange(parts: Part[], wa: WorkArea, o: NestOptions, ids: string[] | null = null, now?: () => number): ArrangeOutcome & { result: NestResult } {
  const { job, groups } = buildArrangeJob(parts, ids, wa, o)
  const result = nest(job, now)
  return { ...applyArrange(parts, groups, result, wa, o), result }
}
