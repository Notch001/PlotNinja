import { useEffect, useRef, useState } from 'react'
import { ChevronRight, FileDown, FilePlus2, FolderOpen, Save, SaveAll } from 'lucide-react'
import { useStore } from '../store'
import { baseName, newProject, openProjectPath, openProjectViaDialog, saveProject, saveProjectAs } from '../lib/project'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
const mod = isMac ? '⌘' : 'Strg+'

/** Datei-Menü der Kopfzeile: Neu, Öffnen, Speichern, Speichern unter, Zuletzt geöffnet. */
export function FileMenu(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const ref = useRef<HTMLDivElement>(null)
  const project = useStore((s) => s.project)

  useEffect(() => {
    if (!open) return
    setRecentOpen(false)
    window.api.getRecentProjects().then(setRecent).catch(() => setRecent([]))
    const onDown = (e: MouseEvent): void => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const run = (fn: () => void | Promise<unknown>) => (): void => { setOpen(false); void fn() }

  return (
    <div className="file-menu" ref={ref}>
      <button className={'btn ghost file-menu-btn' + (open ? ' open' : '')} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title="Projekt neu anlegen, öffnen und speichern">
        Datei
      </button>
      <span className="project-name" title={project.path ?? 'Noch nicht gespeichert'}>
        {project.name}{project.dirty ? <b className="dirty-star" title="Ungespeicherte Änderungen">*</b> : null}
      </span>
      {open && (
        <div className="menu" role="menu">
          <button className="menu-item" role="menuitem" onClick={run(newProject)}><FilePlus2 size={15} /> Neu <kbd>{mod}N</kbd></button>
          <button className="menu-item" role="menuitem" onClick={run(openProjectViaDialog)}><FolderOpen size={15} /> Öffnen … <kbd>{mod}O</kbd></button>
          <div className="menu-sep" />
          <button className="menu-item" role="menuitem" onClick={run(saveProject)}><Save size={15} /> Speichern <kbd>{mod}S</kbd></button>
          <button className="menu-item" role="menuitem" onClick={run(saveProjectAs)}><SaveAll size={15} /> Speichern unter … <kbd>{mod}Umschalt+S</kbd></button>
          <div className="menu-sep" />
          <div className="menu-sub" onMouseEnter={() => setRecentOpen(true)} onMouseLeave={() => setRecentOpen(false)}>
            <button className="menu-item" role="menuitem" aria-haspopup="menu" onClick={() => setRecentOpen(!recentOpen)} disabled={!recent.length}>
              <FileDown size={15} /> Zuletzt geöffnet <ChevronRight size={14} className="menu-chev" />
            </button>
            {recentOpen && recent.length > 0 && (
              <div className="menu submenu" role="menu">
                {recent.map((p) => (
                  <button key={p} className="menu-item" role="menuitem" title={p} onClick={run(async () => { await openProjectPath(p) })}>
                    <span className="menu-recent-name">{baseName(p)}</span>
                    <small>{p.slice(0, Math.max(0, p.length - baseName(p).length))}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
