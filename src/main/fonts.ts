import { join, basename, extname } from 'path'
import { promises as fs } from 'fs'
import type { FontFile } from '@shared/types'

/** Ordner mit installierten Schriften (Windows: Systemordner und Benutzerordner; sonst übliche Orte für die Entwicklung). */
export function fontDirs(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string[] {
  if (platform === 'win32') {
    const dirs = [join(env.WINDIR || env.SystemRoot || 'C:\\Windows', 'Fonts')]
    if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'))
    return dirs
  }
  if (platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', join(env.HOME || '', 'Library', 'Fonts')]
  return ['/usr/share/fonts', join(env.HOME || '', '.fonts'), join(env.HOME || '', '.local', 'share', 'fonts')]
}

/** „arialbd“ -> „Arialbd“, „Open_Sans-Bold“ -> „Open Sans Bold“ (der echte Familienname steht erst in der Datei). */
export function fontDisplayName(file: string): string {
  const base = basename(file, extname(file)).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : file
}

/**
 * Sucht .ttf/.otf-Dateien (.ttc, .woff u. a. werden ignoriert), höchstens `maxDepth` Ebenen tief.
 * Nicht lesbare Ordner werden übersprungen. Ergebnis alphabetisch, ohne doppelte Pfade.
 */
export async function listFontFiles(dirs: string[], maxDepth = 3, limit = 3000): Promise<FontFile[]> {
  const out: FontFile[] = []
  const seen = new Set<string>()
  const walk = async (dir: string, depth: number): Promise<void> => {
    let items
    try { items = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const it of items) {
      if (out.length >= limit) return
      const full = join(dir, it.name)
      if (it.isDirectory()) { if (depth < maxDepth) await walk(full, depth + 1); continue }
      if (!it.isFile() && !it.isSymbolicLink()) continue
      if (!/\.(ttf|otf)$/i.test(it.name) || seen.has(full.toLowerCase())) continue
      seen.add(full.toLowerCase())
      out.push({ name: fontDisplayName(it.name), path: full })
    }
  }
  for (const d of dirs) await walk(d, 0)
  return out.sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base', numeric: true }))
}
