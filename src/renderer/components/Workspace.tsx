import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, FileUp, Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import type { Part, Point, WorkArea } from '@shared/types'
import { isOutOfBounds, partBounds, partPaths } from '../core'
import { useStore } from '../store'
import { DND_TYPE, importOsFiles, importTreeItems, type DragItem } from '../lib/importer'
import { fmt, partCutLength, pathD, rotateParts, scaleParts, unionBounds, type Box } from '../lib/transform'

const RULER = 22

/* ---------- Matte ---------- */
const MatLayer = memo(function MatLayer({ wa, grid, zoom }: { wa: WorkArea; grid: boolean; zoom: number }): JSX.Element {
  const { fine, strong } = useMemo(() => {
    let f = '', s = ''
    for (let x = 0; x <= wa.width; x += 10) { const seg = `M${x} 0V${wa.height}`; if (x % 50 === 0) s += seg; else f += seg }
    for (let y = 0; y <= wa.height; y += 10) { const seg = `M0 ${y}H${wa.width}`; if (y % 50 === 0) s += seg; else f += seg }
    return { fine: f, strong: s }
  }, [wa.width, wa.height])
  const m = 10
  return (
    <g>
      <rect x={-m} y={-m} width={wa.width + m * 2} height={wa.height + m * 2} rx={3 / zoom} className="mat-board" />
      <rect x={0} y={0} width={wa.width} height={wa.height} className="mat-area" />
      {grid && zoom * 10 >= 5 && <path d={fine} className="grid-fine" />}
      {grid && <path d={strong} className="grid-strong" />}
      <rect x={0} y={0} width={wa.width} height={wa.height} className="mat-frame" />
    </g>
  )
})

/* ---------- Bauteil ---------- */
const PartView = memo(function PartView({ part, out, selected }: { part: Part; out: boolean; selected: boolean }): JSX.Element {
  const d = useMemo(() => partPaths(part).map((pl) => pathD(pl.points, pl.closed)).join(''), [part])
  return (
    <g data-part-id={part.id} className={'part' + (out ? ' out' : '') + (selected ? ' sel' : '')}>
      <path d={d} className="part-hit" fillRule="evenodd" />
      <path d={d} className="part-line" fill="none" />
    </g>
  )
})

/* ---------- Lineale ---------- */
const RULER_STEPS = [{ major: 5, minor: 1 }, { major: 10, minor: 1 }, { major: 20, minor: 5 }, { major: 50, minor: 10 }, { major: 100, minor: 10 }, { major: 200, minor: 50 }, { major: 500, minor: 100 }, { major: 1000, minor: 100 }]

function Rulers({ w, h }: { w: number; h: number }): JSX.Element {
  const view = useStore((s) => s.view)
  const cursor = useStore((s) => s.cursor)
  const { zoom, panX, panY } = view
  const step = RULER_STEPS.find((s) => s.major * zoom >= 64) ?? RULER_STEPS[RULER_STEPS.length - 1]
  const useMm = step.major < 10
  const geo = useMemo(() => {
    let hd = '', vd = ''
    const hl: { p: number; t: string }[] = [], vl: { p: number; t: string }[] = []
    const x0 = (RULER - panX) / zoom, x1 = (w - panX) / zoom
    for (let v = Math.floor(x0 / step.minor) * step.minor, n = 0; v <= x1 && n < 3000; v += step.minor, n++) {
      const px = panX + v * zoom
      if (px < RULER) continue
      const isMajor = Math.abs(v % step.major) < 1e-6
      hd += `M${px.toFixed(1)} ${RULER}v${isMajor ? -10 : -4}`
      if (isMajor) hl.push({ p: px, t: String(useMm ? v : v / 10) })
    }
    const y0 = (RULER - panY) / zoom, y1 = (h - panY) / zoom
    for (let v = Math.floor(y0 / step.minor) * step.minor, n = 0; v <= y1 && n < 3000; v += step.minor, n++) {
      const py = panY + v * zoom
      if (py < RULER) continue
      const isMajor = Math.abs(v % step.major) < 1e-6
      vd += `M${RULER} ${py.toFixed(1)}h${isMajor ? -10 : -4}`
      if (isMajor) vl.push({ p: py, t: String(useMm ? v : v / 10) })
    }
    return { hd, vd, hl, vl }
  }, [zoom, panX, panY, w, h, step.major, step.minor, useMm])
  return (
    <svg className="rulers" width={w} height={h}>
      <rect x={0} y={0} width={w} height={RULER} className="ruler-bg" />
      <rect x={0} y={0} width={RULER} height={h} className="ruler-bg" />
      <path d={geo.hd} className="ruler-tick" />
      <path d={geo.vd} className="ruler-tick" />
      {geo.hl.map((l) => <text key={'h' + l.p} x={l.p + 3} y={11} className="ruler-text">{l.t}</text>)}
      {geo.vl.map((l) => <text key={'v' + l.p} x={0} y={0} transform={`translate(10 ${l.p + 3}) rotate(-90)`} className="ruler-text" textAnchor="end">{l.t}</text>)}
      {cursor && <>
        <path d={`M${panX + cursor.x * zoom} 0V${RULER}`} className="ruler-cursor" />
        <path d={`M0 ${panY + cursor.y * zoom}H${RULER}`} className="ruler-cursor" />
      </>}
      <rect x={0} y={0} width={RULER} height={RULER} className="ruler-corner" />
      <text x={RULER / 2} y={14} textAnchor="middle" className="ruler-unit">{useMm ? 'mm' : 'cm'}</text>
    </svg>
  )
}

