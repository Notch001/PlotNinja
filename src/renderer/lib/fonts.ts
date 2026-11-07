import type { TextFont } from '../core'

/** Eine auswählbare Schrift: gebündelt (Lizenz siehe README) oder aus dem Windows-Fonts-Ordner. */
export interface FontEntry {
  id: string
  name: string
  bundled: boolean
  /** Dateipfad bei Systemschriften. */
  path?: string
}

// Die gebündelten Schriften werden erst beim Bedarf geladen (eigene Chunks, als data:-URL eingebettet).
const bundledLoaders = import.meta.glob('../assets/fonts/*.ttf', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>

const BUNDLED_NAMES: Record<string, string> = {
  'BebasNeue-Regular': 'Bebas Neue – schmale Blockschrift',
  'OpenSans-Bold': 'Open Sans Fett – klare Schrift',
  'Pacifico-Regular': 'Pacifico – Schreibschrift'
}

export const BUNDLED_FONTS: FontEntry[] = Object.keys(bundledLoaders).map((key) => {
  const file = key.split('/').pop() as string
  const base = file.replace(/\.ttf$/i, '')
  return { id: 'bundled:' + base, name: BUNDLED_NAMES[base] ?? base, bundled: true, path: key }
}).sort((a, b) => a.name.localeCompare(b.name, 'de'))

/** Gebündelte Schriften zuerst, danach die installierten (sofern der Hauptprozess welche liefert). */
export async function listAllFonts(): Promise<FontEntry[]> {
  let system: FontEntry[] = []
  try {
    const files = await window.api.listFonts()
    system = files.map((f) => ({ id: 'system:' + f.path, name: f.name, bundled: false, path: f.path }))
  } catch { /* nur gebündelte Schriften */ }
  return [...BUNDLED_FONTS, ...system]
}

const cache = new Map<string, Promise<TextFont>>()

async function readBytes(entry: FontEntry): Promise<ArrayBuffer> {
  if (entry.bundled) {
    const load = bundledLoaders[entry.path as string]
    if (!load) throw new Error('Die Schrift wurde nicht gefunden.')
    const res = await fetch(await load())
    return res.arrayBuffer()
  }
  const bytes = await window.api.readBinary(entry.path as string)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Lädt und parst eine Schrift (zwischengespeichert). Wirft eine deutsche Fehlermeldung bei unlesbaren Dateien. */
export function loadFont(entry: FontEntry): Promise<TextFont> {
  let p = cache.get(entry.id)
  if (!p) {
    p = (async () => {
      try {
        const opentype = await import('opentype.js')
        return opentype.parse(await readBytes(entry)) as unknown as TextFont
      } catch (e) {
        cache.delete(entry.id)
        throw new Error(`Die Schrift „${entry.name}“ konnte nicht gelesen werden${e instanceof Error && e.message ? ` (${e.message})` : ''}.`)
      }
    })()
    cache.set(entry.id, p)
  }
  return p
}
