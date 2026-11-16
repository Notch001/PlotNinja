import type { CutJob, CutSettings, Part, Point, Polyline, WorkArea } from '@shared/types'
import type { MessageKey } from '@shared/i18n'
import { t } from '@shared/i18n'
import { buildJob } from './job'
import { RANGES } from './materials'
import { TEST_CUT_HEIGHT_MM, TEST_CUT_WIDTH_MM, testCutPart } from './testcut'
import { uid } from './uid'

/**
 * Material-Einmessen-Assistent (reiner Kern ohne UI): Raster der Testplätze, Aufträge für Einzel- und Rastertests
 * und Vorschläge zur Anpassung der Schnittwerte.
 */

/** Urteil des Nutzers über einen Testschnitt. */
export type Verdict = 'good' | 'notThrough' | 'tooDeep' | 'cornersTorn' | 'liftsOff'
export const VERDICTS: Verdict[] = ['good', 'notThrough', 'tooDeep', 'cornersTorn', 'liftsOff']

/** Rastermaße (mm): Rand der Arbeitsfläche und Zellengröße eines Testplatzes (Muster 55 x 25 plus Strichmarken darüber). */
export const WIZARD_MARGIN_MM = 6
export const WIZARD_CELL_W_MM = 62
export const WIZARD_CELL_H_MM = 38
/** Höhe des Streifens mit den Strichmarken über dem Muster; die Marken selbst sind MARK_H hoch. */
const MARK_BAND_MM = 10
const MARK_H_MM = 5
const MARK_PITCH_MM = 2
export const WIZARD_MAX_MARKS = 9

/** Rastertest: Quadrate (Kantenlänge, Abstand von Mitte zu Mitte) und erlaubte Anzahl Varianten. */
export const GRID_SQUARE_MM = 15
export const GRID_PITCH_MM = 22
export const GRID_MIN_COUNT = 3
export const GRID_MAX_COUNT = 7

/** Höhe, die ein Testplatz tatsächlich belegt (Marken-Streifen + Muster). */
const SLOT_USED_H_MM = MARK_BAND_MM + TEST_CUT_HEIGHT_MM

/** Anzahl Testplätze je Zeile. */
export function slotsPerRow(workArea: WorkArea): number {
  const usable = workArea.width - 2 * WIZARD_MARGIN_MM - TEST_CUT_WIDTH_MM
  if (usable < -1e-9) return 0
  return Math.floor(usable / WIZARD_CELL_W_MM + 1e-9) + 1
}

/** Anzahl Zeilen auf der Arbeitsfläche. */
export function slotRows(workArea: WorkArea): number {
  const usable = workArea.height - 2 * WIZARD_MARGIN_MM - SLOT_USED_H_MM
  if (usable < -1e-9) return 0
  return Math.floor(usable / WIZARD_CELL_H_MM + 1e-9) + 1
}

/** Wie viele Testplätze passen auf die Arbeitsfläche (zeilenweise von links nach rechts)? */
export function slotCount(workArea: WorkArea): number {
  return slotsPerRow(workArea) * slotRows(workArea)
}

/** Linke obere Ecke (inkl. Marken-Streifen) des Testplatzes `slot` (ab 0); null = passt nicht (mehr). */
export function slotPosition(workArea: WorkArea, slot: number): Point | null {
  const cols = slotsPerRow(workArea)
  if (!Number.isInteger(slot) || slot < 0 || cols === 0 || slot >= slotCount(workArea)) return null
  return { x: WIZARD_MARGIN_MM + (slot % cols) * WIZARD_CELL_W_MM, y: WIZARD_MARGIN_MM + Math.floor(slot / cols) * WIZARD_CELL_H_MM }
}

/** Strichmarken als Bauteil: `n` senkrechte Striche (1..9) nebeneinander, linke obere Ecke bei (x, y). */
function marksPart(n: number, x: number, y: number): Part {
  const count = Math.max(1, Math.min(WIZARD_MAX_MARKS, Math.round(n)))
  const paths: Polyline[] = []
  for (let i = 0; i < count; i++) paths.push({ closed: false, points: [{ x: i * MARK_PITCH_MM, y: 0 }, { x: i * MARK_PITCH_MM, y: MARK_H_MM }] })
  return {
    id: uid(), name: t('part.testCutName'), sourcePath: '', paths,
    width: (count - 1) * MARK_PITCH_MM, height: MARK_H_MM, x, y, rotation: 0, scale: 1
  }
}

