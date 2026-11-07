import type { Part, Point } from '@shared/types'
import type { Box } from './geom'
import { unionBox } from './layout'
import { uid } from './uid'

/* ---------- Gruppen verwalten ---------- */

/** Gemeinsame Bounding-Box einer Gruppe bzw. beliebiger Teile (null bei leerer Liste). */
export function groupBounds(parts: Part[]): Box | null {
  return unionBox(parts)
}

/** Erweitert eine Auswahl um alle Mitglieder der berührten Gruppen (Reihenfolge wie in `parts`). */
export function expandToGroups(parts: Part[], ids: string[]): string[] {
  const want = new Set(ids)
  const groups = new Set<string>()
  for (const p of parts) if (want.has(p.id) && p.groupId) groups.add(p.groupId)
  return parts.filter((p) => want.has(p.id) || (p.groupId !== undefined && groups.has(p.groupId))).map((p) => p.id)
}

/** Entfernt groupIds, die weniger als zwei Teile haben (Gruppe mit nur einem Mitglied ist keine Gruppe). */
export function normalizeGroups(parts: Part[]): Part[] {
  const count = new Map<string, number>()
  for (const p of parts) if (p.groupId) count.set(p.groupId, (count.get(p.groupId) ?? 0) + 1)
  if (![...count.values()].some((n) => n < 2)) return parts
  return parts.map((p) => {
    if (!p.groupId || (count.get(p.groupId) ?? 0) >= 2) return p
    const { groupId: _g, ...rest } = p
    void _g
    return rest
  })
}

/** Fasst die Teile mit den gegebenen ids zu einer neuen Gruppe zusammen (bestehende Gruppen darin werden aufgelöst/vereint). */
export function groupParts(parts: Part[], ids: string[], groupId: string = uid()): Part[] {
  const want = new Set(expandToGroups(parts, ids))
  if (want.size < 2) return parts
  return normalizeGroups(parts.map((p) => (want.has(p.id) ? { ...p, groupId } : p)))
}

/** Hebt die Gruppierung der Teile mit den gegebenen ids (und ihrer gesamten Gruppen) auf. */
export function ungroupParts(parts: Part[], ids: string[]): Part[] {
  const want = new Set(expandToGroups(parts, ids))
  return parts.map((p) => {
    if (!want.has(p.id) || !p.groupId) return p
    const { groupId: _g, ...rest } = p
    void _g
    return rest
  })
}

/** Kopiert Teile mit neuen ids; jede enthaltene Gruppe bekommt für die Kopien eine eigene neue groupId. */
export function duplicateParts(parts: Part[], dx = 0, dy = 0): Part[] {
  const map = new Map<string, string>()
  const copies = parts.map((p) => {
    const c: Part = { ...p, id: uid(), x: p.x + dx, y: p.y + dy }
    if (p.groupId) {
      if (!map.has(p.groupId)) map.set(p.groupId, uid())
      c.groupId = map.get(p.groupId)
    }
    return c
  })
  return normalizeGroups(copies)
}

/* ---------- Transformationen (Gruppen sind starr: jedes Mitglied wird mitgerechnet) ---------- */

export function normDeg(d: number): number {
  let r = d % 360
  if (r <= -180) r += 360
  if (r > 180) r -= 360
  return Math.round(r * 1000) / 1000
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

/** Gleichmäßig um `anchor` skalieren (Faktor f): Mitte, Maßstab und Abstände aller Teile skalieren mit. */
export function scaleParts(parts: Part[], anchor: Point, f: number): Part[] {
  return parts.map((p) => {
    const c = partCenter(p)
    return withCenter({ ...p, scale: p.scale * f }, { x: anchor.x + (c.x - anchor.x) * f, y: anchor.y + (c.y - anchor.y) * f })
  })
}

/** Um `center` drehen (deltaDeg im Uhrzeigersinn): Mitten kreisen um `center`, jedes Teil dreht um sich selbst mit. */
export function rotateParts(parts: Part[], center: Point, deltaDeg: number): Part[] {
  const a = (deltaDeg * Math.PI) / 180
  const c = Math.cos(a), s = Math.sin(a)
  return parts.map((p) => {
    const pc = partCenter(p)
    const dx = pc.x - center.x, dy = pc.y - center.y
    return withCenter({ ...p, rotation: normDeg(p.rotation + deltaDeg) }, { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c })
  })
}

function boxCenter(b: Box): Point {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/** Gruppe verschieben, sodass die linke obere Ecke ihrer Bounding-Box auf (x, y) liegt (undefiniert = Achse unverändert). */
export function moveGroupTo(parts: Part[], x?: number, y?: number): Part[] {
  const b = groupBounds(parts)
  if (!b) return parts
  return translateParts(parts, x === undefined ? 0 : x - b.x, y === undefined ? 0 : y - b.y)
}

/** Gruppe um ihre Mitte (oder `anchor`) mit Faktor f skalieren. */
export function scaleGroup(parts: Part[], f: number, anchor?: Point): Part[] {
  const b = groupBounds(parts)
  if (!b) return parts
  return scaleParts(parts, anchor ?? boxCenter(b), f)
}

/** Gruppe um ihre Mitte (oder `center`) drehen. */
export function rotateGroup(parts: Part[], deltaDeg: number, center?: Point): Part[] {
  const b = groupBounds(parts)
  if (!b) return parts
  return rotateParts(parts, center ?? boxCenter(b), deltaDeg)
}

/** Allgemeiner Einstieg: Gruppe um ihre Mitte skalieren (scale) und drehen (rotate) in einem Schritt. */
export function transformGroup(parts: Part[], opts: { dx?: number; dy?: number; scale?: number; rotate?: number }): Part[] {
  const b = groupBounds(parts)
  if (!b) return parts
  const c = boxCenter(b)
  let out = parts
  if (opts.scale !== undefined && opts.scale !== 1) out = scaleParts(out, c, opts.scale)
  if (opts.rotate) out = rotateParts(out, c, opts.rotate)
  if (opts.dx || opts.dy) out = translateParts(out, opts.dx ?? 0, opts.dy ?? 0)
  return out
}

/** Anzahl der Layout-Einheiten (Einzelteil oder Gruppe) in einer Teileliste. */
export function countUnits(parts: Part[]): number {
  const seen = new Set<string>()
  let n = 0
  for (const p of parts) {
    if (p.groupId) { if (seen.has(p.groupId)) continue; seen.add(p.groupId) }
    n++
  }
  return n
}

/** Alle Mitglieder derselben Gruppe wie `part` (inkl. `part`); ohne Gruppe nur das Teil selbst. */
export function groupMembers(parts: Part[], part: Part): Part[] {
  return part.groupId ? parts.filter((p) => p.groupId === part.groupId) : [part]
}

