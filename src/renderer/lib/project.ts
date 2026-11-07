import { parseProject, PROJECT_EXT, serializeProject, type ProjectData } from '../core'
import { useStore } from '../store'

/* Projekte speichern/öffnen, Ungespeichert-Abfrage, Autosave. Zustand (Pfad, Name, dirty) liegt im Store (`project`). */

const AUTOSAVE_MS = 60_000
const UNNAMED = 'Unbenannt'

let suppressDirty = false
let changeSeq = 0
let autosavedSeq = -1
let autosaveExists = false
let started = false

export const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p
export const projectNameOf = (path: string): string => baseName(path).replace(/\.plotninja$/i, '') || UNNAMED
export const isProjectFile = (name: string): boolean => /\.plotninja$/i.test(name)

function currentData(): ProjectData {
  const s = useStore.getState()
  return {
    parts: s.parts,
    workArea: s.settings.activeWorkArea,
    cut: s.settings.cut,
    weldOnImport: s.settings.weldOnImport !== false,
    view: s.autoFit ? undefined : s.view
  }
}

/** Ersetzt das gesamte Dokument (Teile, Arbeitsfläche, Schnitteinstellungen). Undo-Verlauf wird geleert, dirty zurückgesetzt. */
function applyProject(data: ProjectData | null, path: string | null, name: string, dirty = false): void {
  const st = useStore.getState()
  suppressDirty = true
  try {
    useStore.setState({ parts: data?.parts ?? [], selection: [], memberGroup: null, past: [], future: [] })
    if (data) {
      st.patchSettings({ activeWorkArea: data.workArea, cut: { ...st.settings.cut, ...data.cut }, weldOnImport: data.weldOnImport })
    }
    useStore.getState().setProject({ path, name, dirty })
  } finally { suppressDirty = false }
  changeSeq++
  setTimeout(() => useStore.getState().fit(), 0)
}

/** Fragt bei ungespeicherten Änderungen nach. true = weitermachen, false = abbrechen. */
export async function guardUnsaved(context: string): Promise<boolean> {
  const { project } = useStore.getState()
  if (!project.dirty) return true
  const choice = await useStore.getState().askUnsaved(
    'Ungespeicherte Änderungen',
    `Das Projekt „${project.name}“ hat ungespeicherte Änderungen. Vor dem ${context} speichern?`
  )
  if (choice === 'cancel') return false
  if (choice === 'save') return saveProject()
  return true
}

async function afterSaved(path: string): Promise<void> {
  useStore.getState().setProject({ path, name: projectNameOf(path), dirty: false })
  void window.api.addRecentProject(path).catch(() => undefined)
  await clearAutosave()
}

async function writeTo(path: string): Promise<boolean> {
  try {
    await window.api.writeText(path, serializeProject(currentData()))
    await afterSaved(path)
    useStore.getState().toast('success', `Projekt gespeichert: ${baseName(path)}`)
    return true
  } catch (e) {
    useStore.getState().toast('error', `Projekt konnte nicht gespeichert werden: ${(e as Error).message}`)
    return false
  }
}

export async function saveProject(): Promise<boolean> {
  const { project } = useStore.getState()
  return project.path ? writeTo(project.path) : saveProjectAs()
}

export async function saveProjectAs(): Promise<boolean> {
  const { project } = useStore.getState()
  try {
    const path = await window.api.saveProjectDialog(project.path ?? `${project.name}${PROJECT_EXT}`)
    if (!path) return false
    return writeTo(path)
  } catch (e) {
    useStore.getState().toast('error', `Speichern fehlgeschlagen: ${(e as Error).message}`)
    return false
  }
}

export async function newProject(): Promise<void> {
  if (!(await guardUnsaved('Anlegen eines neuen Projekts'))) return
  applyProject(null, null, UNNAMED)
  await clearAutosave()
}

/** Öffnet ein Projekt aus Text (z. B. gedroppte Datei). `path` kann null sein. */
export async function openProjectText(text: string, path: string | null, fileName: string, opts?: { skipGuard?: boolean }): Promise<boolean> {
  const st = useStore.getState()
  let data: ProjectData
  try {
    data = parseProject(text)
  } catch (e) {
    st.toast('error', `Datei ${fileName} konnte nicht gelesen werden: ${(e as Error).message}`)
    return false
  }
  if (!opts?.skipGuard && !(await guardUnsaved('Öffnen eines anderen Projekts'))) return false
  applyProject(data, path, projectNameOf(path ?? fileName))
  if (path) void window.api.addRecentProject(path).catch(() => undefined)
  await clearAutosave()
  st.toast('success', `Projekt geöffnet: ${fileName} (${data.parts.length} ${data.parts.length === 1 ? 'Bauteil' : 'Bauteile'})`)
  return true
}

