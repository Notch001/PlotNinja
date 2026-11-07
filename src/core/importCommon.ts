import type { Part, Polyline } from '@shared/types'
import { makePart, normalizePart, splitToParts } from './svg'
import { weldPaths } from './weld'
import { dropInvalidPaths, limitPoints } from './sanitize'

/** Optionen für die Vektor-Importe DXF und PDF (SVG hat eigene `ImportOptions`). */
export interface VectorImportOptions {
  /** true: zusammengehörige Konturen in Einzelteile zerlegen (wie bei SVG). Standard: false. */
  split?: boolean
  /** true: überlappende, gefüllte Konturen vereinen. Standard: DXF false, PDF true. */
  weld?: boolean
  /** Hinweise an den Benutzer (z. B. ignorierte Elemente), vom Aufrufer als Toast anzeigbar. */
  onNotice?: (message: string) => void
}

/** Gemeinsamer Abschluss der Importe: filtern, optional vereinen, normalisieren, optional zerlegen. */
export function finishVectorImport(
  paths: Polyline[], fileName: string, sourcePath: string, opts: { split?: boolean; weld: boolean; onNotice?: (message: string) => void }, emptyMessage: string
): Part[] {
  const clean = dropInvalidPaths(paths)
  let all = clean.paths
  if (all.length === 0) throw new Error(emptyMessage)
  if (clean.dropped > 0) opts.onNotice?.(`${fileName}: ${clean.dropped} ungültige ${clean.dropped === 1 ? 'Pfad wurde' : 'Pfade wurden'} übersprungen.`)
  const lim = limitPoints(all)
  if (lim.simplified) {
    all = lim.paths
    opts.onNotice?.(`${fileName}: sehr viele Punkte (${lim.before.toLocaleString('de-DE')}) – die Pfade wurden auf ${lim.after.toLocaleString('de-DE')} Punkte vereinfacht (0,02 mm).`)
  }
  if (opts.weld) all = weldPaths(all)
  const base = fileName.replace(/\.[^./\\]+$/, '') || 'Teil'
  if (!opts.split) return [makePart(normalizePart(all), base, sourcePath, 0, 0)]
  return splitToParts(all, base, sourcePath)
}
