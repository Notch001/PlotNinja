import type { Part, Point } from '@shared/types'
import { findFreeSpot, importSvg, partBounds } from '../core'
import { useStore } from '../store'

export const DND_TYPE = 'application/x-plotninja-file'
export interface DragItem { path: string; isDir: boolean }

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const isSvg = (n: string): boolean => /\.svg$/i.test(n)
const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** Alle SVG-Dateien in einem Ordner rekursiv (mit Obergrenze). */
export async function collectSvgFiles(dir: string, limit = 500): Promise<string[]> {
  const out: string[] = []
  const stack = [dir]
  while (stack.length && out.length < limit) {
    const d = stack.pop() as string
    let entries
    try { entries = await window.api.listDir(d) } catch { continue }
    const sub: string[] = []
    for (const e of entries) {
      if (e.isDir) sub.push(e.path)
      else if (isSvg(e.name)) out.push(e.path)
    }
    stack.push(...sub.reverse())
  }
  return out.slice(0, limit)
}

interface Source { name: string; path: string; text: () => Promise<string> }

async function addSources(sources: Source[], drop?: Point): Promise<void> {
  const st = useStore.getState()
  if (!sources.length) { st.toast('warn', 'Keine SVG-Dateien gefunden'); return }
  const wa = st.settings.activeWorkArea
  const created: Part[] = []
  const failed: string[] = []
  let files = 0
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i]
    st.setBusy({ label: `Importiere ${s.name} …`, done: i, total: sources.length })
    await tick()
    try {
      const text = await s.text()
      const parts = importSvg(text, s.name, s.path, { split: false }) // eine Datei = ein Bauteil, Originalanordnung bleibt erhalten
      if (!parts.length) { failed.push(s.name); continue }
      files++
      created.push(...parts)
    } catch (e) {
      failed.push(`${s.name} (${(e as Error).message})`)
    }
  }
  st.setBusy(null)

  // Platzieren
  const placed: Part[] = []
  let oversized = 0
  const existing = useStore.getState().parts
  created.forEach((p0, idx) => {
    let p = { ...p0 }
    if (p.width > wa.width * 0.95 || p.height > wa.height * 0.95) {
      p.scale = Math.min((wa.width * 0.9) / p.width, (wa.height * 0.9) / p.height)
      oversized++
    }
    const b = partBounds(p)
    if (drop && idx === 0) {
      let x = drop.x - b.width / 2, y = drop.y - b.height / 2
      if (b.width <= wa.width) x = Math.min(Math.max(x, 0), wa.width - b.width)
      if (b.height <= wa.height) y = Math.min(Math.max(y, 0), wa.height - b.height)
      p = { ...p, x: x - (b.x - p.x), y: y - (b.y - p.y) }
    } else {
      const spot = findFreeSpot(p, [...existing, ...placed], wa)
      p = { ...p, x: spot.x, y: spot.y }
    }
    placed.push(p)
  })

  if (placed.length) {
    useStore.getState().addParts(placed, true)
    const msg = sources.length === 1
      ? `${placed.length} ${placed.length === 1 ? 'Bauteil' : 'Bauteile'} hinzugefügt`
      : `${files} ${files === 1 ? 'Datei' : 'Dateien'} → ${placed.length} ${placed.length === 1 ? 'Bauteil' : 'Bauteile'} hinzugefügt`
    useStore.getState().toast('success', msg)
  }
  if (oversized) st.toast('info', `${oversized} ${oversized === 1 ? 'Bauteil war' : 'Bauteile waren'} größer als die Arbeitsfläche und wurde${oversized === 1 ? '' : 'n'} verkleinert`)
  if (failed.length) st.toast('error', `Nicht importiert: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ` … (+${failed.length - 3})` : ''}`)
}

/** Dateien/Ordner aus dem Baum (interner Drag oder Doppelklick). */
export async function importTreeItems(items: DragItem[], drop?: Point): Promise<void> {
  const st = useStore.getState()
  st.setBusy({ label: 'Suche SVG-Dateien …', done: 0, total: 0 })
  const paths: string[] = []
  for (const it of items) {
    if (it.isDir) paths.push(...(await collectSvgFiles(it.path)))
    else if (isSvg(it.path)) paths.push(it.path)
  }
  st.setBusy(null)
  const uniq = Array.from(new Set(paths))
  await addSources(uniq.map((p) => ({ name: baseName(p), path: p, text: () => window.api.readText(p) })), drop)
}

/** Dateien aus dem Betriebssystem (Explorer). */
export async function importOsFiles(files: File[], drop?: Point): Promise<void> {
  const sources: Source[] = []
  const folderPaths: DragItem[] = []
  for (const f of files) {
    if (isSvg(f.name)) {
      let path = f.name
      try { path = window.api.getPathForFile(f) || f.name } catch { /* Browser */ }
      sources.push({ name: f.name, path, text: () => f.text() })
    } else if (!f.type) {
      // Möglicherweise ein Ordner
      let path = ''
      try { path = window.api.getPathForFile(f) } catch { /* ignorieren */ }
      if (path) folderPaths.push({ path, isDir: true })
    }
  }
  if (folderPaths.length) {
    const nested: string[] = []
    for (const fp of folderPaths) nested.push(...(await collectSvgFiles(fp.path)))
    for (const p of nested) sources.push({ name: baseName(p), path: p, text: () => window.api.readText(p) })
  }
  if (!sources.length) { useStore.getState().toast('warn', 'Es wurden keine SVG-Dateien erkannt – bitte .svg-Dateien oder Ordner ziehen'); return }
  await addSources(sources, drop)
}
