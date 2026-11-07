import ClipperLib from 'clipper-lib'
import type { BorderMode, BorderSettings, Part, Point, Polyline } from '@shared/types'
import { DEFAULT_BORDER } from '@shared/types'
import { pathsBox, pointInPolygon, polygonArea } from './geom'
import { expandToGroups, normalizeGroups } from './group'
import { partPaths } from './layout'
import { uid } from './uid'
import { weldPaths } from './weld'

/**
 * Schnittrand (Entgitterrand): ein Rand um ein Bauteil, der mitgeschnitten wird, damit sich überschüssiges Material beim
 * Entgittern leichter entfernen lässt, ohne in die Nähe des Aufklebers zu kommen. Der Rand ist ein echtes, statisches Part
 * (`role: 'border'`, geschlossene, ungefüllte Pfade), das mit der Quelle zu einer Gruppe verbunden wird.
 *
 * Basisform = die ENGE Außenform der tatsächlich transformierten Pfade (Skalierung, Drehung, Spiegelung eingerechnet),
 * nicht die lose Part-Box. Rand-Parts (`role === 'border'`) werden dabei ignoriert (kein Rand um einen Rand).
 */

export interface BorderOptions {
  mode: BorderMode
  /** Abstand zur Außenform in mm. */
  offsetMm: number
  /** Nur 'rect': Eckenradius in mm (0 oder fehlend = eckig; wird auf die halbe kürzere Seite begrenzt). */
  cornerRadiusMm?: number
  /** Nur 'offset' (Aufkleberkontur): Lücken bis zu dieser Breite (mm) zwischen Teilen überbrücken (Closing), danach nur Außenkontur. */
  gapMm?: number
  /** Nur 'offset': Glättung der fertigen Kontur (mm, rundet auch einspringende Ecken ab). */
  smoothMm?: number
}

export interface BorderResult {
  part: Part
  /** Tatsächlich verwendete Art (bei 'offset' ohne gefüllte Flächen = 'rect'). */
  mode: BorderMode
  /** true: 'offset' wurde gewünscht, aber es gibt nur Linienkunst -> Rechteck. */
  fellBack: boolean
}

/** Clipper rechnet mit ganzen Zahlen: 1 mm = SCALE Einheiten (wie in weld.ts). */
const SCALE = 1000
/** Genauigkeit der Rundungen beim Kontur-Offset: 0,005 mm Sehnenabweichung. */
const ARC_TOLERANCE = 0.005 * SCALE
const CLEAN_DIST = 4
const ARC_CHORD_MM = 0.02

type IntPath = { X: number; Y: number }[]
const toInt = (pts: Point[]): IntPath => pts.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }))
const fromInt = (path: IntPath): Point[] => path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }))

const isSolid = (p: Polyline): boolean => p.closed && p.filled !== false && p.points.length >= 3

/** Übersetzt die gespeicherten Voreinstellungen in Optionen für `buildBorder` (Radius nur bei Rechteck mit „Ecken abrunden“). */
export function borderOptionsFrom(b: BorderSettings): BorderOptions {
  return { mode: b.mode, offsetMm: b.offsetMm, cornerRadiusMm: b.mode === 'rect' && b.rounded ? b.cornerRadiusMm : 0 }
}

/** Nur die Teile, um die ein Rand gelegt wird (Rand-Parts ausgenommen). */
export const borderBase = (units: Part[]): Part[] => units.filter((p) => p.role !== 'border')

/** Rechteck mit optional abgerundeten Ecken als Polylinie (im Uhrzeigersinn, Bogenzerlegung nach Sehnenabweichung). */
export function roundedRectPoints(x0: number, y0: number, x1: number, y1: number, radius: number): Point[] {
  const r = Math.max(0, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2))
  if (r <= 1e-6) return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
  const step = 2 * Math.acos(Math.max(0, 1 - ARC_CHORD_MM / r))
  const n = Math.min(48, Math.max(4, Math.ceil(Math.PI / 2 / (step || 0.1))))
  const corners: [number, number, number][] = [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]]
  const pts: Point[] = []
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = ((a0 + (90 * i) / n) * Math.PI) / 180
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
    }
  }
  return pts.filter((p, i) => { const q = pts[(i + pts.length - 1) % pts.length]; return Math.hypot(p.x - q.x, p.y - q.y) > 1e-9 })
}

/** Nur Außenkonturen behalten: Polygone, die in keinem anderen liegen (verwirft Löcher und Inseln in Löchern). */
function outermost(polys: Point[][]): Point[][] {
  return polys.filter((poly, i) => !polys.some((other, j) => j !== i && pointInPolygon(poly[0], other)))
}

/** Versetzt geschlossene Pfade (Clipper-Ganzzahlen) um `deltaMm` mit runden Ecken. */
function offsetInt(paths: IntPath[], deltaMm: number): IntPath[] {
  const co = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE)
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
  const sol: IntPath[] = []
  co.Execute(sol, deltaMm * SCALE)
  return sol
}