/* ---------- Snap ---------- */
function snapMove(b: Box, dx: number, dy: number, others: Box[], wa: WorkArea, thr: number): { dx: number; dy: number; gx: number[]; gy: number[] } {
  const tx = [0, wa.width / 2, wa.width], ty = [0, wa.height / 2, wa.height]
  for (const o of others) { tx.push(o.x, o.x + o.width / 2, o.x + o.width); ty.push(o.y, o.y + o.height / 2, o.y + o.height) }
  const axis = (pos: number, size: number, t: number[]): { d: number; guides: number[] } => {
    const cand = [pos, pos + size / 2, pos + size]
    let best = Infinity, adj = 0
    for (const c of cand) for (const v of t) { const diff = v - c; if (Math.abs(diff) < Math.abs(best)) { best = diff; adj = diff } }
    if (Math.abs(best) > thr) return { d: 0, guides: [] }
    const guides = new Set<number>()
    for (const c of cand) for (const v of t) if (Math.abs(v - (c + adj)) < 0.01) guides.add(v)
    return { d: adj, guides: [...guides] }
  }
  const ax = axis(b.x + dx, b.width, tx), ay = axis(b.y + dy, b.height, ty)
  return { dx: dx + ax.d, dy: dy + ay.d, gx: ax.guides, gy: ay.guides }
}

/* ---------- Drag-Zustand ---------- */
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot'
type Drag =
  | { k: 'pan'; sx: number; sy: number; px: number; py: number }
  | { k: 'move'; sx: number; sy: number; orig: Part[]; box: Box; others: Box[]; started: boolean }
  | { k: 'scale'; handle: Handle; anchor: Point; corner: Point; B: Box; orig: Part[]; started: boolean; sx: number; sy: number }
  | { k: 'rotate'; center: Point; a0: number; orig: Part[]; started: boolean; sx: number; sy: number }
  | { k: 'marquee'; start: Point; additive: boolean; base: string[]; sx: number; sy: number; moved: boolean }

const CURSORS: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'grab' }