/** Breite der Strichmarken für `n` Striche (mm). */
const marksWidth = (n: number): number => (Math.max(1, Math.min(WIZARD_MAX_MARKS, Math.round(n))) - 1) * MARK_PITCH_MM

/**
 * Auftrag für Versuch Nummer `n` auf Testplatz `slot`: das Testmuster (Quadrat, Dreieck, Kreis) mit `n` Strichmarken darüber.
 * null = Platz passt nicht mehr auf die Arbeitsfläche. `ejectExtraMm` setzt das Ausfahren nach dem Schnitt.
 */
export function buildWizardJob(workArea: WorkArea, cut: CutSettings, slot: number, n: number, ejectExtraMm?: number): CutJob | null {
  const pos = slotPosition(workArea, slot)
  if (!pos) return null
  const pattern = testCutPart({ x: pos.x, y: pos.y + MARK_BAND_MM })
  // Marken mittig über dem Quadrat des Musters (die Strichmarken sind schmal)
  const marks = marksPart(n, pos.x + 10 - marksWidth(n) / 2, pos.y)
  const job = buildJob([marks, pattern], workArea, cut)
  return ejectExtraMm !== undefined ? { ...job, ejectExtraMm } : job
}

/** Welche Werte der Rastertest variiert. */
export type GridParam = 'force' | 'speed' | 'blade'

/** Auf den erlaubten Bereich begrenzter, ganzzahliger Wert eines Schnittparameters. */
function clampCut(key: keyof CutSettings, v: number): number {
  const [lo, hi] = RANGES[key]
  const x = Math.min(hi, Math.max(lo, v))
  return key === 'overcut' ? Math.round(x * 10) / 10 : Math.round(x)
}

/**
 * Varianten für den Rastertest: `count` (3..7) Werte ab `start` in Schritten von `step` für `param`, sonst die Werte von `base`.
 * Werte werden in den erlaubten Bereich geklemmt, doppelte Varianten entfallen (Reihenfolge bleibt).
 */
export function gridVariants(base: CutSettings, param: GridParam, start: number, step: number, count: number): CutSettings[] {
  const n = Math.max(GRID_MIN_COUNT, Math.min(GRID_MAX_COUNT, Math.round(count)))
  const out: CutSettings[] = []
  const seen = new Set<number>()
  for (let i = 0; i < n; i++) {
    const v = clampCut(param, start + i * step)
    if (seen.has(v)) continue
    seen.add(v)
    out.push({ ...base, [param]: v })
  }
  return out
}

/** Sinnvolle Standard-Schrittweite je variiertem Wert. */
export const GRID_DEFAULT_STEP: Record<GridParam, number> = { force: 2, speed: 1, blade: 1 }

/** Startwert und Schrittweite für ein Raster, das den aktuellen Wert von `param` in der Mitte der `count` Varianten hat. */
export function gridDefaults(cut: CutSettings, param: GridParam, count: number): { start: number; step: number } {
  const step = GRID_DEFAULT_STEP[param]
  const n = Math.max(GRID_MIN_COUNT, Math.min(GRID_MAX_COUNT, Math.round(count)))
  return { start: clampCut(param, cut[param] - step * Math.floor((n - 1) / 2)), step }
}

/** Zeile, in der ein Rastertest ab `startSlot` liegt: die laufende Zeile, wenn `startSlot` ihr Anfang ist, sonst die nächste. */
function gridRow(workArea: WorkArea, startSlot: number): number {
  const cols = slotsPerRow(workArea)
  return cols === 0 ? -1 : Math.ceil(Math.max(0, startSlot) / cols)
}

export interface GridPlan {
  /** Ein Auftrag je Variante (nacheinander zu senden); nur der letzte trägt ggf. `ejectExtraMm`. */
  jobs: CutJob[]
  /** Erster Testplatz der belegten Zeile. */
  firstSlot: number
  /** Nächster freier Testplatz (Anfang der nächsten Zeile). */
  nextSlot: number
  /** `nextSlot - startSlot`: so viele Plätze sind belegt bzw. übersprungen. */
  slotsUsed: number
}

/**
 * Rastertest: eine Reihe kleiner Quadrate (15 mm, Abstand 22 mm), je Variante eines mit 1..N Strichmarken als Nummer.
 * Belegt eine ganze Testplatz-Zeile; null = die Zeile oder die Varianten passen nicht auf die Arbeitsfläche.
 * Weil ein Auftrag nur EINE Schnitteinstellung hat, wird je Variante ein eigener Auftrag erzeugt.
 */
