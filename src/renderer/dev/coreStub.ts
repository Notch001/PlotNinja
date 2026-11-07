/**
 * Vorläufiger Stub für '@core/index' (nur für die Browser-Entwicklung ohne echten Core).
 * Gleiche Signaturen wie der echte Core; wird über src/renderer/core.ts eingebunden.
 */
import type { CutJob, CutSettings, Part, Point, Polyline, WorkArea } from '@shared/types'
import { t } from '@shared/i18n'

let counter = 0
export function uid(): string {
  counter++
  return 'p' + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 5)
}

type M = [number, number, number, number, number, number]
const I: M = [1, 0, 0, 1, 0, 0]
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]
]
const ap = (m: M, x: number, y: number): Point => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })

function parseTransform(s: string | null): M {
  let m = I
  if (!s) return m
  const re = /(\w+)\s*\(([^)]*)\)/g
  let r: RegExpExecArray | null
  while ((r = re.exec(s))) {
    const a = r[2].split(/[\s,]+/).filter(Boolean).map(Number)
    let t: M = I
    if (r[1] === 'translate') t = [1, 0, 0, 1, a[0] || 0, a[1] || 0]
    else if (r[1] === 'scale') t = [a[0], 0, 0, a[1] ?? a[0], 0, 0]
    else if (r[1] === 'matrix') t = a as M
    else if (r[1] === 'rotate') {
      const c = Math.cos(((a[0] || 0) * Math.PI) / 180), sn = Math.sin(((a[0] || 0) * Math.PI) / 180)
      t = [c, sn, -sn, c, 0, 0]
      if (a.length >= 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]])
    }
    m = mul(m, t)
  }
  return m
}

function flattenCubic(p0: Point, p1: Point, p2: Point, p3: Point, out: Point[]): void {
  const n = 16
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
    })
  }
}

function parsePathData(d: string): Polyline[] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || []
  const res: Polyline[] = []
  let cur: Point[] = []
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0
  const num = (): number => Number(tokens[i++])
  const flush = (closed: boolean): void => {
    if (cur.length > 1) res.push({ points: cur, closed })
    cur = []
  }
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++]
    const rel = cmd === cmd.toLowerCase()
    const c = cmd.toUpperCase()
    if (c === 'Z') {
      flush(true); x = sx; y = sy
      cur = []
      continue
    }
    if (c === 'M') {
      flush(false)
      const nx = num(), ny = num()
      x = rel ? x + nx : nx; y = rel ? y + ny : ny; sx = x; sy = y
      cur = [{ x, y }]
      cmd = rel ? 'l' : 'L'
    } else if (c === 'L') {
      const nx = num(), ny = num()
      x = rel ? x + nx : nx; y = rel ? y + ny : ny
      cur.push({ x, y })
    } else if (c === 'H') { const nx = num(); x = rel ? x + nx : nx; cur.push({ x, y }) }
    else if (c === 'V') { const ny = num(); y = rel ? y + ny : ny; cur.push({ x, y }) }
    else if (c === 'C') {
      const a = [num(), num(), num(), num(), num(), num()]
      const o = rel ? [x, y, x, y, x, y] : [0, 0, 0, 0, 0, 0]
      const p1 = { x: a[0] + o[0], y: a[1] + o[1] }, p2 = { x: a[2] + o[2], y: a[3] + o[3] }, p3 = { x: a[4] + o[4], y: a[5] + o[5] }
      flattenCubic({ x, y }, p1, p2, p3, cur)
      x = p3.x; y = p3.y
    } else if (c === 'Q') {
      const a = [num(), num(), num(), num()]
      const o = rel ? [x, y, x, y] : [0, 0, 0, 0]
      const q1 = { x: a[0] + o[0], y: a[1] + o[1] }, q2 = { x: a[2] + o[2], y: a[3] + o[3] }
      flattenCubic({ x, y }, { x: x + (2 / 3) * (q1.x - x), y: y + (2 / 3) * (q1.y - y) },
        { x: q2.x + (2 / 3) * (q1.x - q2.x), y: q2.y + (2 / 3) * (q1.y - q2.y) }, q2, cur)
      x = q2.x; y = q2.y
    } else if (c === 'S' || c === 'T') {
      const k = c === 'S' ? 4 : 2
      const a: number[] = []
      for (let j = 0; j < k; j++) a.push(num())
      x = rel ? x + a[k - 2] : a[k - 2]; y = rel ? y + a[k - 1] : a[k - 1]
      cur.push({ x, y })
    } else if (c === 'A') {
      for (let j = 0; j < 5; j++) num()
      const nx = num(), ny = num()
      x = rel ? x + nx : nx; y = rel ? y + ny : ny
      cur.push({ x, y })
    } else { i++ }
  }
  flush(false)
  return res
}

