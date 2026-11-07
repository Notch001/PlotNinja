import type { Part, Polyline } from '@shared/types'
import { addBorderToParts, buildBorder } from './border'
import { translateParts } from './group'
import { makePart, normalizePart } from './svg'
import { traceImage, type ImageLike, type TraceOptions, type TraceResult } from './trace'
import { uid } from './uid'
import { t } from '@shared/i18n'

/** Einstellungen der Aufkleberkontur (Kontur-Offset um die Form, Außenkontur ohne Löcher). */
export interface StickerOptions {
  /** Abstand zur Form in mm. */
  offsetMm: number
  /** Lücken bis zu dieser Breite (mm) überbrücken, damit eine zusammenhängende Kontur entsteht. */
  gapMm: number
  /** Glättung der Kontur in mm (0 = aus), rundet auch einspringende Ecken. */
  smoothMm: number
}

export const DEFAULT_STICKER: StickerOptions = { offsetMm: 2, gapMm: 1, smoothMm: 0.5 }
export const STICKER_MAX_MM = 50

export interface ImageToPartsOptions {
  trace: Partial<TraceOptions>
  /** Aufkleberkontur hinzufügen. */
  sticker?: StickerOptions | null
  /** Nur die Kontur schneiden (das Bild selbst wird nicht als Pfade gesetzt). Setzt `sticker` voraus. */
  onlyContour?: boolean
  /** Bereits vorhandenes Ergebnis wiederverwenden (der Dialog hat es schon berechnet). */
  traced?: TraceResult
}

export interface ImageToPartsResult {
  /** Die neuen Teile, linke obere Ecke der Gesamtbox bei (0,0): Bild-Teil und/oder Kontur (gemeinsame Gruppe). */
  parts: Part[]
  traced: TraceResult
  /** Kontur konnte nicht erzeugt werden (z. B. nichts erkannt). */
  stickerFailed: boolean
}

const cleanName = (n: string): string => n.replace(/\.[^./\\]+$/, '') || t('part.defaultImageName')

/** Aufkleberkontur um beliebige Teile (Außenform, Lücken überbrückt). Das Ergebnis ist ein Rand-Teil ohne Gruppe. */
export function buildStickerContour(parts: Part[], s: StickerOptions): Part {
  const offsetMm = Math.max(0.1, Math.min(STICKER_MAX_MM, s.offsetMm))
  const part = buildBorder(parts, { mode: 'offset', offsetMm, gapMm: s.gapMm, smoothMm: s.smoothMm }).part
  return { ...part, name: t('part.contourName', { name: parts[0]?.name ?? t('part.defaultImageName') }) }
}

/**
 * Bild -> Bauteile: zeichnet nach und legt auf Wunsch eine Aufkleberkontur an.
 * - nur Bild: ein Teil (gefüllt, even-odd), Name = Dateiname
 * - mit Kontur: Bild-Teil + Kontur (`role: 'border'`) in einer Gruppe, die Kontur wird zuletzt geschnitten
 * - nur Kontur: ein normales, ungefülltes Teil „<Name> – Kontur“
 * Wirft keine Fehler bei leerem Ergebnis, sondern liefert `parts: []` (traced.empty).
 */
export function imageToParts(img: ImageLike, fileName: string, sourcePath: string, opts: ImageToPartsOptions): ImageToPartsResult {
  const traced = opts.traced ?? traceImage(img, opts.trace)
  if (traced.empty) return { parts: [], traced, stickerFailed: false }
  const base = cleanName(fileName)
  const norm = normalizePart(traced.paths)
  const imagePart = makePart(norm, base, sourcePath, 0, 0)
  // Die Bild-Teile liegen mit ihrer Ecke bei (0,0); die Kontur wird relativ dazu berechnet
  if (!opts.sticker) return { parts: [imagePart], traced, stickerFailed: false }

  let contour: Part
  try {
    contour = buildStickerContour([imagePart], opts.sticker)
  } catch {
    return { parts: [imagePart], traced, stickerFailed: true }
  }
  if (opts.onlyContour) {
    // Ein normales Teil, nicht Teil einer Gruppe: Rolle entfällt
    const { role: _role, ...rest } = contour
    void _role
    const paths: Polyline[] = rest.paths.map((p) => ({ ...p, filled: false }))
    const out = { ...rest, id: uid(), paths }
    return { parts: [shiftToOrigin(out)], traced, stickerFailed: false }
  }
  const grouped = addBorderToParts([imagePart], [imagePart.id], { mode: 'offset', offsetMm: Math.max(0.1, opts.sticker.offsetMm), gapMm: opts.sticker.gapMm, smoothMm: opts.sticker.smoothMm })
  if (!grouped) return { parts: [imagePart], traced, stickerFailed: true }
  const named = grouped.parts.map((p) => (p.id === grouped.borderId ? { ...p, name: contour.name } : p))
  return { parts: shiftToOrigin(named), traced, stickerFailed: false }
}

/** Verschiebt die Teile so, dass die linke obere Ecke ihrer Gesamtbox bei (0,0) liegt. */
function shiftToOrigin(parts: Part): Part
function shiftToOrigin(parts: Part[]): Part[]
function shiftToOrigin(parts: Part | Part[]): Part | Part[] {
  const list = Array.isArray(parts) ? parts : [parts]
  let minX = Infinity, minY = Infinity
  for (const p of list) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y) }
  const moved = translateParts(list, -minX, -minY)
  return Array.isArray(parts) ? moved : moved[0]
}
