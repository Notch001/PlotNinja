import type { CutJob, CutSettings, Part, Point, Polyline, WorkArea } from '@shared/types'
import { pointsBox, polylineInside, type Box } from './geom'
import { partBounds, partPaths, unitsOf } from './layout'

const MAX_NESTING_PATHS = 1500

/** Verschachtelungstiefe (Anzahl umgebender geschlossener Konturen) je Pfad. */
function nestingDepths(paths: Polyline[]): number[] {
  const depths = paths.map(() => 0)
  if (paths.length > MAX_NESTING_PATHS) return depths
  const boxes = paths.map((p) => pointsBox(p.points) as Box)
  for (let i = 0; i < paths.length; i++) {
    for (let j = 0; j < paths.length; j++) {
      if (i === j || !paths[j].closed) continue
      if (polylineInside(paths[j].points, boxes[j], paths[i].points, boxes[i])) depths[i]++
    }
  }
  return depths
}

/** Hängt `overcut` mm entlang des Pfadanfangs an (geschlossene Pfade werden dadurch offen). */
function applyOvercut(pl: Polyline, overcut: number): Polyline {
  if (!pl.closed || overcut <= 0 || pl.points.length < 3) return pl
  const pts: Point[] = [...pl.points, pl.points[0]]
  let remaining = overcut
  for (let i = 1; i < pl.points.length && remaining > 0; i++) {
    const a = pl.points[i - 1], b = pl.points[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len <= 1e-9) continue
    if (len <= remaining) {
      pts.push(b)
      remaining -= len
    } else {
      const t = remaining / len
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      remaining = 0
    }
  }
  return { points: pts, closed: false }
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Greedy Nearest-Neighbor innerhalb einer Gruppe; liefert sortierte Pfade, Cursor wird fortgeschrieben. */
function nearestOrder(paths: Polyline[], cursor: Point): Polyline[] {
  const rest = [...paths]
  const out: Polyline[] = []
  let cur = cursor
  while (rest.length > 0) {
    let bi = 0, bd = Infinity
    for (let i = 0; i < rest.length; i++) {
      const d = dist(cur, rest[i].points[0])
      if (d < bd) { bd = d; bi = i }
    }
    const [p] = rest.splice(bi, 1)
    out.push(p)
    cur = p.closed ? p.points[0] : p.points[p.points.length - 1]
  }
  return out
}

function distToBox(p: Point, b: Box): number {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.width))
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.height))
  return Math.hypot(dx, dy)
}

export interface JobOptions {
  /**
   * true (Standard): Schnittreihenfolge optimieren – nächstgelegene Einheit/Teil/Kontur zuerst, Gruppen zusammenhängend.
   * false: Teile in der Reihenfolge der Liste; innerhalb eines Teils bleiben innere Konturen vor äußeren (sauberer Schnitt),
   * sonst Reihenfolge der Pfade.
   */
  optimize?: boolean
  /** true: ganzen Auftrag an der senkrechten Mittelachse der Arbeitsfläche spiegeln (Rückseiten-Schnitt, nur im Auftrag). */
  mirror?: boolean
}

/** Spiegelt alle Pfade an der senkrechten Mittelachse der Arbeitsfläche (x -> Breite - x). Das Dokument bleibt unberührt. */
export function mirrorJobPaths(paths: Polyline[], workArea: WorkArea): Polyline[] {
  return paths.map((p) => ({ ...p, points: p.points.map((q) => ({ x: workArea.width - q.x, y: q.y })) }))
}

export function buildJob(parts: Part[], workArea: WorkArea, settings: CutSettings, opts: JobOptions = {}): CutJob {
  const withPaths = parts.filter((p) => p.paths.length > 0)
  const out = (opts.optimize ?? true) ? optimizedPaths(withPaths, settings) : orderedPaths(withPaths, settings)
  return { paths: opts.mirror ? mirrorJobPaths(out, workArea) : out, workArea, settings }
}

/**
 * Schnittränder (`role: 'border'`) kommen innerhalb ihrer Gruppe zuletzt: sie stehen direkt hinter dem letzten Nicht-Rand-Mitglied
 * ihrer Gruppe, damit das Material beim Schneiden der inneren Formen noch fest ist. Sonst bleibt die Reihenfolge der Liste.
 */
function borderLast(parts: Part[]): Part[] {
  if (!parts.some((p) => p.role === 'border')) return parts
  const lastBase = new Map<string, number>()
  parts.forEach((p, i) => { if (p.role !== 'border' && p.groupId) lastBase.set(p.groupId, i) })
  const after = new Map<number, Part[]>()
  const out: Part[] = []
  parts.forEach((p, i) => {
    if (p.role === 'border') {
      const at = p.groupId !== undefined ? lastBase.get(p.groupId) : undefined
      if (at !== undefined && at > i) { after.set(at, [...(after.get(at) ?? []), p]); return }
    }
    out.push(p)
    const later = after.get(i)
    if (later) out.push(...later)
  })
  return out
}

/** Reihenfolge der Teile wie in der Liste; je Teil innere Konturen zuerst. */
function orderedPaths(parts: Part[], settings: CutSettings): Polyline[] {
  const out: Polyline[] = []
  for (const part of borderLast(parts)) {
    const paths = partPaths(part).filter((p) => p.points.length >= 2)
    const depths = nestingDepths(paths)
    const maxDepth = Math.max(0, ...depths)
    for (let d = maxDepth; d >= 0; d--) {
      paths.forEach((p, i) => { if (depths[i] === d) out.push(applyOvercut(p, settings.overcut)) })
    }
  }
  return out
}

function optimizedPaths(withPaths: Part[], settings: CutSettings): Polyline[] {
  // Gruppen werden zusammenhängend geschnitten: erst die nächste Einheit (Einzelteil oder Gruppe), darin Teil für Teil
  const units = unitsOf(withPaths).map((u) => ({ members: u.indices.map((i) => withPaths[i]), box: u.box }))
  const out: Polyline[] = []
  let cursor: Point = { x: 0, y: 0 }

  while (units.length > 0) {
    let ui = 0, ud = Infinity
    for (let i = 0; i < units.length; i++) {
      const d = distToBox(cursor, units[i].box)
      if (d < ud) { ud = d; ui = i }
    }
    const [unit] = units.splice(ui, 1)
    // Innerhalb der Gruppe zuerst die Bauteile, der Schnittrand (außen) ganz zuletzt
    const queue = [unit.members.filter((m) => m.role !== 'border'), unit.members.filter((m) => m.role === 'border')]
    for (const remaining of queue) while (remaining.length > 0) {
      let bi = 0, bd = Infinity
      for (let i = 0; i < remaining.length; i++) {
        const d = distToBox(cursor, partBounds(remaining[i]))
        if (d < bd) { bd = d; bi = i }
      }
      const [part] = remaining.splice(bi, 1)
      const paths = partPaths(part).filter((p) => p.points.length >= 2)
      const depths = nestingDepths(paths)
      const maxDepth = Math.max(0, ...depths)
      // tiefste (innerste) Konturen zuerst
      for (let d = maxDepth; d >= 0; d--) {
        const group = paths.filter((_, i) => depths[i] === d)
        for (const p of nearestOrder(group, cursor)) {
          const pp = applyOvercut(p, settings.overcut)
          out.push(pp)
          cursor = pp.closed ? pp.points[0] : pp.points[pp.points.length - 1]
        }
      }
    }
  }
  return out
}
