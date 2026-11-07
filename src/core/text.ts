import type { Part, Point, Polyline } from '@shared/types'
import { flattenCubic } from './pathdata'
import { pathsBox } from './geom'
import { makePart, normalizePart } from './svg'
import { uid } from './uid'
import { weldPaths } from './weld'
import { t } from '@shared/i18n'

/* Minimale, zu opentype.js (Font/Glyph/Path) passende Schnittstellen – der Core hängt so nicht von der Bibliothek ab. */
export interface TextPathCommand { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }
export interface TextGlyph {
  index: number
  advanceWidth?: number
  getPath(x?: number, y?: number, fontSize?: number): { commands: TextPathCommand[] }
}
export interface TextFont {
  unitsPerEm: number
  ascender: number
  descender: number
  charToGlyph(c: string): TextGlyph
  getKerningValue?(left: TextGlyph, right: TextGlyph): number
}

export interface TextOptions {
  /** Schriftgröße = Höhe der Großbuchstaben in mm (gemessen am „H“). */
  sizeMm: number
  /** Zusätzlicher Abstand zwischen den Zeichen in mm (kann negativ sein). Standard 0. */
  letterSpacingMm?: number
  /** Faktor auf den Zeilenabstand der Schrift. Standard 1. */
  lineSpacing?: number
  /** true: jeder Buchstabe wird ein eigenes Bauteil (alle in einer Gruppe); false: ein einziges Bauteil. */
  asGroup?: boolean
  /** Mindestabweichung beim Zerlegen der Kurven in mm. */
  flatnessMm?: number
}

export interface TextResult {
  parts: Part[]
  /** Zeichen, die die Schrift nicht enthält (wurden ausgelassen). */
  missing: string[]
}

export const MAX_TEXT_CHARS = 2000

/** Höhe der Großbuchstaben in Schrifteinheiten (am „H“, sonst E/I, sonst 0,7 em). */
export function capHeightUnits(font: TextFont): number {
  for (const ch of ['H', 'E', 'I', 'T']) {
    const g = font.charToGlyph(ch)
    if (g.index === 0) continue
    let minY = 0
    // Nur Kurvenendpunkte: Kontrollpunkte können über die echte Kontur hinausragen
    for (const c of g.getPath(0, 0, font.unitsPerEm).commands) if (typeof c.y === 'number' && c.y < minY) minY = c.y
    if (minY < 0) return -minY
  }
  return font.unitsPerEm * 0.7
}

/** Zerlegt Glyphenbefehle (y nach unten) in geschlossene Konturen. */
function glyphContours(cmds: TextPathCommand[], tol: number): Point[][] {
  const out: Point[][] = []
  let cur: Point[] = []
  const flush = (): void => {
    if (cur.length >= 3) out.push(cur)
    cur = []
  }
  const last = (): Point => cur[cur.length - 1]
  for (const c of cmds) {
    switch (c.type) {
      case 'M': flush(); cur = [{ x: c.x as number, y: c.y as number }]; break
      case 'L': cur.push({ x: c.x as number, y: c.y as number }); break
      case 'C': if (cur.length) flattenCubic(last(), { x: c.x1 as number, y: c.y1 as number }, { x: c.x2 as number, y: c.y2 as number }, { x: c.x as number, y: c.y as number }, tol, cur); break
      case 'Q': {
        if (!cur.length) break
        const p0 = last(), q = { x: c.x1 as number, y: c.y1 as number }, p = { x: c.x as number, y: c.y as number }
        flattenCubic(p0, { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) }, { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) }, p, tol, cur)
        break
      }
      case 'Z': flush(); break
    }
  }
  flush()
  return out.map((pts) => {
    // Doppelten Schlusspunkt (== Startpunkt) und aufeinanderfolgende Duplikate entfernen
    const res: Point[] = []
    for (const p of pts) {
      const q = res[res.length - 1]
      if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) res.push(p)
    }
    if (res.length > 1 && Math.hypot(res[0].x - res[res.length - 1].x, res[0].y - res[res.length - 1].y) < 1e-6) res.pop()
    return res
  }).filter((pts) => pts.length >= 3 && pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
}

const preview = (text: string): string => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > 24 ? one.slice(0, 23) + '…' : one
}

/**
 * Wandelt Text in Bauteile um. Ursprung (0,0) = linke obere Ecke des Textblocks; der Aufrufer legt ihn auf der Matte ab.
 * Glyphenkonturen werden mit nonzero vereinigt (Weld): Löcher in o, a, e, 8 bleiben, überlappende Konturen verschmelzen.
 */
export function textToParts(font: TextFont, text: string, opts: TextOptions): TextResult {
  const size = opts.sizeMm
  if (!Number.isFinite(size) || size <= 0) throw new Error(t('text.sizeInvalid'))
  const spacing = Number.isFinite(opts.letterSpacingMm) ? (opts.letterSpacingMm as number) : 0
  const tol = opts.flatnessMm ?? 0.05
  const chars = Array.from(text.replace(/\r\n?/g, '\n')).slice(0, MAX_TEXT_CHARS)
  const k = size / capHeightUnits(font)
  const fontSize = font.unitsPerEm * k
  const lineStep = Math.max((font.ascender - font.descender) * k, size * 1.1) * (opts.lineSpacing ?? 1)

  const missing: string[] = []
  const glyphs: { ch: string; paths: Polyline[] }[] = []
  let line = 0, x = 0
  let prev: TextGlyph | null = null
  for (const ch of chars) {
    if (ch === '\n') { line++; x = 0; prev = null; continue }
    if (ch === '\t') { x += size * 2; prev = null; continue }
    const g = font.charToGlyph(ch)
    const blank = /\s/.test(ch)
    if (g.index === 0 && !blank) { if (!missing.includes(ch)) missing.push(ch); continue }
    if (prev && font.getKerningValue) {
      const kern = font.getKerningValue(prev, g)
      if (Number.isFinite(kern)) x += kern * k
    }
    if (!blank) {
      const contours = glyphContours(g.getPath(x, line * lineStep, fontSize).commands, tol)
      if (contours.length) {
        const src = glyphs.length
        glyphs.push({ ch, paths: contours.map((points) => ({ points, closed: true, filled: true, evenOdd: false, src })) })
      }
    }
    x += (g.advanceWidth ?? 0) * k + spacing
    prev = g
  }
  if (!glyphs.length) return { parts: [], missing }

  if (!opts.asGroup) {
    const welded = weldPaths(glyphs.flatMap((g) => g.paths))
    const part = makePart(normalizePart(welded), t('text.partName', { text: preview(text) }), '', 0, 0)
    return { parts: [part], missing }
  }
  const letters = glyphs.map((g) => ({ ch: g.ch, paths: weldPaths(g.paths) }))
  const total = pathsBox(letters.flatMap((l) => l.paths))
  if (!total) return { parts: [], missing }
  const groupId = uid()
  const parts = letters.map((l) => {
    const box = pathsBox(l.paths)
    if (!box) return null
    const part = makePart(normalizePart(l.paths), t('text.letterName', { ch: l.ch }), '', box.x - total.x, box.y - total.y)
    part.groupId = groupId
    return part
  }).filter((p): p is Part => p !== null)
  // Eine Gruppe aus nur einem Buchstaben ist keine Gruppe
  if (parts.length < 2) parts.forEach((p) => { delete p.groupId })
  return { parts, missing }
}