function ellipse(cx: number, cy: number, rx: number, ry: number): Polyline {
  const pts: Point[] = []
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry })
  }
  return { points: pts, closed: true }
}

function shapeToPolylines(el: Element): Polyline[] {
  const n = (k: string): number => Number(el.getAttribute(k) || 0)
  switch (el.tagName.toLowerCase()) {
    case 'rect': {
      const x = n('x'), y = n('y'), w = n('width'), h = n('height')
      return [{ points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], closed: true }]
    }
    case 'circle': return [ellipse(n('cx'), n('cy'), n('r'), n('r'))]
    case 'ellipse': return [ellipse(n('cx'), n('cy'), n('rx'), n('ry'))]
    case 'line': return [{ points: [{ x: n('x1'), y: n('y1') }, { x: n('x2'), y: n('y2') }], closed: false }]
    case 'polygon':
    case 'polyline': {
      const v = (el.getAttribute('points') || '').split(/[\s,]+/).filter(Boolean).map(Number)
      const pts: Point[] = []
      for (let i = 0; i + 1 < v.length; i += 2) pts.push({ x: v[i], y: v[i + 1] })
      return [{ points: pts, closed: el.tagName.toLowerCase() === 'polygon' }]
    }
    case 'path': return parsePathData(el.getAttribute('d') || '')
    default: return []
  }
}

function collect(el: Element, m: M, out: Polyline[]): void {
  const mm = mul(m, parseTransform(el.getAttribute('transform')))
  const tag = el.tagName.toLowerCase()
  if (tag === 'g' || tag === 'svg' || tag === 'a') {
    for (const c of Array.from(el.children)) collect(c, mm, out)
    return
  }
  for (const pl of shapeToPolylines(el)) {
    out.push({ closed: pl.closed, points: pl.points.map((p) => ap(mm, p.x, p.y)) })
  }
}

function toPart(paths: Polyline[], name: string, sourcePath: string, unit: number): Part | null {
  paths = paths.filter((p) => p.points.length > 1)
  if (!paths.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const pl of paths) for (const p of pl.points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y)
  }
  return {
    id: uid(), name, sourcePath, x: 0, y: 0, rotation: 0, scale: 1,
    width: (maxX - minX) * unit, height: (maxY - minY) * unit,
    paths: paths.map((pl) => ({ closed: pl.closed, points: pl.points.map((p) => ({ x: (p.x - minX) * unit, y: (p.y - minY) * unit })) }))
  }
}

export function importSvg(svgText: string, fileName: string, sourcePath: string, opts?: { split?: boolean }): Part[] {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const root = doc.documentElement
  if (!root || root.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error(t('import.svg.invalidXml'))
  const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)
  const wAttr = root.getAttribute('width') || ''
  let unit = 25.4 / 96
  const wm = /^([\d.]+)\s*(mm|cm|in)?$/.exec(wAttr)
  if (wm && wm[2] && vb.length === 4 && vb[2] > 0) {
    unit = (Number(wm[1]) * (wm[2] === 'mm' ? 1 : wm[2] === 'cm' ? 10 : 25.4)) / vb[2]
  }
  const base = fileName.replace(/\.svg$/i, '')
  const units: Element[][] = []
  const kids = Array.from(root.children)
  if (opts?.split !== false && kids.length > 1) for (const k of kids) units.push([k])
  else units.push(kids)
  const parts: Part[] = []
  for (const u of units) {
    const out: Polyline[] = []
    for (const k of u) collect(k, I, out)
    const p = toPart(out, '', sourcePath, unit)
    if (p) parts.push(p)
  }
  parts.forEach((p, i) => { p.name = parts.length > 1 ? `${base} ${i + 1}` : base })
  return parts
}

