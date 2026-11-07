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

/** Gemeinsame Bounding-Box mehrerer Teile (null bei leerer Liste). */
export function unionBox(parts: Part[]): Box | null {
  return parts.length ? union(parts.map(partBounds)) : null
}

/**
 * Eine Layout-Einheit: ein einzelnes Teil oder alle (übergebenen) Mitglieder einer Gruppe.
 * `indices` verweisen auf die Eingabeliste, `box` ist die gemeinsame Bounding-Box.
 */
export interface Unit { indices: number[]; box: Box }

/** Fasst Teile mit gleicher groupId zu einer Einheit zusammen; Reihenfolge = erstes Auftreten. */
export function unitsOf(parts: Part[]): Unit[] {
  const byGroup = new Map<string, number[]>()
  const order: number[][] = []
  parts.forEach((p, i) => {
    if (p.groupId) {
      const list = byGroup.get(p.groupId)
      if (list) { list.push(i); return }
      const fresh = [i]
      byGroup.set(p.groupId, fresh)
      order.push(fresh)
    } else order.push([i])
  })
  return order.map((indices) => ({ indices, box: union(indices.map((i) => partBounds(parts[i]))) }))
}

/** Verschiebt alle Mitglieder einer Einheit um (dx, dy); Geometrie bleibt unverändert. */
function shiftUnit(result: Part[], parts: Part[], u: Unit, dx: number, dy: number): void {
  for (const i of u.indices) result[i] = { ...parts[i], x: parts[i].x + dx, y: parts[i].y + dy }
}

export function alignParts(
  parts: Part[],
  mode: AlignMode,
  target: 'selection' | 'workarea',
  workArea: WorkArea
): Part[] {
  if (parts.length === 0) return []
  const units = unitsOf(parts)
  const t: Box = target === 'workarea'
    ? { x: 0, y: 0, width: workArea.width, height: workArea.height }
    : union(units.map((u) => u.box))
  const result = parts.map((p) => ({ ...p }))
  for (const u of units) {
    const b = u.box
    let dx = 0, dy = 0
    switch (mode) {
      case 'left': dx = t.x - b.x; break
      case 'hcenter': dx = t.x + t.width / 2 - (b.x + b.width / 2); break
      case 'right': dx = t.x + t.width - (b.x + b.width); break
      case 'top': dy = t.y - b.y; break
      case 'vcenter': dy = t.y + t.height / 2 - (b.y + b.height / 2); break
      case 'bottom': dy = t.y + t.height - (b.y + b.height); break
    }
    shiftUnit(result, parts, u, dx, dy)
  }
  return result
}

export function distributeParts(parts: Part[], axis: 'h' | 'v'): Part[] {
  const units = unitsOf(parts)
  const result = parts.map((p) => ({ ...p }))
  if (units.length < 3) return result
  const pos = (u: Unit): number => (axis === 'h' ? u.box.x : u.box.y)
  const size = (u: Unit): number => (axis === 'h' ? u.box.width : u.box.height)
  const order = [...units].sort((a, b) => pos(a) - pos(b))
  const lastEnd = Math.max(...order.map((u) => pos(u) + size(u)))
  const span = lastEnd - pos(order[0])
  const total = order.reduce((s, u) => s + size(u), 0)
  const gap = (span - total) / (order.length - 1)
  let cursor = pos(order[0])
  for (const u of order) {
    const delta = cursor - pos(u)
    shiftUnit(result, parts, u, axis === 'h' ? delta : 0, axis === 'v' ? delta : 0)
    cursor += size(u) + gap
  }
  return result
}

/**
 * Shelf-Packing; sortiert nach (Bounds-)Höhe absteigend. Gruppen (gleiche groupId) sind starre Einheiten.
 * Es ändern sich AUSSCHLIESSLICH x und y der Teile (Pfade, scale, rotation, Anzahl und Reihenfolge bleiben gleich);
 * die relative Lage der Gruppenmitglieder bleibt exakt erhalten. Einheiten, die breiter als die Matte sind, werden
 * nicht verändert, sondern nur auf eine eigene Reihe gesetzt. `margin` = Abstand zum Mattenrand.
 */
export function autoArrange(parts: Part[], workArea: WorkArea, gap = 3, margin = 5): Part[] {
  const units = unitsOf(parts)
  const order = units.map((_, i) => i).sort((a, b) => units[b].box.height - units[a].box.height || a - b)
  const result = parts.map((p) => ({ ...p }))
  const right = workArea.width - margin
  let x = margin, y = margin, shelfH = 0
  for (const k of order) {
    const u = units[k]
    const b = u.box
    if (x > margin + EPS && x + b.width > right + EPS) {
      x = margin
      y += shelfH + gap
      shelfH = 0
    }
    // Zu breite Einheiten (inkl. Rand) so weit nach links, wie es geht (nie über den linken Rand hinaus)
    const px = b.width > right - margin + EPS ? Math.max(0, Math.min(margin, workArea.width - b.width)) : x
    shiftUnit(result, parts, u, px - b.x, y - b.y)
    x = px + b.width + gap
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
  const occupied = unitsOf(existing).map(({ box: eb }) => ({ x: eb.x - gap, y: eb.y - gap, width: eb.width + 2 * gap, height: eb.height + 2 * gap }))
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

function boxOutOfBounds(b: Box, workArea: WorkArea): boolean {
  return (
    b.x < -EPS || b.y < -EPS ||
    b.x + b.width > workArea.width + EPS ||
    b.y + b.height > workArea.height + EPS
  )
}

export function isOutOfBounds(p: Part, workArea: WorkArea): boolean {
  return boxOutOfBounds(partBounds(p), workArea)
}

/** Einheiten (Einzelteil oder Gruppe), die über die Arbeitsfläche hinausragen; je Einheit die Liste ihrer Teile. */
export function outOfBoundsUnits(parts: Part[], workArea: WorkArea): Part[][] {
  return unitsOf(parts).filter((u) => boxOutOfBounds(u.box, workArea)).map((u) => u.indices.map((i) => parts[i]))
}
