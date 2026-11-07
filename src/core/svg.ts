import { XMLParser } from 'fast-xml-parser'
import type { Part, Polyline } from '@shared/types'
import {
  IDENTITY, boxContains, mul, pathsBox, polygonArea, polylineInside, polylinesCross, pointsBox,
  type Box, type Matrix
} from './geom'
import { PathBuilder, parsePathData } from './pathdata'
import { partPaths } from './layout'
import { uid } from './uid'
import { weldPaths } from './weld'
import { ImportError, assertImportSize, dropInvalidPaths, droppedPathsNotice, limitPoints, simplifiedNotice } from './sanitize'
import { t } from '@shared/i18n'

const MM_PER_PX = 25.4 / 96
const MIN_PART_EDGE_MM = 0.5
const KAPPA = 0.5522847498307936

type XNode = Record<string, any>

interface CssRule { tag: string | null; id: string | null; classes: string[]; props: Record<string, string> }

interface Ctx {
  ids: Map<string, XNode>
  rules: CssRule[]
  out: Polyline[]
  depth: number
  /** Zähler für Polyline.src (Quell-Element) */
  nextSrc: number
}

/** Vererbte Darstellungseigenschaften (fill / fill-rule). */
interface Inherit { fill: string; fillRule: string }

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

const NUMBER_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g

export function parseTransform(s: string | undefined): Matrix {
  let m: Matrix = IDENTITY
  if (!s) return m
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  let r: RegExpExecArray | null
  while ((r = re.exec(s))) {
    // Zahlen per Regex lesen (auch "10-5", ".5.5", "1e-3" und CSS-Einheiten wie "10px"/"45deg")
    const a = (r[2].match(NUMBER_RE) ?? []).map(Number)
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
  const v = (a.visibility ?? '').trim()
  return v === 'hidden' || v === 'collapse'
}

/* ------------------------------------------------------- Einfaches CSS (style) */

/** Nur diese Eigenschaften werden aus style="…" und <style> übernommen. */
const CSS_PROPS = new Set(['display', 'visibility', 'transform', 'fill', 'fill-rule'])

function parseDeclarations(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const decl of text.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const k = decl.slice(0, i).trim().toLowerCase()
    const v = decl.slice(i + 1).replace(/!important/i, '').trim()
    if (CSS_PROPS.has(k)) out[k] = v
  }
  return out
}

function textOf(node: XNode): string {
  return childrenOf(node).map((c) => (typeof c['#text'] === 'string' ? (c['#text'] as string) : '')).join('\n')
}

