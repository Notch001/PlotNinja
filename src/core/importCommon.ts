import type { Part, Polyline } from '@shared/types'
import { makePart, normalizePart, splitToParts } from './svg'
import { weldPaths } from './weld'
import { dropInvalidPaths, droppedPathsNotice, limitPoints, simplifiedNotice } from './sanitize'
import { t } from '@shared/i18n'

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
  if (clean.dropped > 0) opts.onNotice?.(droppedPathsNotice(fileName, clean.dropped))
  const lim = limitPoints(all)
  if (lim.simplified) {
    all = lim.paths
    opts.onNotice?.(simplifiedNotice(fileName, lim.before, lim.after))
  }
  if (opts.weld) all = weldPaths(all)
  const base = fileName.replace(/\.[^./\\]+$/, '') || t('part.defaultName')
  if (!opts.split) return [makePart(normalizePart(all), base, sourcePath, 0, 0)]
  return splitToParts(all, base, sourcePath)
}