export async function openProjectPath(path: string, opts?: { skipGuard?: boolean }): Promise<boolean> {
  let text: string
  try {
    text = await window.api.readText(path)
  } catch (e) {
    useStore.getState().toast('error', `Datei ${baseName(path)} konnte nicht gelesen werden: ${(e as Error).message}`)
    return false
  }
  return openProjectText(text, path, baseName(path), opts)
}

export async function openProjectViaDialog(): Promise<void> {
  try {
    if (!(await guardUnsaved('Öffnen eines anderen Projekts'))) return
    const path = await window.api.openProjectDialog()
    if (path) await openProjectPath(path, { skipGuard: true })
  } catch (e) {
    useStore.getState().toast('error', `Öffnen fehlgeschlagen: ${(e as Error).message}`)
  }
}

/** Fenster-Schließen vom Hauptprozess: nachfragen, dann bestätigen. */
async function handleCloseRequest(): Promise<void> {
  if (await guardUnsaved('Beenden')) await window.api.confirmClose()
}

/* ------------------------------------------------------------------ Autosave */

async function clearAutosave(): Promise<void> {
  autosaveExists = false
  autosavedSeq = -1
  try { await window.api.clearAutosave() } catch { /* ignorieren */ }
}

async function autosaveTick(): Promise<void> {
  const st = useStore.getState()
  if (!st.project.dirty) {
    if (autosaveExists) await clearAutosave()
    return
  }
  if (changeSeq === autosavedSeq) return
  const seq = changeSeq
  try {
    await window.api.writeAutosave(serializeProject(currentData()))
    autosaveExists = true
    autosavedSeq = seq
  } catch { /* Sicherung ist nur ein Zusatz */ }
}

function whenSettingsLoaded(): Promise<void> {
  return new Promise((resolve) => {
    if (useStore.getState().settingsLoaded) { resolve(); return }
    const unsub = useStore.subscribe((s) => { if (s.settingsLoaded) { unsub(); resolve() } })
  })
}

async function startup(): Promise<void> {
  await whenSettingsLoaded()
  const st = useStore.getState()
  try {
    const saved = await window.api.readAutosave()
    if (saved) {
      const ok = await st.askConfirm(
        'Letzte Sitzung wiederherstellen?',
        'PlotNinja wurde beim letzten Mal nicht ordnungsgemäß beendet. Es gibt eine automatische Sicherung deiner Arbeit. Möchtest du sie wiederherstellen?',
        'Wiederherstellen'
      )
      if (ok) {
        try {
          applyProject(parseProject(saved), null, 'Wiederhergestellt', true)
          autosaveExists = true
          st.toast('info', 'Sitzung wiederhergestellt – bitte speichern, um sie zu behalten')
        } catch (e) {
          st.toast('error', `Die Sicherung konnte nicht gelesen werden: ${(e as Error).message}`)
          await clearAutosave()
        }
      } else await clearAutosave()
    }
    const launch = await window.api.getLaunchFile()
    if (launch) await openProjectPath(launch)
  } catch { /* Start ohne Wiederherstellung */ }
}

/** Richtet Dirty-Tracking, Autosave, Schließen- und Datei-öffnen-Ereignisse ein. */
export function initProject(): () => void {
  const unsubs: (() => void)[] = []
  unsubs.push(useStore.subscribe((s, prev) => {
    if (suppressDirty || !prev.settingsLoaded) return
    const a = s.settings, b = prev.settings
    const changed = s.parts !== prev.parts
      || a.activeWorkArea.width !== b.activeWorkArea.width || a.activeWorkArea.height !== b.activeWorkArea.height
      || a.weldOnImport !== b.weldOnImport
      || a.cut !== b.cut && JSON.stringify(a.cut) !== JSON.stringify(b.cut)
    if (!changed) return
    changeSeq++
    if (!s.project.dirty) s.setProject({ dirty: true })
  }))
  const timer = setInterval(() => { void autosaveTick() }, AUTOSAVE_MS)
  unsubs.push(() => clearInterval(timer))
  unsubs.push(window.api.onCloseRequested(() => { void handleCloseRequest() }))
  unsubs.push(window.api.onOpenProjectRequest((p) => { void openProjectPath(p) }))
  if (window.api.platform === 'browser-mock') {
    const onUnload = (e: BeforeUnloadEvent): void => {
      if (useStore.getState().project.dirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', onUnload)
    unsubs.push(() => window.removeEventListener('beforeunload', onUnload))
  }
  if (!started) { started = true; void startup() }
  return () => unsubs.forEach((u) => u())
}

/** Nur für Tests/Debug: sofortiger Autosave-Lauf. */
export const runAutosaveNow = autosaveTick