export function Workspace(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const parts = useStore((s) => s.parts)
  const selection = useStore((s) => s.selection)
  const view = useStore((s) => s.view)
  const wa = useStore((s) => s.settings.activeWorkArea)
  const showGrid = useStore((s) => s.showGrid)
  const viewport = useStore((s) => s.viewport)
  const settingsLoaded = useStore((s) => s.settingsLoaded)
  const [marquee, setMarquee] = useState<Box | null>(null)
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const [dropHover, setDropHover] = useState(false)
  const [panMode, setPanMode] = useState(false)
  const [activeCursor, setActiveCursor] = useState<string | null>(null)
  const drag = useRef<Drag | null>(null)
  const space = useRef(false)
  const dragDepth = useRef(0)
  const fitted = useRef(false)

  const toMm = (cx: number, cy: number): Point => {
    const r = hostRef.current!.getBoundingClientRect()
    const v = useStore.getState().view
    return { x: (cx - r.left - v.panX) / v.zoom, y: (cy - r.top - v.panY) / v.zoom }
  }

  // Größe beobachten
  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const apply = (): void => useStore.getState().setViewport(el.clientWidth, el.clientHeight)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Beim ersten Mal einpassen (sobald Größe + Einstellungen bekannt)
  useEffect(() => {
    if (!fitted.current && settingsLoaded && viewport.w > 50) { fitted.current = true; useStore.getState().fit() }
  }, [settingsLoaded, viewport.w, viewport.h])

  // Mausrad-Zoom zum Cursor
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const st = useStore.getState()
      const r = el.getBoundingClientRect()
      const mx = e.clientX - r.left, my = e.clientY - r.top
      const v = st.view
      const nz = Math.min(40, Math.max(0.25, v.zoom * Math.exp(-e.deltaY * 0.0015)))
      const k = nz / v.zoom
      st.setView({ zoom: nz, panX: mx - (mx - v.panX) * k, panY: my - (my - v.panY) * k })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Leertaste = Hand-Werkzeug
  useEffect(() => {
    const isTyping = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
    const down = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !isTyping(e.target) && !useStore.getState().cutOpen) { e.preventDefault(); space.current = true; setPanMode(true) }
    }
    const up = (e: KeyboardEvent): void => { if (e.code === 'Space') { space.current = false; setPanMode(false) } }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  const selParts = useMemo(() => {
    const ids = new Set(selection)
    return parts.filter((p) => ids.has(p.id))
  }, [parts, selection])
  const selBox = useMemo(() => unionBounds(selParts), [selParts])
  const outIds = useMemo(() => new Set(parts.filter((p) => isOutOfBounds(p, wa)).map((p) => p.id)), [parts, wa])

  /* ----- Zeigerereignisse ----- */
  const onPointerMove = (e: PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const st = useStore.getState()
    const zoom = st.view.zoom
    if (d.k === 'pan') {
      st.setView({ zoom, panX: d.px + e.clientX - d.sx, panY: d.py + e.clientY - d.sy })
    } else if (d.k === 'move') {
      if (!d.started) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return
        d.started = true
        st.snapshot()
      }
      let dx = (e.clientX - d.sx) / zoom, dy = (e.clientY - d.sy) / zoom
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
      let gx: number[] = [], gy: number[] = []
      if (st.snapEnabled && !e.altKey) {
        const r = snapMove(d.box, dx, dy, d.others, st.settings.activeWorkArea, 7 / zoom)
        dx = r.dx; dy = r.dy; gx = r.gx; gy = r.gy
      }
      const m = new Map(d.orig.map((p) => [p.id, p]))
      st.setPartsLive((ps) => ps.map((p) => { const o = m.get(p.id); return o ? { ...p, x: o.x + dx, y: o.y + dy } : p }))
      setGuides({ x: gx, y: gy })
    } else if (d.k === 'scale') {
      if (!d.started) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 2) return
        d.started = true
        st.snapshot()
      }
      const p = toMm(e.clientX, e.clientY)
      let f: number
      if (d.handle === 'e' || d.handle === 'w') f = Math.abs(p.x - d.anchor.x) / d.B.width
      else if (d.handle === 'n' || d.handle === 's') f = Math.abs(p.y - d.anchor.y) / d.B.height
      else f = Math.hypot(p.x - d.anchor.x, p.y - d.anchor.y) / Math.max(1e-6, Math.hypot(d.corner.x - d.anchor.x, d.corner.y - d.anchor.y))
      f = Math.max(0.02, f)
      const res = new Map(scaleParts(d.orig, d.anchor, f).map((q) => [q.id, q]))
      st.setPartsLive((ps) => ps.map((q) => res.get(q.id) ?? q))
    } else if (d.k === 'rotate') {
      if (!d.started) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 2) return
        d.started = true
        st.snapshot()
      }
      const p = toMm(e.clientX, e.clientY)
      const a = Math.atan2(p.y - d.center.y, p.x - d.center.x)
      let delta = ((a - d.a0) * 180) / Math.PI
      if (e.shiftKey) {
        const base = d.orig.length === 1 ? d.orig[0].rotation : 0
        delta = Math.round((base + delta) / 15) * 15 - base
      }
      const res = new Map(rotateParts(d.orig, d.center, delta).map((q) => [q.id, q]))
      st.setPartsLive((ps) => ps.map((q) => res.get(q.id) ?? q))
    } else if (d.k === 'marquee') {
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return
      d.moved = true
      const p = toMm(e.clientX, e.clientY)
      const box: Box = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), width: Math.abs(p.x - d.start.x), height: Math.abs(p.y - d.start.y) }
      setMarquee(box)
      const hit = st.parts.filter((q) => {
        const b = partBounds(q)
        return b.x < box.x + box.width && b.x + b.width > box.x && b.y < box.y + box.height && b.y + b.height > box.y
      }).map((q) => q.id)
      st.select(d.additive ? Array.from(new Set([...d.base, ...hit])) : hit)
    }
  }
  const onPointerUp = (): void => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    drag.current = null
    setMarquee(null)
    setGuides({ x: [], y: [] })
    setActiveCursor(null)
  }
  const startDrag = (d: Drag, cursor?: string): void => {
    drag.current = d
    setActiveCursor(cursor ?? null)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }
  useEffect(() => () => { window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (e: React.PointerEvent): void => {
    const st = useStore.getState()
    const target = e.target as Element
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault()
      startDrag({ k: 'pan', sx: e.clientX, sy: e.clientY, px: st.view.panX, py: st.view.panY }, 'grabbing')
      return
    }
    if (e.button !== 0) return
    const handleEl = target.closest('[data-handle]')
    if (handleEl) {
      const handle = handleEl.getAttribute('data-handle') as Handle
      const sel = st.parts.filter((p) => st.selection.includes(p.id))
      const B = unionBounds(sel)
      if (!B) return
      if (handle === 'rot') {
        const center = { x: B.x + B.width / 2, y: B.y + B.height / 2 }
        const p = toMm(e.clientX, e.clientY)
        startDrag({ k: 'rotate', center, a0: Math.atan2(p.y - center.y, p.x - center.x), orig: sel, started: false, sx: e.clientX, sy: e.clientY }, 'grabbing')
      } else {
        const L = B.x, R = B.x + B.width, T = B.y, Bt = B.y + B.height, cx = B.x + B.width / 2, cy = B.y + B.height / 2
        const pos: Record<string, [Point, Point]> = {
          nw: [{ x: L, y: T }, { x: R, y: Bt }], ne: [{ x: R, y: T }, { x: L, y: Bt }], se: [{ x: R, y: Bt }, { x: L, y: T }], sw: [{ x: L, y: Bt }, { x: R, y: T }],
          n: [{ x: cx, y: T }, { x: cx, y: Bt }], s: [{ x: cx, y: Bt }, { x: cx, y: T }], e: [{ x: R, y: cy }, { x: L, y: cy }], w: [{ x: L, y: cy }, { x: R, y: cy }]
        }
        const [corner, anchor] = pos[handle]
        startDrag({ k: 'scale', handle, anchor, corner, B, orig: sel, started: false, sx: e.clientX, sy: e.clientY }, CURSORS[handle])
      }
      return
    }
    const partEl = target.closest('[data-part-id]')
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    if (partEl) {
      const id = partEl.getAttribute('data-part-id') as string
      const already = st.selection.includes(id)
      if (additive) {
        if (already) { st.select(st.selection.filter((x) => x !== id)); return }
        st.select([...st.selection, id])
      } else if (!already) st.select([id])
      beginMove(e)
      return
    }
    if (target.closest('[data-frame]')) { beginMove(e); return }
    // Leerer Bereich: Gummiband
    if (!additive) st.select([])
    startDrag({ k: 'marquee', start: toMm(e.clientX, e.clientY), additive, base: useStore.getState().selection, sx: e.clientX, sy: e.clientY, moved: false })
  }
  const beginMove = (e: React.PointerEvent): void => {
    const st = useStore.getState()
    const ids = new Set(st.selection)
    const sel = st.parts.filter((p) => ids.has(p.id))
    const box = unionBounds(sel)
    if (!box) return
    const others = st.parts.filter((p) => !ids.has(p.id)).map(partBounds)
    startDrag({ k: 'move', sx: e.clientX, sy: e.clientY, orig: sel, box, others, started: false }, 'move')
  }

  const onMouseMove = (e: React.MouseEvent): void => useStore.getState().setCursor(toMm(e.clientX, e.clientY))

  /* ----- Drop ----- */
  const accepts = (e: React.DragEvent): boolean => e.dataTransfer.types.includes(DND_TYPE) || e.dataTransfer.types.includes('Files')
  const onDragEnter = (e: React.DragEvent): void => { if (!accepts(e)) return; e.preventDefault(); dragDepth.current++; setDropHover(true) }
  const onDragOver = (e: React.DragEvent): void => { if (!accepts(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
  const onDragLeave = (): void => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDropHover(false) }
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    dragDepth.current = 0
    setDropHover(false)
    const pt = toMm(e.clientX, e.clientY)
    const internal = e.dataTransfer.getData(DND_TYPE)
    if (internal) {
      try {
        const items = JSON.parse(internal) as DragItem[]
        void importTreeItems(items, pt)
      } catch { useStore.getState().toast('error', 'Ungültige Drag-Daten') }
      return
    }
    const files = Array.from(e.dataTransfer.files)
    if (files.length) void importOsFiles(files, pt)
  }

  /* ----- Darstellung ----- */
  const z = view.zoom
  const hs = 9 / z
  const single = selParts.length === 1 ? selParts[0] : null
  const outCount = outIds.size
  const handles: { h: Handle; x: number; y: number }[] = selBox ? [
    { h: 'nw', x: selBox.x, y: selBox.y }, { h: 'n', x: selBox.x + selBox.width / 2, y: selBox.y }, { h: 'ne', x: selBox.x + selBox.width, y: selBox.y },
    { h: 'e', x: selBox.x + selBox.width, y: selBox.y + selBox.height / 2 }, { h: 'se', x: selBox.x + selBox.width, y: selBox.y + selBox.height },
    { h: 's', x: selBox.x + selBox.width / 2, y: selBox.y + selBox.height }, { h: 'sw', x: selBox.x, y: selBox.y + selBox.height },
    { h: 'w', x: selBox.x, y: selBox.y + selBox.height / 2 }
  ] : []

  return (
    <div className="workspace">
      <div
        ref={hostRef}
        className={'canvas-host' + (panMode ? ' panmode' : '') + (dropHover ? ' drop-hover' : '')}
        style={activeCursor ? { cursor: activeCursor } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onMouseMove}
        onPointerLeave={() => useStore.getState().setCursor(null)}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onAuxClick={(e) => e.preventDefault()}
        data-testid="canvas"
      >
        <svg className="canvas" width="100%" height="100%">
          <g transform={`translate(${view.panX} ${view.panY}) scale(${z})`}>
            <MatLayer wa={wa} grid={showGrid} zoom={z} />
            {selBox && (
              <rect data-frame x={selBox.x} y={selBox.y} width={selBox.width} height={selBox.height} fill="transparent" style={{ cursor: 'move' }} />
            )}
            {parts.map((p) => <PartView key={p.id} part={p} out={outIds.has(p.id)} selected={selection.includes(p.id)} />)}
            {guides.x.map((x) => <line key={'gx' + x} x1={x} x2={x} y1={-10} y2={wa.height + 10} className="guide" />)}
            {guides.y.map((y) => <line key={'gy' + y} y1={y} y2={y} x1={-10} x2={wa.width + 10} className="guide" />)}
            {selBox && (
              <g className="sel-overlay">
                {single && Math.abs(single.rotation) > 0.01 && (
                  <rect
                    x={single.x} y={single.y} width={single.width * single.scale} height={single.height * single.scale} className="sel-oriented"
                    transform={`rotate(${single.rotation} ${single.x + (single.width * single.scale) / 2} ${single.y + (single.height * single.scale) / 2})`}
                  />
                )}
                <rect x={selBox.x} y={selBox.y} width={selBox.width} height={selBox.height} className="sel-frame" />
                <line x1={selBox.x + selBox.width / 2} x2={selBox.x + selBox.width / 2} y1={selBox.y} y2={selBox.y - 22 / z} className="sel-frame" />
                <circle data-handle="rot" cx={selBox.x + selBox.width / 2} cy={selBox.y - 22 / z} r={5.5 / z} className="handle rot" style={{ cursor: 'grab' }} />
                {handles.map((h) => (
                  <rect key={h.h} data-handle={h.h} x={h.x - hs / 2} y={h.y - hs / 2} width={hs} height={hs} rx={1.5 / z} className="handle" style={{ cursor: CURSORS[h.h] }} />
                ))}
                <g transform={`translate(${selBox.x + selBox.width / 2} ${selBox.y + selBox.height + 16 / z}) scale(${1 / z})`} pointerEvents="none">
                  <rect x={-38} y={-9} width={76} height={18} rx={4} className="size-chip" />
                  <text x={0} y={4} textAnchor="middle" className="size-chip-text">{fmt(selBox.width)} × {fmt(selBox.height)} mm</text>
                </g>
              </g>
            )}
            {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} className="marquee" />}
          </g>
        </svg>
        <Rulers w={viewport.w} h={viewport.h} />

        {!parts.length && (
          <div className={'dropzone' + (dropHover ? ' hover' : '')}>
            <div className="dropzone-card">
              <span className="dropzone-icon"><FileUp size={34} strokeWidth={1.6} /></span>
              <h2>SVG-Dateien oder Ordner hierher ziehen</h2>
              <p>Ziehe Dateien aus dem Ordnerbaum links – oder direkt aus dem Explorer – auf die Matte.<br />Enthält eine Datei mehrere Formen, wird sie in einzelne Bauteile zerlegt.</p>
            </div>
          </div>
        )}
        {dropHover && parts.length > 0 && <div className="drop-overlay"><FileUp size={22} /> Zum Hinzufügen loslassen</div>}
        {outCount > 0 && (
          <div className="warn-chip"><AlertTriangle size={14} />{outCount} {outCount === 1 ? 'Bauteil ragt' : 'Bauteile ragen'} über die Arbeitsfläche hinaus</div>
        )}
        <div className="zoom-box">
          <button className="icon-btn" onClick={() => zoomBy(1 / 1.25)} title="Verkleinern"><ZoomOut size={15} /></button>
          <button className="icon-btn" onClick={() => zoomBy(1.25)} title="Vergrößern"><ZoomIn size={15} /></button>
          <button className="icon-btn" onClick={() => useStore.getState().fit()} title="Einpassen"><Maximize size={15} /></button>
        </div>
      </div>
      <StatusBar />
    </div>
  )

  function zoomBy(k: number): void {
    const st = useStore.getState()
    const v = st.view
    const cx = st.viewport.w / 2, cy = st.viewport.h / 2
    const nz = Math.min(40, Math.max(0.25, v.zoom * k))
    const f = nz / v.zoom
    st.setView({ zoom: nz, panX: cx - (cx - v.panX) * f, panY: cy - (cy - v.panY) * f })
  }
}