/** Nur die äußeren (positiv orientierten) Pfade eines Clipper-Ergebnisses: verwirft Löcher. */
const outerOriented = (paths: IntPath[]): IntPath[] => paths.filter((p) => ClipperLib.Clipper.Orientation(p))

/** Kontur-Offset: Vereinigung aller Flächen, nur äußere Umrandung(en), um `offset` mm nach außen (runde Ecken). */
function offsetOutlines(base: Part[], offset: number, gap = 0, smooth = 0): Point[][] | null {
  const solids: Polyline[] = []
  const lines: Polyline[] = []
  const keys = new Map<string, number>()
  base.forEach((part, i) => {
    for (const pl of partPaths(part)) {
      if (pl.points.length < 2) continue
      if (isSolid(pl)) {
        // Jedes Quell-Element jedes Teils bekommt eine eigene Nummer (src ist nur innerhalb eines Teils eindeutig)
        const key = `${i}:${pl.src ?? 'x'}`
        let src = keys.get(key)
        if (src === undefined) { src = keys.size; keys.set(key, src) }
        solids.push({ points: pl.points, closed: true, filled: true, evenOdd: pl.src === undefined ? true : !!pl.evenOdd, src })
      } else {
        // Offene oder ungefüllte Pfade: als Linie mitnehmen (geschlossene Ringe wieder an den Anfang führen)
        lines.push({ points: pl.closed ? [...pl.points, pl.points[0]] : pl.points, closed: false })
      }
    }
  })
  if (solids.length === 0) return null

  const united = weldPaths(solids).filter((p) => p.closed && p.points.length >= 3).map((p) => p.points)
  let outers = outermost(united).map((pts) => {
    const ip = toInt(pts)
    return ClipperLib.Clipper.Orientation(ip) ? ip : ip.reverse()
  })
  // Lücken schließen (Closing mit Radius gap/2): aufblähen, Löcher verwerfen, wieder schrumpfen
  if (gap > 0) outers = offsetInt(outerOriented(offsetInt(outers, gap / 2)), -gap / 2)
  const co = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE)
  co.AddPaths(outers, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
  if (lines.length) co.AddPaths(lines.map((l) => toInt(l.points)), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenRound)
  let sol: IntPath[] = []
  co.Execute(sol, offset * SCALE)
  // Glättung: Closing rundet einspringende Ecken ab (Löcher entfallen ohnehin)
  if (smooth > 0) sol = offsetInt(outerOriented(offsetInt(outerOriented(sol), smooth)), -smooth)
  const cleaned = ClipperLib.Clipper.CleanPolygons(sol, CLEAN_DIST).filter((p) => p.length >= 3).map(fromInt)
  // Der Offset kann Lücken zu Löchern schließen: wieder nur die äußere(n) Umrandung(en)
  const result = outermost(cleaned).filter((pts) => polygonArea(pts) > 1e-6)
  return result.length ? result : null
}

/** Fertiges Rand-Part aus Konturen in Arbeitsflächen-Koordinaten (lokale Pfade, bbox-Ursprung (0,0), keine Drehung/Skalierung). */
function partFromWorld(name: string, sourcePath: string, world: Polyline[]): Part {
  const box = pathsBox(world)
  if (!box) throw new Error('Leerer Rand')
  return {
    id: uid(), name, sourcePath,
    paths: world.map((pl) => ({ points: pl.points.map((q) => ({ x: q.x - box.x, y: q.y - box.y })), closed: true, filled: false })),
    width: box.width, height: box.height, x: box.x, y: box.y, rotation: 0, scale: 1,
    role: 'border'
  }
}

/**
 * Erzeugt den Schnittrand um die übergebenen Teile (eine Einheit; Rand-Parts darin werden ignoriert). Das Ergebnis hat
 * noch keine groupId – die setzt `addBorderToParts`.
 *
 * - 'rect': Rechteck um die Gesamtbox aller echten Pfade + Abstand allseitig, optional mit abgerundeten Ecken.
 * - 'offset': Vereinigung aller gefüllten geschlossenen Konturen, um den Abstand nach außen versetzt (runde Ecken),
 *   Löcher werden verworfen. Mehrere getrennte Flächen ergeben je zusammenhängender Fläche eine Kontur (berühren sich
 *   die versetzten Flächen, verschmelzen sie zu einer). Reine Linienkunst (keine gefüllte geschlossene Kontur): Rückfall
 *   auf 'rect' (`fellBack`). Offene/ungefüllte Pfade neben gefüllten Flächen werden mit umschlossen.
 *
 * Wirft einen Error, wenn keine Geometrie vorhanden ist.
 */
