import ClipperLib from 'clipper-lib'
import type { Part, Point, Polyline } from '@shared/types'
import { pathsBox, type Box } from './geom'
import { partPaths } from './layout'

/** Clipper rechnet mit ganzen Zahlen: 1 mm = SCALE Einheiten (0,001 mm Auflösung). */
const SCALE = 1000
/** Punkte, die näher als dieser Abstand (Clipper-Einheiten) beieinander bzw. auf einer Geraden liegen, entfallen. */
const CLEAN_DIST = 4

/** Gruppe für Pfade ohne Herkunftsangabe (`src` fehlt): sie teilen sich eine Even-Odd-Füllung. */
const UNKNOWN_SRC = -1

type IntPath = { X: number; Y: number }[]

const toInt = (pts: Point[]): IntPath => pts.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }))
const fromInt = (path: IntPath): Point[] => path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }))

/** Wird die Kontur bei einer Weld-Vereinigung berücksichtigt? (geschlossen UND gefüllt; fehlendes Flag = gefüllt) */
const isWeldable = (p: Polyline): boolean => p.closed && p.filled !== false && p.points.length >= 3

/**
 * Vereinigt alle geschlossenen, gefüllten Konturen ("Verschweißen" wie in Silhouette Studio):
 * übrig bleiben nur die Außenkonturen der vereinigten Fläche und echte Löcher.
 *
 * Füllregel: Jedes SVG-Element (Polyline.src) wird zuerst für sich mit SEINER Füllregel (fill-rule: nonzero
 * bzw. evenodd) zu einer Fläche aufgelöst – so bleibt z. B. das Loch eines Pfades "O" erhalten, egal ob er per
 * Windungsrichtung oder Even-Odd gebaut ist. Erst danach werden die Flächen aller Elemente per Union
 * (nonzero) zusammengeführt; überlappende Elemente verschmelzen also, ohne dass sich Füllregeln mischen.
 * Pfade ohne `src` (z. B. Ergebnis eines früheren Weld oder Altbestand) gelten als EIN Element mit Even-Odd.
 *
 * Unverändert bleiben offene Pfade und Pfade mit `filled === false` (fill="none", reine Strichgrafik);
 * sie stehen im Ergebnis hinter den vereinigten Konturen.
 */
export function weldPaths(paths: Polyline[]): Polyline[] {
  const weldable = paths.filter(isWeldable)
  if (weldable.length === 0) return paths

  // Nach Quell-Element gruppieren
  const groups = new Map<number, { evenOdd: boolean; subs: IntPath[] }>()
  for (const p of weldable) {
    const key = p.src ?? UNKNOWN_SRC
    let g = groups.get(key)
    if (!g) { g = { evenOdd: key === UNKNOWN_SRC ? true : !!p.evenOdd, subs: [] }; groups.set(key, g) }
    g.subs.push(toInt(p.points))
  }

  // 1. Jedes Element mit eigener Füllregel normalisieren (Außen + Löcher mit eindeutiger Orientierung)
  const normalized: IntPath[] = []
  for (const g of groups.values()) {
    const c = new ClipperLib.Clipper()
    c.AddPaths(g.subs, ClipperLib.PolyType.ptSubject, true)
    const sol: IntPath[] = []
    const ft = g.evenOdd ? ClipperLib.PolyFillType.pftEvenOdd : ClipperLib.PolyFillType.pftNonZero
    if (c.Execute(ClipperLib.ClipType.ctUnion, sol, ft, ft)) normalized.push(...sol)
  }

  // 2. Alle Flächen vereinigen
  const c = new ClipperLib.Clipper()
  c.AddPaths(normalized, ClipperLib.PolyType.ptSubject, true)
  let united: IntPath[] = []
  const nz = ClipperLib.PolyFillType.pftNonZero
  if (!c.Execute(ClipperLib.ClipType.ctUnion, united, nz, nz)) return paths
  united = ClipperLib.Clipper.CleanPolygons(united, CLEAN_DIST).filter((p) => p.length >= 3)
  if (united.length === 0) return paths

  const welded: Polyline[] = united.map((p) => ({ points: fromInt(p), closed: true, filled: true, evenOdd: true }))
  return [...welded, ...paths.filter((p) => !isWeldable(p))]
}

/**
 * Wendet Weld auf ein vorhandenes Bauteil an. Skalierung und Drehung werden wie bei `splitPart` in die Geometrie
 * eingerechnet (Ergebnis: scale 1, rotation 0, gleiche id/Name); die Pfade liegen danach exakt dort, wo sie vorher
 * auf der Arbeitsfläche lagen. Gibt das Teil unverändert zurück, wenn es nichts zu vereinigen gibt.
 */
export function weldPart(part: Part): Part {
  const world = partPaths(part).filter((p) => p.points.length >= 2)
  if (world.filter(isWeldable).length < 1) return part
  const out = weldPaths(world)
  const box = pathsBox(out) as Box | null
  if (!box) return part
  return {
    ...part,
    paths: out.map((p) => ({ ...p, points: p.points.map((q) => ({ x: q.x - box.x, y: q.y - box.y })) })),
    width: box.width,
    height: box.height,
    x: box.x,
    y: box.y,
    rotation: 0,
    scale: 1
  }
}