export function buildGridJobs(workArea: WorkArea, cuts: CutSettings[], startSlot: number, ejectExtraMm?: number): GridPlan | null {
  const n = cuts.length
  if (n < 1 || n > WIZARD_MAX_MARKS) return null
  const cols = slotsPerRow(workArea)
  const rows = slotRows(workArea)
  const row = gridRow(workArea, startSlot)
  if (cols === 0 || row < 0 || row >= rows) return null
  const rowWidth = (n - 1) * GRID_PITCH_MM + GRID_SQUARE_MM
  if (WIZARD_MARGIN_MM * 2 + rowWidth > workArea.width + 1e-9) return null
  const y0 = WIZARD_MARGIN_MM + row * WIZARD_CELL_H_MM
  const jobs = cuts.map((cut, i) => {
    const x = WIZARD_MARGIN_MM + i * GRID_PITCH_MM
    const sq = GRID_SQUARE_MM
    const square: Part = {
      id: uid(), name: t('part.testCutName'), sourcePath: '',
      paths: [{ closed: true, points: [{ x: 0, y: 0 }, { x: sq, y: 0 }, { x: sq, y: sq }, { x: 0, y: sq }] }],
      width: sq, height: sq, x, y: y0 + MARK_BAND_MM, rotation: 0, scale: 1
    }
    const marks = marksPart(i + 1, x + sq / 2 - marksWidth(i + 1) / 2, y0)
    const job = buildJob([marks, square], workArea, cut)
    return i === n - 1 && ejectExtraMm !== undefined ? { ...job, ejectExtraMm } : job
  })
  const firstSlot = row * cols
  const nextSlot = (row + 1) * cols
  return { jobs, firstSlot, nextSlot, slotsUsed: Math.max(0, nextSlot - Math.max(0, startSlot)) }
}

export interface Adjustment {
  cut: CutSettings
  /** Die Werte, die sich gegenüber `cut` der Eingabe geändert haben. */
  changed: (keyof CutSettings)[]
  /** Erklärtext (i18n-Schlüssel), warum so angepasst wird. */
  reasonKey: MessageKey
}

/**
 * Vorschlag für die nächsten Werte nach einem Urteil:
 * nicht durchgeschnitten -> mehr Druck (ab Druck 30 stattdessen ein Durchgang mehr); zu tief -> weniger Druck (und flachere Klinge);
 * Ecken ausgerissen -> langsamer und weniger Druck; Folie hebt sich ab -> langsamer. Immer innerhalb der erlaubten Bereiche.
 * `autoBlade === false` (Klinge von Hand): Der Text sagt dann, die Klinge am Messer zu verstellen.
 */
export function suggestAdjustment(cut: CutSettings, verdict: Verdict, autoBlade?: boolean): Adjustment {
  const next: CutSettings = { ...cut }
  const clamp = (key: keyof CutSettings, v: number): number => clampCut(key, v)
  let reasonKey: MessageKey = 'wizard.reason.good'
  switch (verdict) {
    case 'good':
      break
    case 'notThrough':
      if (cut.force >= 30) {
        next.passes = clamp('passes', cut.passes + 1)
        reasonKey = 'wizard.reason.notThroughPasses'
      } else {
        next.force = clamp('force', cut.force + 2)
        reasonKey = 'wizard.reason.notThrough'
      }
      break
    case 'tooDeep':
      next.force = clamp('force', cut.force - 2)
      if (cut.blade > 1) {
        next.blade = clamp('blade', cut.blade - 1)
        reasonKey = autoBlade === false ? 'wizard.reason.tooDeepBladeManual' : 'wizard.reason.tooDeepBlade'
      } else reasonKey = 'wizard.reason.tooDeep'
      break
    case 'cornersTorn':
      next.speed = clamp('speed', cut.speed - 1)
      next.force = clamp('force', cut.force - 1)
      reasonKey = 'wizard.reason.cornersTorn'
      break
    case 'liftsOff':
      next.speed = clamp('speed', cut.speed - 1)
      reasonKey = 'wizard.reason.liftsOff'
      break
  }
  const changed = (Object.keys(next) as (keyof CutSettings)[]).filter((k) => Math.abs(next[k] - cut[k]) > 1e-9)
  // Nichts mehr zu ändern (Grenze erreicht): eigener Hinweis statt einer Erklärung, die nicht mehr zutrifft
  if (verdict !== 'good' && changed.length === 0) reasonKey = 'wizard.reason.limit'
  return { cut: next, changed, reasonKey }
}
