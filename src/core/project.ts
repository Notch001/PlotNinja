import type { CutSettings, Part, Polyline, WorkArea } from '@shared/types'
import { DEFAULT_CUT, DEFAULT_WORK_AREAS } from '@shared/types'
import { pathsBox } from './geom'
import { normalizeGroups } from './group'
import { uid } from './uid'

/** Kennung und aktuelle Version der Projektdatei (`.plotninja`, JSON). */
export const PROJECT_FORMAT = 'plotninja-project'
export const PROJECT_VERSION = 1
export const PROJECT_EXT = '.plotninja'

/** Grenzen gegen kaputte oder bösartige Dateien. */
const MAX_PROJECT_CHARS = 200 * 1024 * 1024
const MAX_PARTS = 5000
const MAX_POINTS = 5_000_000
const MAX_COORD = 1e7 // mm (10 km)

export interface ProjectView { zoom: number; panX: number; panY: number }

/** Inhalt eines Projekts, wie er gespeichert und geladen wird. */
export interface ProjectData {
  parts: Part[]
  workArea: WorkArea
  cut: CutSettings
  weldOnImport: boolean
  view?: ProjectView
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const r4 = (n: number): number => Math.round(n * 1e4) / 1e4

/** Serialisiert ein Projekt als kompaktes JSON (Koordinaten auf 0,0001 mm gerundet). */
export function serializeProject(data: ProjectData): string {
  const parts = data.parts.map((p) => ({
    id: p.id, name: p.name, sourcePath: p.sourcePath,
    width: r4(p.width), height: r4(p.height), x: r4(p.x), y: r4(p.y), rotation: r4(p.rotation), scale: p.scale,
    ...(p.groupId ? { groupId: p.groupId } : {}),
    paths: p.paths.map((pl) => ({
      closed: pl.closed,
      ...(pl.filled === false ? { filled: false } : {}),
      ...(pl.evenOdd ? { evenOdd: true } : {}),
      ...(pl.src !== undefined ? { src: pl.src } : {}),
      points: pl.points.map((q) => ({ x: r4(q.x), y: r4(q.y) }))
    }))
  }))
  return JSON.stringify({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    workArea: data.workArea,
    cut: data.cut,
    weldOnImport: data.weldOnImport,
    ...(data.view ? { view: data.view } : {}),
    parts
  })
}

function parsePolyline(raw: unknown, budget: { points: number }): Polyline | null {
  if (!isObj(raw) || !Array.isArray(raw.points)) return null
  const pts: { x: number; y: number }[] = []
  for (const q of raw.points) {
    if (!isObj(q) || !fin(q.x) || !fin(q.y) || Math.abs(q.x) > MAX_COORD || Math.abs(q.y) > MAX_COORD) return null
    pts.push({ x: q.x, y: q.y })
  }
  budget.points += pts.length
  if (budget.points > MAX_POINTS) throw new Error('Die Projektdatei ist zu groß (zu viele Punkte).')
  if (pts.length < 2) return null
  const pl: Polyline = { points: pts, closed: raw.closed === true && pts.length >= 3 }
  if (raw.filled === false) pl.filled = false
  if (raw.evenOdd === true) pl.evenOdd = true
  if (fin(raw.src)) pl.src = raw.src
  return pl
}

function parsePart(raw: unknown, index: number, ids: Set<string>, budget: { points: number }): Part {
  if (!isObj(raw)) throw new Error(`Bauteil ${index + 1} ist beschädigt.`)
  if (!Array.isArray(raw.paths)) throw new Error(`Bauteil ${index + 1} enthält keine Pfade.`)
  const paths: Polyline[] = []
  for (const p of raw.paths) {
    const pl = parsePolyline(p, budget)
    if (pl) paths.push(pl)
  }
  if (!paths.length) throw new Error(`Bauteil ${index + 1} enthält keine gültigen Pfade.`)
  let id = typeof raw.id === 'string' && raw.id && !ids.has(raw.id) ? raw.id : uid()
  while (ids.has(id)) id = uid()
  ids.add(id)
  const box = pathsBox(paths)
  const num = (v: unknown, def: number): number => (fin(v) && Math.abs(v) <= MAX_COORD ? v : def)
  const width = fin(raw.width) && raw.width > 0 ? raw.width : (box?.width ?? 0)
  const height = fin(raw.height) && raw.height > 0 ? raw.height : (box?.height ?? 0)
  const scale = fin(raw.scale) && raw.scale > 0 && raw.scale < 1e4 ? raw.scale : 1
  const part: Part = {
    id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : `Teil ${index + 1}`,
    sourcePath: typeof raw.sourcePath === 'string' ? raw.sourcePath : '',
    paths, width, height,
    x: num(raw.x, 0), y: num(raw.y, 0), rotation: num(raw.rotation, 0), scale
  }
  if (typeof raw.groupId === 'string' && raw.groupId) part.groupId = raw.groupId
  return part
}

function parseWorkArea(raw: unknown): WorkArea {
  if (isObj(raw) && fin(raw.width) && fin(raw.height) && raw.width > 0 && raw.height > 0 && raw.width <= 1e5 && raw.height <= 1e5) {
    return { name: typeof raw.name === 'string' && raw.name ? raw.name : 'Arbeitsfläche', width: raw.width, height: raw.height }
  }
  return { ...DEFAULT_WORK_AREAS[0] }
}

/** Übernimmt alle endlichen Zahlen aus `raw` über die Defaults (unbekannte Felder späterer Versionen bleiben erhalten). */
function parseCut(raw: unknown): CutSettings {
  const out: Record<string, unknown> = { ...DEFAULT_CUT }
  if (isObj(raw)) for (const [k, v] of Object.entries(raw)) if (fin(v) || typeof v === 'boolean') out[k] = v
  return out as unknown as CutSettings
}

function parseView(raw: unknown): ProjectView | undefined {
  if (isObj(raw) && fin(raw.zoom) && raw.zoom > 0 && fin(raw.panX) && fin(raw.panY)) return { zoom: raw.zoom, panX: raw.panX, panY: raw.panY }
  return undefined
}

/**
 * Liest eine Projektdatei. Fehlende Felder erhalten Standardwerte; bei ungültigem JSON, falschem Format,
 * zu neuer Version oder beschädigten Bauteilen wird ein Error mit deutscher Meldung geworfen.
 */
export function parseProject(text: string): ProjectData {
  if (text.length > MAX_PROJECT_CHARS) throw new Error('Die Projektdatei ist zu groß.')
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('Die Datei ist keine gültige PlotNinja-Projektdatei (kein lesbares JSON).')
  }
  if (!isObj(raw) || raw.format !== PROJECT_FORMAT) throw new Error('Die Datei ist keine PlotNinja-Projektdatei.')
  if (!fin(raw.version) || raw.version < 1) throw new Error('Die Projektdatei hat keine gültige Versionsangabe.')
  if (raw.version > PROJECT_VERSION) {
    throw new Error(`Die Projektdatei wurde mit einer neueren PlotNinja-Version erstellt (Dateiformat ${raw.version}, unterstützt: ${PROJECT_VERSION}). Bitte PlotNinja aktualisieren.`)
  }
  const rawParts = raw.parts === undefined ? [] : raw.parts
  if (!Array.isArray(rawParts)) throw new Error('Die Projektdatei ist beschädigt (Bauteilliste fehlt).')
  if (rawParts.length > MAX_PARTS) throw new Error(`Die Projektdatei enthält zu viele Bauteile (über ${MAX_PARTS}).`)
  const ids = new Set<string>()
  const budget = { points: 0 }
  const parts = normalizeGroups(rawParts.map((p, i) => parsePart(p, i, ids, budget)))
  return {
    parts,
    workArea: parseWorkArea(raw.workArea),
    cut: parseCut(raw.cut),
    weldOnImport: typeof raw.weldOnImport === 'boolean' ? raw.weldOnImport : true,
    view: parseView(raw.view)
  }
}
