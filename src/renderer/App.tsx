import { useEffect } from 'react'
import { useStore } from './store'
import { Header } from './components/Header'
import { FileTree } from './components/FileTree'
import { Workspace } from './components/Workspace'
import { RightColumn } from './components/RightPanels'
import { CutDialog } from './components/CutDialog'
import { TextDialog } from './components/TextDialog'
import { BusyBar, DialogHost, Toasts } from './components/Overlays'
import { importOsFiles } from './lib/importer'
import { initProject, newProject, openProjectViaDialog, saveProject, saveProjectAs } from './lib/project'

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      // Datei-Kürzel gelten auch in Eingabefeldern (aber nicht, solange ein Dialog offen ist)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && ['n', 'o', 's'].includes(e.key.toLowerCase()) && !useStore.getState().dialog && !useStore.getState().busy) {
        const k = e.key.toLowerCase()
        e.preventDefault()
        if (k === 'n') void newProject()
        else if (k === 'o') void openProjectViaDialog()
        else if (e.shiftKey) void saveProjectAs()
        else void saveProject()
        return
      }
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const st = useStore.getState()
      if (st.cutOpen || st.dialog || st.textOpen) return
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); st.undo() }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); st.redo() }
      else if (mod && k === 'a') { e.preventDefault(); st.selectAll() }
      else if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) st.ungroupSelected(); else st.groupSelected() }
      else if (mod && k === 'd') { e.preventDefault(); st.duplicateSelected() }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (st.selection.length) { e.preventDefault(); st.deleteSelected() } }
      else if (!mod && !e.altKey && e.shiftKey && (k === 'h' || k === 'v')) { if (st.selection.length) { e.preventDefault(); st.flipSelection(k) } }
      else if (e.key === 'Escape') st.select([])
      else if (e.key.startsWith('Arrow') && st.selection.length) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        st.nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function Splitter(): JSX.Element {
  const setW = useStore((s) => s.setLeftWidth)
  const onDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = useStore.getState().leftWidth
    document.body.classList.add('resizing')
    const move = (ev: PointerEvent): void => setW(startW + ev.clientX - startX)
    const up = (): void => {
      document.body.classList.remove('resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return <div className="splitter" onPointerDown={onDown} onDoubleClick={() => setW(280)} role="separator" aria-orientation="vertical" title="Ziehen, um die Breite anzupassen (Doppelklick = Standard)" />
}

export function App(): JSX.Element {
  const init = useStore((s) => s.init)
  const leftWidth = useStore((s) => s.leftWidth)
  const project = useStore((s) => s.project)
  useShortcuts()
  useEffect(() => init(), [init])
  useEffect(() => initProject(), [])
  // Unerwartete Fehler außerhalb von React (Promises, Handler): verständlicher Hinweis statt stillem Absturz
  useEffect(() => {
    let last = 0
    const report = (msg: string): void => {
      const now = Date.now()
      if (now - last < 4000) return
      last = now
      useStore.getState().toast('error', `Unerwarteter Fehler: ${msg}. Die Arbeit bleibt erhalten; bei Problemen speichern und PlotNinja neu starten.`)
    }
    const onRej = (e: PromiseRejectionEvent): void => report(e.reason instanceof Error ? e.reason.message : String(e.reason))
    const onErr = (e: ErrorEvent): void => { if (!/ResizeObserver/i.test(e.message)) report(e.message) }
    window.addEventListener('unhandledrejection', onRej)
    window.addEventListener('error', onErr)
    return () => { window.removeEventListener('unhandledrejection', onRej); window.removeEventListener('error', onErr) }
  }, [])
  // Fenstertitel: „PlotNinja – Name*“ (* = ungespeicherte Änderungen)
  useEffect(() => { document.title = `PlotNinja – ${project.name}${project.dirty ? '*' : ''}` }, [project.name, project.dirty])
  // Dateien, die außerhalb der Arbeitsfläche auf das Fenster fallen (z. B. .plotninja auf die Kopfzeile)
  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const over = (e: DragEvent): void => { if (hasFiles(e)) e.preventDefault() }
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      const handled = e.defaultPrevented // Arbeitsfläche hat den Drop bereits verarbeitet
      e.preventDefault()
      if (handled) return
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) void importOsFiles(files)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop) }
  }, [])
  return (
    <div className="app">
      <Header />
      <div className="main" style={{ gridTemplateColumns: `${leftWidth}px 5px minmax(300px, 1fr) 320px` }}>
        <FileTree />
        <Splitter />
        <Workspace />
        <RightColumn />
      </div>
      <BusyBar />
      <Toasts />
      <DialogHost />
      <CutDialog />
      <TextDialog />
    </div>
  )
}
