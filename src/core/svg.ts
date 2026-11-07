import { XMLParser } from 'fast-xml-parser'
import type { Part, Polyline } from '@shared/types'
import {
  IDENTITY, boxContains, mul, pathsBox, polygonArea, polylineInside, pointsBox,
  type Box, type Matrix
} from './geom'
import { PathBuilder, parsePathData } from './pathdata'
import { uid } from './uid'

const MM_PER_PX = 25.4 / 96
const MIN_PART_EDGE_MM = 0.5
const KAPPA = 0.5522847498307936

type XNode = Record<string, any>

interface Ctx {
  ids: Map<string, XNode>
  out: Polyline[]
  depth: number
}

/* ---------------------------------------------------------------- XML-Hilfen */

function tagOf(node: XNode): string | null {
  for (const k of Object.keys(node)) if (k !== ':@') return k
  return null
}
function attrsOf(node: XNode): Record<string, string> {
  return (node[':@'] as Record<string, string>) ?? {}
}
function childrenOf(node: XNode): XNode[] {
  const t = tagOf(node)
  const c = t ? node[t] : null
  return Array.isArray(c) ? (c as XNode[]) : []
}

function indexIds(nodes: XNode[], ids: Map<string, XNode>): void {
  for (const n of nodes) {
    const t = tagOf(n)
    if (!t || t === '#text') continue
    const id = attrsOf(n).id
    if (id && !ids.has(id)) ids.set(id, n)
    indexIds(childrenOf(n), ids)
  }
}

/* ------------------------------------------------------------ Attribut-Parser */

function num(v: string | undefined, def = 0): number {
  if (v === undefined) return def
  const f = parseFloat(v)
  return Number.isFinite(f) ? f : def
}

/** "12mm" -> mm; null bei fehlender/prozentualer Angabe. */
function lengthToMm(v: string | undefined): number | null {
  if (!v) return null
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)\s*$/.exec(v)
  if (!m) return null
  const val = parseFloat(m[1])
  switch (m[2].toLowerCase()) {
    case '': case 'px': return val * MM_PER_PX
    case 'mm': return val
    case 'cm': return val * 10
    case 'in': return val * 25.4
    case 'pt': return (val * 25.4) / 72
    case 'pc': return (val * 25.4) / 6
    case 'q': return val / 4
    case 'em': return val * 16 * MM_PER_PX
    case 'ex': return val * 8 * MM_PER_PX
    default: return null // %
  }
}

/** Länge in Benutzereinheiten (px), für verschachtelte svg/use. */
function lengthToUser(v: string | undefined): number | null {
  const mm = lengthToMm(v)
  return mm === null ? null : mm / MM_PER_PX
}

function parseViewBox(v: string | undefined): [number, number, number, number] | null {
  if (!v) return null
  const p = v.trim().split(/[\s,]+/).map(Number)
  if (p.length !== 4 || p.some((x) => !Number.isFinite(x)) || p[2] <= 0 || p[3] <= 0) return null
  return [p[0], p[1], p[2], p[3]]
}

export function parseTransform(s: string | undefined): Matrix {
  let m: Matrix = IDENTITY
  if (!s) return m
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  let r: RegExpExecArray | null
  while ((r = re.exec(s))) {
    const a = r[2].trim().split(/[\s,]+/).filter((x) => x !== '').map(Number)
    if (a.some((x) => !Number.isFinite(x))) continue
    let t: Matrix | null = null
    switch (r[1]) {
      case 'matrix':
        if (a.length === 6) t = [a[0], a[1], a[2], a[3], a[4], a[5]]
        break
      case 'translate':
        if (a.length >= 1) t = [1, 0, 0, 1, a[0], a[1] ?? 0]
        break
      case 'scale':
        if (a.length >= 1) t = [a[0], 0, 0, a[1] ?? a[0], 0, 0]
        break
      case 'rotate':
        if (a.length === 1 || a.length === 3) {
          const rad = (a[0] * Math.PI) / 180
          const c = Math.cos(rad), sn = Math.sin(rad)
          const rot: Matrix = [c, sn, -sn, c, 0, 0]
          if (a.length === 3) {
            t = mul(mul([1, 0, 0, 1, a[1], a[2]], rot), [1, 0, 0, 1, -a[1], -a[2]])
          } else t = rot
        }
        break
      case 'skewX':
        if (a.length === 1) t = [1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0]
        break
      case 'skewY':
        if (a.length === 1) t = [1, Math.tan((a[0] * Math.PI) / 180), 0, 1, 0, 0]
        break
    }
    if (t) m = mul(m, t)
  }
  return m
}

