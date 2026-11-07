import type { Part, Polyline } from '@shared/types'
import { makePart, normalizePart, splitToParts } from './svg'
import { weldPaths } from './weld'

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
  paths: Polyline[], fileName: string, sourcePath: string, opts: { split?: boolean; weld: boolean }, emptyMessage: string
): Part[] {
  let all = paths.filter((p) => p.points.length >= 2 && p.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)))
  if (all.length === 0) throw new Error(emptyMessage)
  if (opts.weld) all = weldPaths(all)
  const base = fileName.replace(/\.[^./\\]+$/, '') || 'Teil'
  if (!opts.split) return [makePart(normalizePart(all), base, sourcePath, 0, 0)]
  return splitToParts(all, base, sourcePath)
}
