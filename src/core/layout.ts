import type { Part, Polyline, WorkArea } from '@shared/types'
import { boxesIntersect, type Box } from './geom'

const EPS = 1e-6

/** Achsenparalleles Bounding-Box NACH scale + rotation in Arbeitsflächen-Koordinaten. */
export function partBounds(p: Part): Box {
  const sw = p.width * p.scale
  const sh = p.height * p.scale
  const rad = (p.rotation * Math.PI) / 180
  const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad))
  const w = sw * c + sh * s
  const h = sw * s + sh * c
  const cx = p.x + sw / 2
  const cy = p.y + sh / 2
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h }
}

/** Transformierte Pfade (scale, dann Rotation um die Mitte, dann Verschiebung) in Arbeitsflächen-Koordinaten. */
export function partPaths(p: Part): Polyline[] {
  const sw = p.width * p.scale
  const sh = p.height * p.scale
  const rad = (p.rotation * Math.PI) / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const cx = p.x + sw / 2
  const cy = p.y + sh / 2
  return p.paths.map((pl) => ({
    ...pl,
    points: pl.points.map((q) => {
      const dx = q.x * p.scale - sw / 2
      const dy = q.y * p.scale - sh / 2
      return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
    })
  }))
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

function union(boxes: Box[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const b of boxes) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export function alignParts(
  parts: Part[],
  mode: AlignMode,
  target: 'selection' | 'workarea',
  workArea: WorkArea
): Part[] {
  if (parts.length === 0) return []
  const bounds = parts.map(partBounds)
  const t: Box = target === 'workarea'
    ? { x: 0, y: 0, width: workArea.width, height: workArea.height }
    : union(bounds)
  return parts.map((p, i) => {
    const b = bounds[i]
    let dx = 0, dy = 0
    switch (mode) {
      case 'left': dx = t.x - b.x; break
      case 'hcenter': dx = t.x + t.width / 2 - (b.x + b.width / 2); break
      case 'right': dx = t.x + t.width - (b.x + b.width); break
      case 'top': dy = t.y - b.y; break
      case 'vcenter': dy = t.y + t.height / 2 - (b.y + b.height / 2); break
      case 'bottom': dy = t.y + t.height - (b.y + b.height); break
    }
    return { ...p, x: p.x + dx, y: p.y + dy }
  })
}

export function distributeParts(parts: Part[], axis: 'h' | 'v'): Part[] {
  if (parts.length < 3) return parts.map((p) => ({ ...p }))
  const bounds = parts.map(partBounds)
  const order = parts.map((_, i) => i)
  const pos = (i: number): number => (axis === 'h' ? bounds[i].x : bounds[i].y)
  const size = (i: number): number => (axis === 'h' ? bounds[i].width : bounds[i].height)
  order.sort((a, b) => pos(a) - pos(b))
  const first = order[0]
  const last = order[order.length - 1]
  const lastEnd = Math.max(...order.map((i) => pos(i) + size(i)))
  const span = lastEnd - pos(first)
  const total = order.reduce((s, i) => s + size(i), 0)
  const gap = (span - total) / (order.length - 1)
  const result = parts.map((p) => ({ ...p }))
  let cursor = pos(first)
  for (const i of order) {
    const delta = cursor - pos(i)
    if (axis === 'h') result[i].x = parts[i].x + delta
    else result[i].y = parts[i].y + delta
    cursor += size(i) + gap
  }
  void last
  return result
}

/** Shelf-Packing; sortiert nach (Bounds-)Höhe absteigend. Nicht passende Teile werden unterhalb weiter platziert. */
export function autoArrange(parts: Part[], workArea: WorkArea, gap = 3): Part[] {
  const bounds = parts.map(partBounds)
  const order = parts.map((_, i) => i).sort((a, b) => bounds[b].height - bounds[a].height)
  const result = parts.map((p) => ({ ...p }))
  let x = 0, y = 0, shelfH = 0
  for (const i of order) {
    const b = bounds[i]
    if (x > 0 && x + b.width > workArea.width + EPS) {
      x = 0
      y += shelfH + gap
      shelfH = 0
    }
    result[i].x = parts[i].x + (x - b.x)
    result[i].y = parts[i].y + (y - b.y)
    x += b.width + gap
    shelfH = Math.max(shelfH, b.height)
  }
  return result
}

export function findFreeSpot(
  part: Part,
  existing: Part[],
  workArea: WorkArea,
  gap = 3
): { x: number; y: number } {
  const b = partBounds(part)
  const occupied = existing.map((e) => {
    const eb = partBounds(e)
    return { x: eb.x - gap, y: eb.y - gap, width: eb.width + 2 * gap, height: eb.height + 2 * gap }
  })
  const step = 5
  for (let y = 0; y + b.height <= workArea.height + EPS; y += step) {
    for (let x = 0; x + b.width <= workArea.width + EPS; x += step) {
      const cand: Box = { x, y, width: b.width, height: b.height }
      if (!occupied.some((o) => boxesIntersect(o, cand))) {
        return { x: part.x + (x - b.x), y: part.y + (y - b.y) }
      }
    }
  }
  return { x: part.x + (0 - b.x), y: part.y + (0 - b.y) }
}

export function isOutOfBounds(p: Part, workArea: WorkArea): boolean {
  const b = partBounds(p)
  return (
    b.x < -EPS || b.y < -EPS ||
    b.x + b.width > workArea.width + EPS ||
    b.y + b.height > workArea.height + EPS
  )
}
