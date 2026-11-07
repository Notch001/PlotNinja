import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, File as FileIcon, FileText, Folder, Image as ImageIcon, FolderOpen, FolderPlus, Loader2, Package, Search, Shapes, X } from 'lucide-react'
import type { FsEntry } from '@shared/types'
import { useStore } from '../store'
import { DND_TYPE, importKindOf, importTreeItems, type DragItem } from '../lib/importer'
import { isProjectFile, openProjectPath } from '../lib/project'
import { t as tg, formatNumber } from '@shared/i18n'
import { useT } from '../lib/useT'

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const isSvg = (n: string): boolean => /\.svg$/i.test(n)

/** Platzhalter-Symbol für Formate ohne Vorschau (DXF, PDF, Projekt). */
function FormatIcon({ name }: { name: string }): JSX.Element {
  const t = useT()
  const kind = importKindOf(name)
  return (
    <span className={'thumb placeholder ' + (kind ?? 'project')} title={kind === 'image' ? t('fileTree.icon.image') : kind ? kind.toUpperCase() : t('fileTree.icon.project')}>
      {kind === 'dxf' ? <Shapes size={14} /> : kind === 'pdf' ? <FileText size={14} /> : kind === 'image' ? <ImageIcon size={14} /> : <Package size={14} />}
    </span>
  )
}

const thumbCache = new Map<string, string | null>()
function Thumb({ path }: { path: string }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const [src, setSrc] = useState<string | null | undefined>(thumbCache.get(path))
  useEffect(() => {
    if (src !== undefined) return
    const el = ref.current
    if (!el) return
    let cancelled = false
    const obs = new IntersectionObserver((es) => {
      if (!es[0].isIntersecting) return
      obs.disconnect()
      window.api.readText(path).then((t) => {
        const url = t.length > 400_000 ? null : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(t)
        thumbCache.set(path, url)
        if (!cancelled) setSrc(url)
      }).catch(() => { thumbCache.set(path, null); if (!cancelled) setSrc(null) })
    })
    obs.observe(el)
    return () => { cancelled = true; obs.disconnect() }
  }, [path, src])
  return <span ref={ref} className="thumb">{src ? <img src={src} alt="" draggable={false} /> : <FileIcon size={14} />}</span>
}

interface Row { entry: FsEntry; depth: number; root?: boolean; rel?: string }