export function buildBorder(units: Part[], opts: BorderOptions): BorderResult {
  const base = borderBase(units)
  const world = base.flatMap((p) => partPaths(p)).filter((p) => p.points.length >= 1)
  const box = pathsBox(world)
  if (!base.length || !box) throw new Error('Kein Bauteil für den Rand vorhanden')
  const off = Number.isFinite(opts.offsetMm) ? Math.min(1000, Math.max(0, opts.offsetMm)) : DEFAULT_BORDER.offsetMm
  const name = `${base[0].name} – Rand`
  const source = base[0].sourcePath

  let fellBack = false
  if (opts.mode === 'offset') {
    const gap = Number.isFinite(opts.gapMm) ? Math.min(100, Math.max(0, opts.gapMm as number)) : 0
    const smooth = Number.isFinite(opts.smoothMm) ? Math.min(100, Math.max(0, opts.smoothMm as number)) : 0
    const outlines = off > 0 ? offsetOutlines(base, off, gap, smooth) : null
    if (outlines) {
      return { part: partFromWorld(name, source, outlines.map((points) => ({ points, closed: true }))), mode: 'offset', fellBack: false }
    }
    fellBack = true
  }
  const r = Number.isFinite(opts.cornerRadiusMm) ? Math.max(0, opts.cornerRadiusMm as number) : 0
  const pts = roundedRectPoints(box.x - off, box.y - off, box.x + box.width + off, box.y + box.height + off, r)
  return { part: partFromWorld(name, source, [{ points: pts, closed: true }]), mode: 'rect', fellBack }
}

/** Kurzform von `buildBorder`, liefert nur das Part. */
export function makeBorder(units: Part[], opts: BorderOptions): Part {
  return buildBorder(units, opts).part
}

export interface AddBorderResult {
  parts: Part[]
  /** Auswahl danach: alle Mitglieder der (neuen) Gruppe. */
  selection: string[]
  borderId: string
  /** Ein vorhandener Rand wurde ersetzt. */
  replaced: boolean
  /** 'offset' war gewünscht, es gab aber nur Linienkunst -> Rechteck. */
  fellBack: boolean
  /** Mehrere lose Teile/Gruppen wurden dafür zu einer neuen Gruppe verbunden. */
  grouped: boolean
}

/**
 * Fügt der Einheit aus `ids` (Auswahl, berührte Gruppen komplett) einen Schnittrand hinzu bzw. ersetzt vorhandene Ränder
 * darin. Die Auswahl wird als EINE Einheit behandelt: ist sie genau eine Gruppe, kommt der Rand in diese Gruppe, sonst
 * werden alle Teile samt Rand zu einer neuen Gruppe verbunden. Null, wenn nichts Passendes gewählt ist.
 */
export function addBorderToParts(parts: Part[], ids: string[], opts: BorderOptions): AddBorderResult | null {
  const want = new Set(expandToGroups(parts, ids))
  const sel = parts.filter((p) => want.has(p.id))
  const base = borderBase(sel)
  if (!base.length) return null
  const oldBorders = new Set(sel.filter((p) => p.role === 'border').map((p) => p.id))
  const built = buildBorder(base, opts)
  const gids = new Set(base.map((p) => p.groupId ?? ''))
  const reuse = gids.size === 1 && !gids.has('') ? base[0].groupId : undefined
  const groupId = reuse ?? uid()
  const border: Part = { ...built.part, groupId }
  const next = parts
    .filter((p) => !oldBorders.has(p.id))
    .map((p) => (!reuse && want.has(p.id) ? { ...p, groupId } : p))
  next.push(border)
  const out = normalizeGroups(next)
  return {
    parts: out,
    selection: out.filter((p) => p.groupId === groupId).map((p) => p.id),
    borderId: border.id,
    replaced: oldBorders.size > 0,
    fellBack: built.fellBack,
    grouped: !reuse && base.length > 1
  }
}

/** Haben die Teile (mit ihren Gruppen) schon einen Schnittrand? */
export function hasBorder(parts: Part[], ids: string[]): boolean {
  const want = new Set(expandToGroups(parts, ids))
  return parts.some((p) => want.has(p.id) && p.role === 'border')
}

/** Entfernt die Schnittränder aus der Auswahl (inkl. berührter Gruppen). `removed` = Anzahl gelöschter Ränder. */
export function removeBorderFromParts(parts: Part[], ids: string[]): { parts: Part[]; selection: string[]; removed: number } {
  const want = new Set(expandToGroups(parts, ids))
  const drop = new Set(parts.filter((p) => want.has(p.id) && p.role === 'border').map((p) => p.id))
  if (!drop.size) return { parts, selection: [...want], removed: 0 }
  const out = normalizeGroups(parts.filter((p) => !drop.has(p.id)))
  const keep = [...want].filter((id) => !drop.has(id))
  return { parts: out, selection: expandToGroups(out, keep), removed: drop.size }
}