/** Sammelt Regeln aus allen <style>-Elementen (nur einfache Selektoren: tag, .klasse, #id, tag.klasse, Listen). */
function collectCssRules(nodes: XNode[], out: CssRule[]): void {
  for (const n of nodes) {
    const t = tagOf(n)
    if (!t || t === '#text') continue
    if (t === 'style') {
      const css = textOf(n).replace(/\/\*[\s\S]*?\*\//g, '')
      const re = /([^{}]+)\{([^{}]*)\}/g
      let m: RegExpExecArray | null
      while ((m = re.exec(css))) {
        const props = parseDeclarations(m[2])
        if (Object.keys(props).length === 0) continue
        for (const sel of m[1].split(',')) {
          const sm = /^\s*([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)(?:#([\w-]+))?\s*$/.exec(sel)
          if (!sm || (!sm[1] && !sm[2] && !sm[3])) continue
          out.push({ tag: sm[1] ?? null, id: sm[3] ?? null, classes: sm[2] ? sm[2].split('.').filter(Boolean) : [], props })
        }
      }
    } else {
      collectCssRules(childrenOf(n), out)
    }
  }
}

/** Attribute eines Elements inklusive CSS-Regeln und style="…" (Reihenfolge: Attribut < Regel < style). */
function effAttrs(n: XNode, rules: CssRule[]): Record<string, string> {
  const a = attrsOf(n)
  if (rules.length === 0 && !a.style) return a
  const out: Record<string, string> = { ...a }
  if (rules.length) {
    const tag = tagOf(n)
    const cls = (a.class ?? '').split(/\s+/).filter(Boolean)
    for (const r of rules) {
      if (r.tag && r.tag !== tag) continue
      if (r.id && r.id !== a.id) continue
      if (!r.classes.every((c) => cls.includes(c))) continue
      Object.assign(out, r.props)
    }
  }
  if (a.style) Object.assign(out, parseDeclarations(a.style))
  return out
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

/** fill / fill-rule eines Elements inklusive Vererbung ("inherit" und fehlende Angaben übernehmen den Elternwert). */
function inheritOf(a: Record<string, string>, parent: Inherit): Inherit {
  const f = (a.fill ?? '').trim()
  const r = (a['fill-rule'] ?? '').trim().toLowerCase()
  return {
    fill: f && f !== 'inherit' ? f.toLowerCase() : parent.fill,
    fillRule: r && r !== 'inherit' ? r : parent.fillRule
  }
}

function walk(nodes: XNode[], m: Matrix, ctx: Ctx, inh: Inherit): void {
  for (const n of nodes) {
    const tag = tagOf(n)
    if (!tag || tag === '#text' || tag.startsWith('?') || tag.startsWith('!')) continue
    const a = effAttrs(n, ctx.rules)
    if (isHidden(a)) continue
    const nm = mul(m, parseTransform(a.transform))
    const ni = inheritOf(a, inh)
    if (SHAPES.has(tag)) {
      const filled = ni.fill !== 'none'
      const evenOdd = ni.fillRule === 'evenodd'
      const src = ctx.nextSrc++
      for (const p of shapeToPaths(tag, a, nm)) ctx.out.push({ ...p, filled, evenOdd, src })
    } else if (CONTAINERS.has(tag)) {
      walk(childrenOf(n), nm, ctx, ni)
    } else if (tag === 'svg' || tag === 'symbol') {
      // verschachteltes svg (Root wird separat behandelt)
      if (tag === 'symbol') continue // nur über <use>
      walk(childrenOf(n), mul(nm, viewportMatrix(a)), ctx, ni)
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
        const ta = effAttrs(target, ctx.rules)
        if (!isHidden(ta)) {
          walk(childrenOf(target), mul(um, viewportMatrix(ta, a.width, a.height)), ctx, inheritOf(ta, ni))
        }
      } else {
        // das referenzierte Element selbst rendern (auch wenn es in <defs> liegt)
        walk([target], um, ctx, ni)
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

export function normalizePart(paths: Polyline[]): { paths: Polyline[]; width: number; height: number } {
  const box = pathsBox(paths) as Box
  const ox = box.x, oy = box.y
  const shifted = paths.map((p) => ({
    ...p,
    points: p.points.map((q) => ({ x: q.x - ox, y: q.y - oy }))
  }))
  return { paths: shifted, width: box.width, height: box.height }
}

const boxesOverlap = (a: Box, b: Box, eps = 0): boolean =>
  a.x <= b.x + b.width + eps && b.x <= a.x + a.width + eps && a.y <= b.y + b.height + eps && b.y <= a.y + a.height + eps

/**
 * Zerlegt Pfade in zusammengehörige Bauteile (Indexlisten):
 *  1. Verschachtelung geschlossener Konturen nach Even-Odd: gerade Tiefe = Außenkontur eines neuen Teils,
 *     ungerade Tiefe = Loch im Teil der umgebenden Kontur (so bleibt z. B. ein "o" im Loch eines Rings ein eigenes Teil).
 *  2. Außenkonturen, deren Kanten sich kreuzen (überlappende Konturen eines Buchstabens), werden zu einem Teil vereint.
 *  3. Offene Pfade kommen zum kleinsten Teil, das sie umschließt; übrige offene Pfade mit überlappenden Boxen werden vereint.
 */
function splitPaths(all: Polyline[]): number[][] {
  const boxes: Box[] = all.map((p) => pointsBox(p.points) as Box)
  const closed: { idx: number; area: number }[] = []
  all.forEach((p, i) => { if (p.closed) closed.push({ idx: i, area: polygonArea(p.points) }) })
  closed.sort((a, b) => b.area - a.area)

  // Verschachtelungstiefe und Elternkontur (kleinste umschließende Kontur)
  const depth = new Map<number, number>()
  const groupOf = new Map<number, number>() // Pfadindex -> Gruppennummer
  const groups: number[][] = []
  closed.forEach((c, ci) => {
    let parent = -1
    let parentArea = Infinity
    for (let j = 0; j < ci; j++) {
      const o = closed[j]
      if (o.area <= c.area || o.area >= parentArea) continue
      if (!boxContains(boxes[o.idx], boxes[c.idx], 1e-4)) continue
      if (polylineInside(all[o.idx].points, boxes[o.idx], all[c.idx].points, boxes[c.idx])) {
        parent = o.idx
        parentArea = o.area
      }
    }
    const d = parent < 0 ? 0 : (depth.get(parent) as number) + 1
    depth.set(c.idx, d)
    if (d % 2 === 0) {
      groupOf.set(c.idx, groups.length)
      groups.push([c.idx])
    } else {
      const g = groupOf.get(parent) as number
      groupOf.set(c.idx, g)
      groups[g].push(c.idx)
    }
  })

  // Überlappende (sich kreuzende) Konturen verschiedener Teile vereinen
  const gbox = groups.map((g) => unionBox(g.map((i) => boxes[i])))
  const parent = groups.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const budget = { ops: 60_000_000 }
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (find(i) === find(j) || !boxesOverlap(gbox[i], gbox[j])) continue
      outer: for (const a of groups[i]) {
        if (!boxesOverlap(boxes[a], gbox[j])) continue
        for (const b of groups[j]) {
          if (!boxesOverlap(boxes[a], boxes[b])) continue
          if (polylinesCross(all[a].points, true, all[b].points, true, budget)) {
            parent[find(j)] = find(i)
            break outer
          }
        }
      }
    }
  }
  const mergedMap = new Map<number, number[]>()
  const gidOfRoot = new Map<number, number>()
  const result: number[][] = []
  groups.forEach((g, gi) => {
    const r = find(gi)
    let out = mergedMap.get(r)
    if (!out) { out = []; mergedMap.set(r, out); result.push(out) }
    out.push(...g)
    gidOfRoot.set(gi, result.indexOf(out))
  })
  const resultOf = (gi: number): number => gidOfRoot.get(gi) as number

  // Offene Pfade
  const extraOpen: number[][] = []
  all.forEach((p, i) => {
    if (p.closed) return
    let best = -1
    let bestArea = Infinity
    for (const c of closed) {
      if (c.area >= bestArea) continue
      if (!boxContains(boxes[c.idx], boxes[i], 1e-4)) continue
      if (polylineInside(all[c.idx].points, boxes[c.idx], p.points, boxes[i])) { best = c.idx; bestArea = c.area }
    }
    if (best >= 0) result[resultOf(groupOf.get(best) as number)].push(i)
    else extraOpen.push([i])
  })
  return [...result, ...mergeOverlappingOpen(extraOpen, boxes)]
}

function mergeOverlappingOpen(groups: number[][], boxes: Box[]): number[][] {
  const gb = groups.map((g) => unionBox(g.map((i) => boxes[i])))
  const parent = groups.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (boxesOverlap(gb[i], gb[j])) parent[find(j)] = find(i)
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

/**
 * Sehr kleine Gruppen (Kantenlänge < MIN_PART_EDGE_MM) gehören meist zu einem Nachbarn (Punkte, Splitter).
 * Liegt ihr Mittelpunkt in der (leicht vergrößerten) Box einer größeren Gruppe, werden sie dort eingegliedert;
 * sonst bleiben sie ein eigenes Teil. Nichts wird verworfen.
 */
function absorbTinyGroups(groups: number[][], all: Polyline[]): number[][] {
  const boxes = groups.map((g) => pathsBox(g.map((i) => all[i])) as Box)
  const isTiny = boxes.map((b) => Math.max(b.width, b.height) < MIN_PART_EDGE_MM)
  const keep: number[][] = []
  const keepBox: Box[] = []
  groups.forEach((g, i) => { if (!isTiny[i]) { keep.push([...g]); keepBox.push(boxes[i]) } })
  const leftovers: number[][] = []
  groups.forEach((g, i) => {
    if (!isTiny[i]) return
    const b = boxes[i]
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2
    let best = -1
    let bestArea = Infinity
    keepBox.forEach((kb, k) => {
      const area = kb.width * kb.height
      if (cx >= kb.x - MIN_PART_EDGE_MM && cx <= kb.x + kb.width + MIN_PART_EDGE_MM &&
          cy >= kb.y - MIN_PART_EDGE_MM && cy <= kb.y + kb.height + MIN_PART_EDGE_MM && area < bestArea) {
        best = k
        bestArea = area
      }
    })
    if (best >= 0) keep[best].push(...g)
    else leftovers.push(g)
  })
  return [...keep, ...leftovers]
}

/* ------------------------------------------------------------------- Import */

export interface ImportOptions {
  /**
   * `false` (Standard): die ganze Datei wird als EIN Bauteil importiert, mit exakt der Originalgeometrie und -anordnung.
   * `true`: zusammengehörige Konturen (inkl. Löchern) werden in Einzelteile zerlegt. Dabei behalten die Teile ihre
   * relative Lage: `x`/`y` jedes Teils ist sein Versatz zum Ursprung (links oben) der Gesamt-Bounding-Box aller Teile.
   * Der Aufrufer addiert die gewünschte Zielposition.
   */
  split?: boolean
  /**
   * `true` (Standard): überlappende, gefüllte, geschlossene Konturen werden vereinigt ("Weld"), sodass nur
   * Außenkonturen und echte Löcher übrig bleiben. Ungefüllte (fill="none") und offene Pfade bleiben unverändert.
   * Läuft vor dem Zerlegen (`split`).
   */
  weld?: boolean
  /** Hinweise an den Benutzer (z. B. verworfene ungültige Pfade, Vereinfachung), vom Aufrufer als Toast anzeigbar. */
  onNotice?: (message: string) => void
}

export function importSvg(
  svgText: string,
  fileName: string,
  sourcePath: string,
  opts?: ImportOptions
): Part[] {
  try {
    return importSvgUnsafe(svgText, fileName, sourcePath, opts)
  } catch (e) {
    // Bekannte Meldungen durchreichen; unerwartete Fehler (z. B. Stapelüberlauf bei absurd tiefen Dateien) verständlich melden
    if (e instanceof ImportError) throw e
    throw new ImportError(t('import.svg.failed'))
  }
}

function importSvgUnsafe(
  svgText: string,
  fileName: string,
  sourcePath: string,
  opts?: ImportOptions
): Part[] {
  const split = opts?.split ?? false
  assertImportSize(svgText.length)
  if (!svgText.trim()) throw new ImportError(t('import.fileEmpty'))
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
    throw new ImportError(t('import.svg.invalidXml'))
  }
  const root = doc.find((n) => tagOf(n) === 'svg')
  if (!root) throw new ImportError(t('import.svg.noSvgElement'))

  const ids = new Map<string, XNode>()
  indexIds([root], ids)
  const rules: CssRule[] = []
  collectCssRules([root], rules)
  const ctx: Ctx = { ids, rules, out: [], depth: 0, nextSrc: 0 }
  const ra = effAttrs(root, rules)
  if (!isHidden(ra)) walk(childrenOf(root), mul(rootMatrix(ra), parseTransform(ra.transform)), ctx, inheritOf(ra, { fill: 'black', fillRule: 'nonzero' }))

  const clean = dropInvalidPaths(ctx.out)
  let all = clean.paths
  if (all.length === 0) {
    throw new ImportError(t('import.svg.noPaths'))
  }
  if (clean.dropped > 0) opts?.onNotice?.(droppedPathsNotice(fileName, clean.dropped))
  const lim = limitPoints(all)
  if (lim.simplified) {
    all = lim.paths
    opts?.onNotice?.(simplifiedNotice(fileName, lim.before, lim.after))
  }

  if (opts?.weld ?? true) all = weldPaths(all)

  const base = fileName.replace(/\.[^./\\]+$/, '') || t('part.defaultName')
  if (!split) return [makePart(normalizePart(all), base, sourcePath, 0, 0)]
  return splitToParts(all, base, sourcePath)
}

export function makePart(
  n: { paths: Polyline[]; width: number; height: number }, name: string, sourcePath: string, x: number, y: number
): Part {
  return { id: uid(), name, sourcePath, paths: n.paths, width: n.width, height: n.height, x, y, rotation: 0, scale: 1 }
}

/** Zerlegt Pfade in Teile; x/y jedes Teils = Versatz zum Ursprung (links oben) der Gesamt-Bounding-Box. */
export function splitToParts(all: Polyline[], base: string, sourcePath: string): Part[] {
  const groups = absorbTinyGroups(splitPaths(all), all).map((g) => g.map((i) => all[i]))
  const total = pathsBox(all) as Box
  return groups
    .map((g) => ({ g, box: pathsBox(g) as Box }))
    .sort((a, b) => (Math.abs(a.box.y - b.box.y) > 1 ? a.box.y - b.box.y : a.box.x - b.box.x))
    .map(({ g, box }, i) => makePart(normalizePart(g), i === 0 ? base : `${base} ${i + 1}`, sourcePath, box.x - total.x, box.y - total.y))
}

/**
 * Zerlegt ein vorhandenes Bauteil in Einzelteile (Rückgabe: ein Teil, wenn nichts zu zerlegen ist).
 * Skalierung und Drehung werden in die Geometrie eingerechnet (neue Teile: scale 1, rotation 0); die Teile liegen
 * exakt dort, wo die Pfade des Originals auf der Arbeitsfläche liegen.
 */
export function splitPart(part: Part): Part[] {
  if (part.role === 'border') return [part] // Schnittrand wird nie zerlegt
  const world = partPaths(part).filter((p) => p.points.length >= 2)
  if (world.length < 2) return [part]
  const origin = pathsBox(world) as Box
  const pieces = splitToParts(world, part.name, part.sourcePath)
  if (pieces.length < 2) return [part]
  return pieces.map((p) => ({ ...p, x: p.x + origin.x, y: p.y + origin.y }))
}