function StatusBar(): JSX.Element {
  const cursor = useStore((s) => s.cursor)
  const zoom = useStore((s) => s.view.zoom)
  const parts = useStore((s) => s.parts)
  const sel = useStore((s) => s.selection.length)
  const wa = useStore((s) => s.settings.activeWorkArea)
  const total = useMemo(() => parts.reduce((s, p) => s + partCutLength(p), 0), [parts])
  const len = total >= 1000 ? `${fmt(total / 1000, 2)} m` : `${fmt(total / 10, 1)} cm`
  // 100 % = 96 dpi (3,78 px/mm)
  const pct = Math.round((zoom / 3.7795) * 100)
  return (
    <div className="statusbar">
      <span className="mono" title="Mauszeiger-Position auf der Arbeitsfläche">{cursor ? `X ${fmt(cursor.x)} mm   Y ${fmt(cursor.y)} mm` : 'X – mm   Y – mm'}</span>
      <span>Zoom {pct} %</span>
      <span>{wa.width} × {wa.height} mm</span>
      <span className="spacer" />
      <span>{parts.length} {parts.length === 1 ? 'Teil' : 'Teile'}{sel > 0 ? `, ${sel} ausgewählt` : ''}</span>
      <span title="Gesamte Schnittlänge aller Bauteile (ohne Durchgänge)">Schnittlänge {len}</span>
    </div>
  )
}
