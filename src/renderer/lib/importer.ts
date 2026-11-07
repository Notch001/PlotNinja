import type { Part, Point } from '@shared/types'
import { assertImportSize, findFreeSpot, importDxf, importPdf, importSvg, partBounds, setPdfWorkerSrc } from '../core'
import { useStore } from '../store'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { isProjectFile, openProjectPath, openProjectText } from './project'

setPdfWorkerSrc(pdfWorkerUrl)

export const DND_TYPE = 'application/x-plotninja-file'
export interface DragItem { path: string; isDir: boolean }

export type ImportKind = 'svg' | 'dxf' | 'pdf'
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** Importformat nach Dateiendung (null = nicht unterstützt). */
export function importKindOf(name: string): ImportKind | null {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  const ext = m?.[1].toLowerCase()
  return ext === 'svg' || ext === 'dxf' || ext === 'pdf' ? ext : null
}
export const SUPPORTED_HINT = 'SVG, DXF oder PDF'

/** Alle importierbaren Dateien (SVG, DXF, PDF) in einem Ordner rekursiv (mit Obergrenze). */
export async function collectImportFiles(dir: string, limit = 500): Promise<string[]> {
  const out: string[] = []
  const stack = [dir]
  while (stack.length && out.length < limit) {
    const d = stack.pop() as string
    let entries
    try { entries = await window.api.listDir(d) } catch { continue }
    const sub: string[] = []
    for (const e of entries) {
      if (e.isDir) sub.push(e.path)
      else if (importKindOf(e.name)) out.push(e.path)
    }
    stack.push(...sub.reverse())
  }
  return out.slice(0, limit)
}

interface Source {
  name: string
  path: string
  kind: ImportKind
  /** Dateigröße in Bytes, falls vor dem Lesen bekannt (OS-Drop). */
  size?: number
  /** Dateiinhalt: Text für SVG/DXF, Bytes für PDF. */
  read: () => Promise<string | Uint8Array>
}

const treeSource = (p: string): Source => {
  const kind = importKindOf(p) as ImportKind
  return {
    name: baseName(p), path: p, kind,
    read: () => (kind === 'pdf' ? window.api.readBinary(p) : window.api.readText(p))
  }
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

async function addSources(sources: Source[], drop?: Point): Promise<void> {
  const st = useStore.getState()
  if (!sources.length) { st.toast('warn', `Keine ${SUPPORTED_HINT}-Dateien gefunden`); return }
  const wa = st.settings.activeWorkArea
  const created: Part[] = []
  const failed: string[] = []
  const notices: string[] = []
  let files = 0
  const weld = useStore.getState().settings.weldOnImport !== false
  const onNotice = (m: string): void => { notices.push(m) }
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i]
    st.setBusy({ label: `Importiere ${s.name} …`, done: i, total: sources.length })
    await tick()
    try {
      // Riesige Dateien (> 20 MB) gar nicht erst lesen bzw. verarbeiten; die übrigen Dateien des Drops laufen weiter
      if (s.size !== undefined) assertImportSize(s.size, 'Die Datei')
      const content = await s.read()
      assertImportSize(typeof content === 'string' ? content.length : content.byteLength, 'Die Datei')
      let parts: Part[]
      // Eine Datei = ein Bauteil, die Originalanordnung bleibt erhalten (split: false)
      if (s.kind === 'svg') parts = importSvg(content as string, s.name, s.path, { split: false, weld, onNotice })
      else if (s.kind === 'dxf') parts = importDxf(content as string, s.name, s.path, { split: false, weld: false, onNotice })
      else parts = await importPdf(content as Uint8Array, s.name, s.path, { split: false, weld, onNotice })
      if (!parts.length) { failed.push(`Datei ${s.name} konnte nicht gelesen werden: keine Pfade gefunden`); continue }
      files++
      created.push(...parts)
    } catch (e) {
      failed.push(`Datei ${s.name} konnte nicht gelesen werden: ${errText(e)}`)
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
  for (const n of notices.slice(0, 3)) st.toast('warn', n)
  // Fehler: jede Datei mit eigener Meldung (höchstens drei Toasts, Rest zusammengefasst)
  for (const f of failed.slice(0, 3)) st.toast('error', f)
  if (failed.length > 3) st.toast('error', `… und ${failed.length - 3} weitere Dateien konnten nicht gelesen werden`)
}

/** Dateien/Ordner aus dem Baum (interner Drag oder Doppelklick). */
export async function importTreeItems(items: DragItem[], drop?: Point): Promise<void> {
  const st = useStore.getState()
  const project = items.find((it) => !it.isDir && isProjectFile(it.path))
  if (project) {
    if (items.length > 1) st.toast('info', 'Ein Projekt wird allein geöffnet – die übrigen Dateien bitte danach hinzufügen')
    await openProjectPath(project.path)
    return
  }
  st.setBusy({ label: `Suche ${SUPPORTED_HINT}-Dateien …`, done: 0, total: 0 })
  const paths: string[] = []
  for (const it of items) {
    if (it.isDir) paths.push(...(await collectImportFiles(it.path)))
    else if (importKindOf(it.path)) paths.push(it.path)
    else st.toast('warn', `Datei ${baseName(it.path)} wird nicht unterstützt (erlaubt: ${SUPPORTED_HINT})`)
  }
  st.setBusy(null)
  const uniq = Array.from(new Set(paths))
  await addSources(uniq.map(treeSource), drop)
}

/** Dateien aus dem Betriebssystem (Explorer). */
export async function importOsFiles(files: File[], drop?: Point): Promise<void> {
  const st = useStore.getState()
  const pathOf = (f: File): string => {
    try { return window.api.getPathForFile(f) || f.name } catch { return f.name }
  }
  const proj = files.find((f) => isProjectFile(f.name))
  if (proj) {
    if (files.length > 1) st.toast('info', 'Ein Projekt wird allein geöffnet – die übrigen Dateien bitte danach hinzufügen')
    const path = pathOf(proj)
    await openProjectText(await proj.text().catch(() => ''), path, proj.name)
    return
  }
  const sources: Source[] = []
  const folderPaths: DragItem[] = []
  const unsupported: string[] = []
  for (const f of files) {
    const kind = importKindOf(f.name)
    if (kind) {
      sources.push({
        name: f.name, path: pathOf(f), kind, size: f.size,
        read: async () => (kind === 'pdf' ? new Uint8Array(await f.arrayBuffer()) : f.text())
      })
    } else if (!f.type) {
      // Möglicherweise ein Ordner
      let path = ''
      try { path = window.api.getPathForFile(f) } catch { /* ignorieren */ }
      if (path) folderPaths.push({ path, isDir: true })
      else unsupported.push(f.name)
    } else unsupported.push(f.name)
  }
  if (folderPaths.length) {
    const nested: string[] = []
    for (const fp of folderPaths) nested.push(...(await collectImportFiles(fp.path)))
    for (const p of nested) sources.push(treeSource(p))
  }
  if (unsupported.length) {
    st.toast('warn', `Nicht unterstützt: ${unsupported.slice(0, 3).join(', ')}${unsupported.length > 3 ? ` … (+${unsupported.length - 3})` : ''} (erlaubt: ${SUPPORTED_HINT})`)
  }
  if (!sources.length) {
    if (!unsupported.length) st.toast('warn', `Es wurden keine importierbaren Dateien erkannt – bitte ${SUPPORTED_HINT}-Dateien oder Ordner ziehen`)
    return
  }
  await addSources(sources, drop)
}