function isHidden(a: Record<string, string>): boolean {
  if ((a.display ?? '').trim() === 'none') return true
  if (a.style && /(^|;)\s*display\s*:\s*none/i.test(a.style)) return true
  return false
}

/* ----------------------------------------------------------------- Formen */

function pointsAttr(s: string | undefined): number[] {
  if (!s) return []
  return (s.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number)
}

function emitEllipse(b: PathBuilder, cx: number, cy: number, rx: number, ry: number): void {
  const kx = rx * KAPPA, ky = ry * KAPPA
  b.moveTo(cx + rx, cy)
  b.cubicTo(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry)
  b.cubicTo(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy)
  b.cubicTo(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry)
  b.cubicTo(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy)
  b.close()
}

function shapeToPaths(tag: string, a: Record<string, string>, m: Matrix): Polyline[] {
  const b = new PathBuilder(m)
  switch (tag) {
    case 'path':
      if (a.d) parsePathData(a.d, b)
      break
    case 'rect': {
      const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height)
      if (w <= 0 || h <= 0) return []
      let rx = a.rx !== undefined ? num(a.rx) : NaN
      let ry = a.ry !== undefined ? num(a.ry) : NaN
      if (Number.isNaN(rx) && Number.isNaN(ry)) { rx = 0; ry = 0 }
      else if (Number.isNaN(rx)) rx = ry
      else if (Number.isNaN(ry)) ry = rx
      rx = Math.min(Math.max(rx, 0), w / 2)
      ry = Math.min(Math.max(ry, 0), h / 2)
      if (rx === 0 || ry === 0) {
        b.moveTo(x, y); b.lineTo(x + w, y); b.lineTo(x + w, y + h); b.lineTo(x, y + h); b.close()
      } else {
        b.moveTo(x + rx, y)
        b.lineTo(x + w - rx, y)
        b.arcTo(rx, ry, 0, false, true, x + w, y + ry)
        b.lineTo(x + w, y + h - ry)
        b.arcTo(rx, ry, 0, false, true, x + w - rx, y + h)
        b.lineTo(x + rx, y + h)
        b.arcTo(rx, ry, 0, false, true, x, y + h - ry)
        b.lineTo(x, y + ry)
        b.arcTo(rx, ry, 0, false, true, x + rx, y)
        b.close()
      }
      break
    }
    case 'circle': {
      const r = num(a.r)
      if (r <= 0) return []
      emitEllipse(b, num(a.cx), num(a.cy), r, r)
      break
    }
    case 'ellipse': {
      const rx = num(a.rx), ry = num(a.ry)
      if (rx <= 0 || ry <= 0) return []
      emitEllipse(b, num(a.cx), num(a.cy), rx, ry)
      break
    }
    case 'line':
      b.moveTo(num(a.x1), num(a.y1))
      b.lineTo(num(a.x2), num(a.y2))
      break
    case 'polyline':
    case 'polygon': {
      const v = pointsAttr(a.points)
      if (v.length < 4) return []
      b.moveTo(v[0], v[1])
      for (let i = 2; i + 1 < v.length; i += 2) b.lineTo(v[i], v[i + 1])
      if (tag === 'polygon') b.close()
      break
    }
  }
  return b.finish().filter((p) => p.points.length >= 2)
}

/* --------------------------------------------------------------- Traversal */

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])
const CONTAINERS = new Set(['g', 'a', 'switch'])

/** Matrix für eine (verschachtelte) svg/symbol-Viewport-Angabe in Benutzereinheiten. */
function viewportMatrix(a: Record<string, string>, extraW?: string, extraH?: string): Matrix {
  const x = lengthToUser(a.x) ?? 0
  const y = lengthToUser(a.y) ?? 0
  let m: Matrix = [1, 0, 0, 1, x, y]
  const vb = parseViewBox(a.viewBox)
  const w = lengthToUser(a.width ?? extraW)
  const h = lengthToUser(a.height ?? extraH)
  if (vb && w && h) {
    const s = Math.min(w / vb[2], h / vb[3])
    const tx = (w - vb[2] * s) / 2, ty = (h - vb[3] * s) / 2
    m = mul(m, [s, 0, 0, s, tx - vb[0] * s, ty - vb[1] * s])
  } else if (vb) {
    m = mul(m, [1, 0, 0, 1, -vb[0], -vb[1]])
  }
  return m
}

