import type { CutSettings, MaterialProfile } from '@shared/types'
import { DEFAULT_CUT } from '@shared/types'

/** Eingebaute Richtwerte (bitte immer mit einem Probeschnitt prüfen). */
export const BUILTIN_MATERIALS: MaterialProfile[] = [
  { name: 'Papier 80g', cut: { blade: 1, force: 8, speed: 8, passes: 1, overcut: 0 } },
  { name: 'Karton', cut: { blade: 4, force: 25, speed: 3, passes: 1, overcut: 0.5 } },
  { name: 'Vinyl', cut: { blade: 2, force: 10, speed: 5, passes: 1, overcut: 0.5 } },
  { name: 'Flexfolie', cut: { blade: 1, force: 14, speed: 4, passes: 1, overcut: 0 } },
  { name: 'Stoff/Filz', cut: { blade: 6, force: 30, speed: 2, passes: 2, overcut: 0 } }
]

export const MAX_PROFILE_NAME = 40
export const MAX_PROFILES = 100

const KEYS: (keyof CutSettings)[] = ['blade', 'force', 'speed', 'passes', 'overcut']
const RANGES: Record<keyof CutSettings, [number, number]> = {
  blade: [1, 10], force: [1, 33], speed: [1, 10], passes: [1, 5], overcut: [0, 5]
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Gleiche Namen (ohne Rücksicht auf Groß-/Kleinschreibung und Randleerzeichen). */
export const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Bereinigt einen Profilnamen (Leerraum, Länge). Leer = null. */
export function cleanProfileName(name: string): string | null {
  const n = name.replace(/\s+/g, ' ').trim().slice(0, MAX_PROFILE_NAME)
  return n || null
}

function cleanCut(raw: unknown): CutSettings | null {
  if (!isObj(raw)) return null
  const out = { ...DEFAULT_CUT }
  for (const k of KEYS) {
    const v = raw[k]
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    const [lo, hi] = RANGES[k]
    out[k] = Math.min(hi, Math.max(lo, v))
  }
  return out
}

/** Liest Profile aus unbekannten Daten (Einstellungsdatei, Import): ungültige Einträge und doppelte Namen entfallen. */
export function sanitizeProfiles(raw: unknown): MaterialProfile[] {
  if (!Array.isArray(raw)) return []
  const out: MaterialProfile[] = []
  for (const r of raw) {
    if (!isObj(r) || typeof r.name !== 'string') continue
    const name = cleanProfileName(r.name)
    const cut = cleanCut(r.cut)
    if (!name || !cut) continue
    if (out.some((p) => sameName(p.name, name)) || BUILTIN_MATERIALS.some((p) => sameName(p.name, name))) continue
    out.push({ name, cut })
    if (out.length >= MAX_PROFILES) break
  }
  return out
}

/** Name belegt durch ein eingebautes Material? */
export const isBuiltinName = (name: string): boolean => BUILTIN_MATERIALS.some((m) => sameName(m.name, name))

/** Legt ein Profil an oder überschreibt das gleichnamige. Fehler: leerer Name oder Name eines eingebauten Materials. */
export function upsertProfile(list: MaterialProfile[], name: string, cut: CutSettings): { list: MaterialProfile[]; error?: string; replaced?: boolean } {
  const n = cleanProfileName(name)
  if (!n) return { list, error: 'Bitte einen Namen eingeben.' }
  if (isBuiltinName(n)) return { list, error: `„${n}“ ist der Name eines eingebauten Materials – bitte einen anderen Namen wählen.` }
  const i = list.findIndex((p) => sameName(p.name, n))
  // Beim Überschreiben bleibt die vorhandene Schreibweise des Namens
  if (i >= 0) return { list: list.map((p, k) => (k === i ? { name: p.name, cut: { ...cut } } : p)), replaced: true }
  return { list: [...list, { name: n, cut: { ...cut } }] }
}

/** Benennt ein Profil um (Werte bleiben). Fehler bei leerem/doppeltem Namen. */
export function renameProfile(list: MaterialProfile[], oldName: string, newName: string): { list: MaterialProfile[]; error?: string } {
  const n = cleanProfileName(newName)
  if (!n) return { list, error: 'Bitte einen Namen eingeben.' }
  if (isBuiltinName(n)) return { list, error: `„${n}“ ist der Name eines eingebauten Materials – bitte einen anderen Namen wählen.` }
  if (list.some((p) => sameName(p.name, n) && !sameName(p.name, oldName))) return { list, error: `Ein Profil „${n}“ gibt es bereits.` }
  return { list: list.map((p) => (sameName(p.name, oldName) ? { ...p, name: n } : p)) }
}

export function deleteProfile(list: MaterialProfile[], name: string): MaterialProfile[] {
  return list.filter((p) => !sameName(p.name, name))
}

/** Passendes Profil (eingebaut oder eigen) zu den aktuellen Einstellungen; eigene zuerst. */
export function findMatchingProfile(cut: CutSettings, custom: MaterialProfile[]): { profile: MaterialProfile; builtin: boolean } | null {
  const eq = (p: MaterialProfile): boolean => KEYS.every((k) => Math.abs(p.cut[k] - cut[k]) < 1e-9)
  const c = custom.find(eq)
  if (c) return { profile: c, builtin: false }
  const b = BUILTIN_MATERIALS.find(eq)
  return b ? { profile: b, builtin: true } : null
}

/** Weichen die Werte des Profils von den aktuellen Einstellungen ab? */
export function isModified(profile: MaterialProfile, cut: CutSettings): boolean {
  return !KEYS.every((k) => Math.abs(profile.cut[k] - cut[k]) < 1e-9)
}

/**
 * Überschreibt die Werte des eigenen Profils `name` mit `cut` (bereinigt/begrenzt wie beim Laden).
 * Name und Reihenfolge bleiben. Eingebaute Profile sind nicht überschreibbar; unbekannter Name = Liste unverändert.
 */
export function updateProfile(list: MaterialProfile[], name: string, cut: CutSettings): { list: MaterialProfile[]; error?: string; changed: boolean; previous?: CutSettings } {
  if (isBuiltinName(name)) return { list, error: `„${name}“ ist ein eingebautes Material und kann nicht überschrieben werden.`, changed: false }
  const i = list.findIndex((p) => sameName(p.name, name))
  if (i < 0) return { list, error: `Ein Profil „${name}“ gibt es nicht (mehr).`, changed: false }
  const clean = cleanCut(cut)
  if (!clean) return { list, error: 'Ungültige Schnittwerte.', changed: false }
  const old = list[i]
  if (!isModified(old, clean)) return { list, changed: false, previous: old.cut }
  return { list: list.map((p, k) => (k === i ? { ...p, cut: clean } : p)), changed: true, previous: old.cut }
}

/** Zuletzt gewähltes Profil (Name; eingebaut oder eigen). */
export interface ActiveProfileRef { name: string; builtin: boolean }

/**
 * Bestimmt das anzuzeigende Profil: das zuletzt gewählte, solange es existiert (auch bei geänderten Werten);
 * passen die Werte genau zu einem anderen Profil, gilt dieses. Ohne Wahl: passendes Profil zu den Werten.
 */
export function resolveActiveProfile(cut: CutSettings, custom: MaterialProfile[], ref: ActiveProfileRef | null): { profile: MaterialProfile; builtin: boolean; modified: boolean } | null {
  if (ref) {
    const p = (ref.builtin ? BUILTIN_MATERIALS : custom).find((m) => sameName(m.name, ref.name))
    if (p) {
      const modified = isModified(p, cut)
      if (!modified) return { profile: p, builtin: ref.builtin, modified }
      const other = findMatchingProfile(cut, custom)
      if (other) return { ...other, modified: false }
      return { profile: p, builtin: ref.builtin, modified }
    }
  }
  const m = findMatchingProfile(cut, custom)
  return m ? { ...m, modified: false } : null
}