export function partBounds(p: Part): { x: number; y: number; width: number; height: number } {
  const pts = partPaths(p).flatMap((pl) => pl.points)
  if (!pts.length) return { x: p.x, y: p.y, width: 0, height: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  // Box-Ecken statt aller Punkte: exakt wie im Spec (Box nach Rotation)
  const w = p.width * p.scale, h = p.height * p.scale
  const a = (p.rotation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  for (const [px, py] of [[0, 0], [w, 0], [w, h], [0, h]]) {
    const dx = px - w / 2, dy = py - h / 2
    const x = p.x + w / 2 + dx * c - dy * s, y = p.y + h / 2 + dx * s + dy * c
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function partPaths(p: Part): Polyline[] {
  const w = p.width * p.scale, h = p.height * p.scale
  const a = (p.rotation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return p.paths.map((pl) => ({
    closed: pl.closed,
    points: pl.points.map((pt) => {
      const dx = pt.x * p.scale - w / 2, dy = pt.y * p.scale - h / 2
      return { x: p.x + w / 2 + dx * c - dy * s, y: p.y + h / 2 + dx * s + dy * c }
    })
  }))
}

type Box = { x: number; y: number; width: number; height: number }
const moveBy = (p: Part, dx: number, dy: number): Part => ({ ...p, x: p.x + dx, y: p.y + dy })
const union = (bs: Box[]): Box => {
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y))
  const r = Math.max(...bs.map((b) => b.x + b.width)), btm = Math.max(...bs.map((b) => b.y + b.height))
  return { x, y, width: r - x, height: btm - y }
}

export function alignParts(parts: Part[], mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom', target: 'selection' | 'workarea', workArea: WorkArea): Part[] {
  if (!parts.length) return parts
  const ref: Box = target === 'workarea' ? { x: 0, y: 0, width: workArea.width, height: workArea.height } : union(parts.map(partBounds))
  return parts.map((p) => {
    const b = partBounds(p)
    switch (mode) {
      case 'left': return moveBy(p, ref.x - b.x, 0)
      case 'hcenter': return moveBy(p, ref.x + ref.width / 2 - (b.x + b.width / 2), 0)
      case 'right': return moveBy(p, ref.x + ref.width - (b.x + b.width), 0)
      case 'top': return moveBy(p, 0, ref.y - b.y)
      case 'vcenter': return moveBy(p, 0, ref.y + ref.height / 2 - (b.y + b.height / 2))
      default: return moveBy(p, 0, ref.y + ref.height - (b.y + b.height))
    }
  })
}

export function distributeParts(parts: Part[], axis: 'h' | 'v'): Part[] {
  if (parts.length < 3) return parts
  const items = parts.map((p) => ({ p, b: partBounds(p) }))
  const k = axis === 'h' ? 'x' : 'y', d = axis === 'h' ? 'width' : 'height'
  const sorted = [...items].sort((a, b) => a.b[k] - b.b[k])
  const total = sorted[sorted.length - 1].b[k] + sorted[sorted.length - 1].b[d] - sorted[0].b[k]
  const sizes = sorted.reduce((s, i) => s + i.b[d], 0)
  const gap = (total - sizes) / (sorted.length - 1)
  const pos = new Map<string, number>()
  let cur = sorted[0].b[k]
  for (const it of sorted) { pos.set(it.p.id, cur - it.b[k]); cur += it.b[d] + gap }
  return parts.map((p) => (axis === 'h' ? moveBy(p, pos.get(p.id) || 0, 0) : moveBy(p, 0, pos.get(p.id) || 0)))
}

export function autoArrange(parts: Part[], workArea: WorkArea, gap = 4): Part[] {
  const order = parts.map((p) => ({ p, b: partBounds(p) })).sort((a, b) => b.b.height - a.b.height)
  const placed = new Map<string, Part>()
  let x = gap, y = gap, rowH = 0
  for (const { p, b } of order) {
    if (x + b.width > workArea.width - gap && x > gap) { x = gap; y += rowH + gap; rowH = 0 }
    placed.set(p.id, moveBy(p, x - b.x, y - b.y))
    x += b.width + gap
    rowH = Math.max(rowH, b.height)
  }
  return parts.map((p) => placed.get(p.id) || p)
}

export function findFreeSpot(part: Part, existing: Part[], workArea: WorkArea, gap = 4): { x: number; y: number } {
  const b = partBounds(part)
  const others = existing.map(partBounds)
  const step = 5
  for (let y = gap; y + b.height <= workArea.height - gap + 0.01; y += step) {
    for (let x = gap; x + b.width <= workArea.width - gap + 0.01; x += step) {
      const hit = others.some((o) => x < o.x + o.width + gap && x + b.width + gap > o.x && y < o.y + o.height + gap && y + b.height + gap > o.y)
      if (!hit) return { x: part.x + (x - b.x), y: part.y + (y - b.y) }
    }
  }
  return { x: part.x + (gap - b.x), y: part.y + (gap - b.y) }
}

export function isOutOfBounds(p: Part, workArea: WorkArea): boolean {
  const b = partBounds(p)
  const e = 0.01
  return b.x < -e || b.y < -e || b.x + b.width > workArea.width + e || b.y + b.height > workArea.height + e
}

export function buildJob(parts: Part[], workArea: WorkArea, settings: CutSettings): CutJob {
  return { paths: parts.flatMap(partPaths), workArea, settings }
}