function walk(nodes: XNode[], m: Matrix, ctx: Ctx): void {
  for (const n of nodes) {
    const tag = tagOf(n)
    if (!tag || tag === '#text' || tag.startsWith('?') || tag.startsWith('!')) continue
    const a = attrsOf(n)
    if (isHidden(a)) continue
    const nm = mul(m, parseTransform(a.transform))
    if (SHAPES.has(tag)) {
      for (const p of shapeToPaths(tag, a, nm)) ctx.out.push(p)
    } else if (CONTAINERS.has(tag)) {
      walk(childrenOf(n), nm, ctx)
    } else if (tag === 'svg' || tag === 'symbol') {
      // verschachteltes svg (Root wird separat behandelt)
      if (tag === 'symbol') continue // nur über <use>
      walk(childrenOf(n), mul(nm, viewportMatrix(a)), ctx)
    } else if (tag === 'use') {
      if (ctx.depth > 12) continue
      const href = a.href ?? a['xlink:href']
      if (!href || !href.startsWith('#')) continue
      const target = ctx.ids.get(href.slice(1))
      if (!target) continue
      const um = mul(nm, [1, 0, 0, 1, lengthToUser(a.x) ?? 0, lengthToUser(a.y) ?? 0])
      const tt = tagOf(target)
      ctx.depth++
      if (tt === 'symbol' || tt === 'svg') {
        const ta = attrsOf(target)
        if (!isHidden(ta)) {
          walk(childrenOf(target), mul(um, viewportMatrix(ta, a.width, a.height)), ctx)
        }
      } else {
        // das referenzierte Element selbst rendern (auch wenn es in <defs> liegt)
        walk([target], um, ctx)
      }
      ctx.depth--
    }
    // defs, clipPath, mask, text, image, style, ... werden ignoriert
  }
}

/** Basismatrix: Benutzereinheiten -> mm anhand width/height/viewBox des Wurzelelements. */
function rootMatrix(a: Record<string, string>): Matrix {
  const wMm = lengthToMm(a.width)
  const hMm = lengthToMm(a.height)
  const vb = parseViewBox(a.viewBox)
  if (vb) {
    let sx: number, sy: number
    if (wMm && hMm) { sx = wMm / vb[2]; sy = hMm / vb[3] }
    else if (wMm) { sx = sy = wMm / vb[2] }
    else if (hMm) { sx = sy = hMm / vb[3] }
    else { sx = sy = MM_PER_PX } // viewBox-Einheiten als px
    let tx = 0, ty = 0
    if (wMm && hMm && Math.abs(sx - sy) / Math.max(sx, sy) > 0.01) {
      // preserveAspectRatio default: xMidYMid meet
      const s = Math.min(sx, sy)
      tx = (wMm - vb[2] * s) / 2
      ty = (hMm - vb[3] * s) / 2
      sx = sy = s
    }
    return [sx, 0, 0, sy, tx - vb[0] * sx, ty - vb[1] * sy]
  }
  return [MM_PER_PX, 0, 0, MM_PER_PX, 0, 0]
}

/* -------------------------------------------------------------------- Split */

interface Contour { idx: number; box: Box; area: number }

function normalizePart(paths: Polyline[]): { paths: Polyline[]; width: number; height: number } {
  const box = pathsBox(paths) as Box
  const shifted = paths.map((p) => ({
    closed: p.closed,
    points: p.points.map((q) => ({ x: q.x - box.x, y: q.y - box.y }))
  }))
  return { paths: shifted, width: box.width, height: box.height }
}

