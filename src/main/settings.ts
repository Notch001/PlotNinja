import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { sanitizeAfterCut } from '@core/aftercut'
import { sanitizeBorder } from '@core/borderSettings'
import { sanitizeNest } from '@core/nestSettings'
import { sanitizeProfiles } from '@core/materials'
import { DEFAULT_AFTER_CUT, DEFAULT_BORDER, DEFAULT_CUT, DEFAULT_NEST, DEFAULT_WORK_AREAS, type PersistedSettings, type WorkArea } from '@shared/types'

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function defaultSettings(): PersistedSettings {
  return {
    workAreas: DEFAULT_WORK_AREAS.map((w) => ({ ...w })),
    activeWorkArea: { ...DEFAULT_WORK_AREAS[0] },
    cut: { ...DEFAULT_CUT },
    afterCut: { ...DEFAULT_AFTER_CUT },
    borderDefaults: { ...DEFAULT_BORDER },
    nestDefaults: { ...DEFAULT_NEST },
    rootFolders: [app.getPath('documents')],
    weldOnImport: true
  }
}

function validArea(w: unknown): w is WorkArea {
  const a = w as WorkArea
  return !!a && typeof a.name === 'string' && a.width > 0 && a.height > 0
}

/** Lädt Einstellungen; fehlende oder ungültige Felder werden mit Defaults aufgefüllt. */
export async function loadSettings(): Promise<PersistedSettings> {
  const def = defaultSettings()
  let raw: Partial<PersistedSettings> = {}
  try {
    raw = JSON.parse(await fs.readFile(file(), 'utf8')) as Partial<PersistedSettings>
  } catch {
    return def
  }
  const workAreas = Array.isArray(raw.workAreas) ? raw.workAreas.filter(validArea) : []
  return {
    workAreas: workAreas.length > 0 ? workAreas : def.workAreas,
    activeWorkArea: validArea(raw.activeWorkArea) ? raw.activeWorkArea : (workAreas[0] ?? def.activeWorkArea),
    cut: { ...def.cut, ...(raw.cut ?? {}) },
    afterCut: sanitizeAfterCut(raw.afterCut),
    borderDefaults: sanitizeBorder(raw.borderDefaults),
    nestDefaults: sanitizeNest(raw.nestDefaults),
    lastFolder: typeof raw.lastFolder === 'string' ? raw.lastFolder : undefined,
    rootFolders: Array.isArray(raw.rootFolders) && raw.rootFolders.length > 0
      ? raw.rootFolders.filter((f) => typeof f === 'string')
      : def.rootFolders,
    weldOnImport: typeof raw.weldOnImport === 'boolean' ? raw.weldOnImport : true,
    materialProfiles: sanitizeProfiles(raw.materialProfiles)
  }
}

async function readRawRecents(): Promise<string[]> {
  try {
    const raw = JSON.parse(await fs.readFile(file(), 'utf8')) as Partial<PersistedSettings>
    return Array.isArray(raw.recentProjects) ? raw.recentProjects.filter((p) => typeof p === 'string') : []
  } catch {
    return []
  }
}

export async function saveSettings(s: PersistedSettings): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  // Die Liste der zuletzt geöffneten Projekte gehört dem Hauptprozess: der Renderer kennt sie nicht und darf sie nicht überschreiben.
  const recentProjects = await readRawRecents()
  await fs.writeFile(file(), JSON.stringify({ ...s, recentProjects }, null, 2), 'utf8')
}

const MAX_RECENT = 10

async function writeRecents(list: string[]): Promise<void> {
  let raw: Record<string, unknown> = {}
  try { raw = JSON.parse(await fs.readFile(file(), 'utf8')) as Record<string, unknown> } catch { /* neue Datei */ }
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(file(), JSON.stringify({ ...raw, recentProjects: list }, null, 2), 'utf8')
}

/** Zuletzt geöffnete Projekte (neueste zuerst); nicht mehr vorhandene Dateien werden entfernt und die Liste bereinigt gespeichert. */
export async function getRecentProjects(): Promise<string[]> {
  const stored = await readRawRecents()
  const existing: string[] = []
  for (const p of stored) {
    try { await fs.access(p); existing.push(p) } catch { /* Datei existiert nicht mehr */ }
  }
  const list = existing.slice(0, MAX_RECENT)
  if (list.length !== stored.length) await writeRecents(list).catch(() => undefined)
  return list
}

export async function addRecentProject(path: string): Promise<void> {
  const same = (a: string, b: string): boolean => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
  const list = [path, ...(await readRawRecents()).filter((p) => !same(p, path))].slice(0, MAX_RECENT)
  await writeRecents(list)
}