export function FileTree(): JSX.Element {
  const t = useT()
  const roots = useStore((s) => s.settings.rootFolders)
  const settingsLoaded = useStore((s) => s.settingsLoaded)
  const addRoot = useStore((s) => s.addRootFolder)
  const removeRoot = useStore((s) => s.removeRootFolder)
  const toast = useStore((s) => s.toast)
  const askConfirm = useStore((s) => s.askConfirm)

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [children, setChildren] = useState<Record<string, FsEntry[] | 'loading' | 'error'>>({})
  const [selected, setSelected] = useState<string[]>([])
  const lastClicked = useRef<string | null>(null)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState<FsEntry[] | 'loading' | null>(null)

  const load = useCallback(async (path: string) => {
    setChildren((c) => (c[path] && c[path] !== 'error' ? c : { ...c, [path]: 'loading' }))
    try {
      const entries = await window.api.listDir(path)
      setChildren((c) => ({ ...c, [path]: entries }))
    } catch (e) {
      setChildren((c) => ({ ...c, [path]: 'error' }))
      toast('error', tg('fileTree.error.readDir', { message: (e as Error).message }))
    }
  }, [toast])

  // Wurzeln beim Start aufklappen
  useEffect(() => {
    for (const r of roots) if (expanded[r] === undefined) { setExpanded((e) => ({ ...e, [r]: true })); void load(r) }
  }, [roots]) // eslint-disable-line react-hooks/exhaustive-deps

  // Suchindex (rekursiv, mit Obergrenze)
  useEffect(() => {
    if (!query.trim()) { setIndex(null); return }
    let cancelled = false
    setIndex('loading')
    ;(async () => {
      const files: FsEntry[] = []
      const stack = [...roots]
      while (stack.length && files.length < 3000 && !cancelled) {
        const d = stack.pop() as string
        try {
          for (const e of await window.api.listDir(d)) {
            if (e.isDir) stack.push(e.path)
            else if (importKindOf(e.name) || isProjectFile(e.name)) files.push(e)
          }
        } catch { /* überspringen */ }
      }
      if (!cancelled) setIndex(files)
    })()
    return () => { cancelled = true }
  }, [query, roots])

  const toggle = (e: FsEntry): void => {
    const open = !expanded[e.path]
    setExpanded((x) => ({ ...x, [e.path]: open }))
    if (open && children[e.path] === undefined) void load(e.path)
  }

  const rows: Row[] = []
  const q = query.trim().toLowerCase()
  if (q) {
    if (Array.isArray(index)) {
      for (const f of index) if (f.name.toLowerCase().includes(q)) rows.push({ entry: f, depth: 0, rel: f.path })
    }
  } else {
    const walk = (e: FsEntry, depth: number, root: boolean): void => {
      rows.push({ entry: e, depth, root })
      if (e.isDir && expanded[e.path]) {
        const ch = children[e.path]
        if (Array.isArray(ch)) for (const c of ch) walk(c, depth + 1, false)
      }
    }
    for (const r of roots) walk({ name: r, path: r, isDir: true }, 0, true)
  }

  const onRowClick = (e: React.MouseEvent, row: Row): void => {
    const p = row.entry.path
    if (e.shiftKey && lastClicked.current) {
      const a = rows.findIndex((r) => r.entry.path === lastClicked.current)
      const b = rows.findIndex((r) => r.entry.path === p)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSelected(rows.slice(lo, hi + 1).map((r) => r.entry.path))
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]))
    } else {
      setSelected([p])
      if (row.entry.isDir) toggle(row.entry)
    }
    lastClicked.current = p
  }

  const onDragStart = (e: React.DragEvent, row: Row): void => {
    const p = row.entry.path
    const paths = selected.includes(p) ? selected : [p]
    if (!selected.includes(p)) setSelected([p])
    const byPath = new Map(rows.map((r) => [r.entry.path, r.entry]))
    const items: DragItem[] = paths.map((x) => ({ path: x, isDir: byPath.get(x)?.isDir ?? false }))
    e.dataTransfer.setData(DND_TYPE, JSON.stringify(items))
    e.dataTransfer.setData('text/plain', paths.join('\n'))
    e.dataTransfer.effectAllowed = 'copy'
    if (items.length > 1) {
      const ghost = document.createElement('div')
      ghost.className = 'drag-ghost'
      ghost.textContent = t('fileTree.drag.count', { n: formatNumber(items.length) })
      document.body.appendChild(ghost)
      e.dataTransfer.setDragImage(ghost, 10, 10)
      setTimeout(() => ghost.remove(), 0)
    }
  }

  const pick = async (): Promise<void> => {
    try {
      const p = await window.api.pickFolder()
      if (p) addRoot(p)
    } catch (e) { toast('error', t('fileTree.error.pick', { message: (e as Error).message })) }
  }

  return (
    <aside className="left">
      <div className="panel-head">
        <h2>{t('fileTree.title')}</h2>
        <button className="btn small" onClick={() => void pick()} title={t('fileTree.addFolder.tooltip')}><FolderPlus size={14} /> {t('fileTree.addFolder')}</button>
      </div>
      <div className="search">
        <Search size={14} />
        <input placeholder={t('fileTree.search.placeholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && <button className="icon-btn tiny" onClick={() => setQuery('')} title={t('fileTree.search.clear')}><X size={13} /></button>}
      </div>
      <div className="tree" role="tree">
        {!roots.length && settingsLoaded && (
          <div className="empty-state">
            <FolderOpen size={30} />
            <p>{t('fileTree.empty')}</p>
            <button className="btn primary" onClick={() => void pick()}><FolderPlus size={14} /> {t('fileTree.addFolder')}</button>
          </div>
        )}
        {q && index === 'loading' && <div className="empty-mini"><Loader2 size={14} className="spin" /> {t('fileTree.searching')}</div>}
        {q && Array.isArray(index) && !rows.length && <div className="empty-mini">{t('fileTree.noMatches')}</div>}
        {rows.map((row) => {
          const { entry, depth, root } = row
          const isSel = selected.includes(entry.path)
          const ch = children[entry.path]
          return (
            <div
              key={entry.path}
              role="treeitem"
              className={'tree-row' + (isSel ? ' sel' : '') + (root ? ' root' : '')}
              style={{ paddingLeft: 6 + depth * 14 }}
              draggable
              onDragStart={(e) => onDragStart(e, row)}
              onClick={(e) => onRowClick(e, row)}
              onDoubleClick={() => { if (entry.isDir) return; if (isProjectFile(entry.name)) void openProjectPath(entry.path); else void importTreeItems([{ path: entry.path, isDir: false }]) }}
              title={entry.isDir ? t('fileTree.row.folder', { path: entry.path }) : isProjectFile(entry.name) ? t('fileTree.row.project', { path: entry.path }) : importKindOf(entry.name) === 'image' ? t('fileTree.row.image', { path: entry.path }) : t('fileTree.row.file', { path: entry.path })}
            >
              {entry.isDir ? (
                <ChevronRight size={14} className={'chev' + (expanded[entry.path] ? ' open' : '')} onClick={(e) => { e.stopPropagation(); toggle(entry) }} />
              ) : <span className="chev-pad" />}
              {entry.isDir ? (expanded[entry.path] ? <FolderOpen size={15} className="ico-folder" /> : <Folder size={15} className="ico-folder" />) : (isSvg(entry.name) ? <Thumb path={entry.path} /> : <FormatIcon name={entry.name} />)}
              <span className="tree-name">{root ? baseName(entry.path) : entry.name}{row.rel && <small>{row.rel.replace(entry.name, '')}</small>}</span>
              {ch === 'loading' && <Loader2 size={12} className="spin dim" />}
              {root && (
                <button
                  className="icon-btn tiny row-action" title={t('fileTree.removeFolder.tooltip')}
                  onClick={async (e) => { e.stopPropagation(); if (await askConfirm(t('fileTree.removeFolder.title'), t('fileTree.removeFolder.message', { path: entry.path }), t('fileTree.removeFolder.confirm'))) removeRoot(entry.path) }}
                ><X size={13} /></button>
              )}
            </div>
          )
        })}
      </div>
      <div className="panel-foot">
        {selected.length > 1 ? t('fileTree.foot.selected', { n: formatNumber(selected.length) }) : t('fileTree.foot.hint')}
      </div>
    </aside>
  )
}