function splitPaths(all: Polyline[]): Polyline[][] {
  const boxes: Box[] = all.map((p) => pointsBox(p.points) as Box)
  const closedIdx: Contour[] = []
  all.forEach((p, i) => {
    if (p.closed) closedIdx.push({ idx: i, box: boxes[i], area: polygonArea(p.points) })
  })
  closedIdx.sort((a, b) => b.area - a.area)

  const roots: { c: Contour; members: number[] }[] = []
  for (const c of closedIdx) {
    let placed = false
    for (const r of roots) {
      if (polylineInside(all[r.c.idx].points, r.c.box, all[c.idx].points, c.box)) {
        r.members.push(c.idx)
        placed = true
        break
      }
    }
    if (!placed) roots.push({ c, members: [c.idx] })
  }

  const groups: number[][] = roots.map((r) => r.members)
  const extraOpen: number[][] = []
  all.forEach((p, i) => {
    if (p.closed) return
    // kleinsten Root finden, dessen bbox den Pfad enthält
    let best = -1
    let bestArea = Infinity
    roots.forEach((r, ri) => {
      if (boxContains(r.c.box, boxes[i]) && r.c.area < bestArea) { best = ri; bestArea = r.c.area }
    })
    if (best >= 0) groups[best].push(i)
    else extraOpen.push([i])
  })

  // Offene Pfade, die sich bbox-mäßig überlappen/berühren, zu einem Teil verbinden (z. B. mehrere Linien einer Figur)
  const merged = mergeOverlappingOpen(extraOpen, boxes)
  return [...groups, ...merged].map((g) => g.map((i) => all[i]))
}

function mergeOverlappingOpen(groups: number[][], boxes: Box[]): number[][] {
  const gb = groups.map((g) => unionBox(g.map((i) => boxes[i])))
  const parent = groups.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = gb[i], b = gb[j]
      if (a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height) {
        parent[find(j)] = find(i)
      }
    }
  }
  const map = new Map<number, number[]>()
  groups.forEach((g, i) => {
    const r = find(i)
    map.set(r, [...(map.get(r) ?? []), ...g])
  })
  return [...map.values()]
}

function unionBox(bs: Box[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const b of bs) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/* ------------------------------------------------------------------- Import */

export function importSvg(
  svgText: string,
  fileName: string,
  sourcePath: string,
  opts?: { split?: boolean }
): Part[] {
  const split = opts?.split ?? true
  let doc: XNode[]
  try {
    const parser = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      attributeNamePrefix: '',
      removeNSPrefix: true,
      ignoreDeclaration: true,
      ignorePiTags: true,
      processEntities: false,
      parseAttributeValue: false,
      parseTagValue: false,
      trimValues: true
    })
    doc = parser.parse(svgText) as XNode[]
  } catch {
    throw new Error('Die Datei ist keine gültige SVG-Datei (XML konnte nicht gelesen werden).')
  }
  const root = doc.find((n) => tagOf(n) === 'svg')
  if (!root) throw new Error('Die Datei ist keine gültige SVG-Datei (kein <svg>-Element gefunden).')

  const ids = new Map<string, XNode>()
  indexIds([root], ids)
  const ctx: Ctx = { ids, out: [], depth: 0 }
  const ra = attrsOf(root)
  if (!isHidden(ra)) walk(childrenOf(root), mul(rootMatrix(ra), parseTransform(ra.transform)), ctx)

  const all = ctx.out.filter(
    (p) => p.points.length >= 2 && p.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))
  )
  if (all.length === 0) {
    throw new Error('Die SVG-Datei enthält keine schneidbaren Pfade (leer, nur Text/Bilder oder ungültige Formen).')
  }

  let groups: Polyline[][] = split ? splitPaths(all) : [all]
  if (split) {
    const big = groups.filter((g) => {
      const b = pathsBox(g) as Box
      return Math.max(b.width, b.height) >= MIN_PART_EDGE_MM
    })
    groups = big.length > 0 ? big : [all]
  }

  const base = fileName.replace(/\.[^./\\]+$/, '') || 'Teil'
  const parts = groups
    .map((g) => ({ g, box: pathsBox(g) as Box }))
    .sort((a, b) => (Math.abs(a.box.y - b.box.y) > 1 ? a.box.y - b.box.y : a.box.x - b.box.x))
    .map(({ g }, i): Part => {
      const n = normalizePart(g)
      return {
        id: uid(),
        name: i === 0 ? base : `${base} ${i + 1}`,
        sourcePath,
        paths: n.paths,
        width: n.width,
        height: n.height,
        x: 0,
        y: 0,
        rotation: 0,
        scale: 1
      }
    })
  return parts
}
