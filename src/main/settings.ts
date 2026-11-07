import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { DEFAULT_CUT, DEFAULT_WORK_AREAS, type PersistedSettings, type WorkArea } from '@shared/types'

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function defaultSettings(): PersistedSettings {
  return {
    workAreas: DEFAULT_WORK_AREAS.map((w) => ({ ...w })),
    activeWorkArea: { ...DEFAULT_WORK_AREAS[0] },
    cut: { ...DEFAULT_CUT },
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
    lastFolder: typeof raw.lastFolder === 'string' ? raw.lastFolder : undefined,
    rootFolders: Array.isArray(raw.rootFolders) && raw.rootFolders.length > 0
      ? raw.rootFolders.filter((f) => typeof f === 'string')
      : def.rootFolders,
    weldOnImport: typeof raw.weldOnImport === 'boolean' ? raw.weldOnImport : true
  }
}

export async function saveSettings(s: PersistedSettings): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(file(), JSON.stringify(s, null, 2), 'utf8')
}
