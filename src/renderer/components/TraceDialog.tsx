import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Info, Loader2, Pipette, ScanLine, Stamp, Wand2, X } from 'lucide-react'
import type { Part } from '@shared/types'
import {
  defaultWidthMm, findFreeSpot, hasSignificantAlpha, imageToParts, otsuThreshold, partPaths, scaleParts, scaleTrace, traceImage,
  translateParts, unionBox, DEFAULT_TRACE, type StickerOptions, type TraceMode, type TraceOptions, type TraceResult
} from '../core'
import { useStore } from '../store'
import { useTraceStore, type TraceJob } from '../lib/traceStore'
import { decodeImage, WARN_EDGE, type DecodedImage } from '../lib/imageDecode'
import { loadSticker, saveSticker } from '../lib/sticker'
import { fmt, pathD } from '../lib/transform'
import { useT } from '../lib/useT'
import { formatNumber } from '@shared/i18n'
import { NumberField } from './NumberField'
import { SliderField } from './RightPanels'

const LS_KEY = 'pn.trace'
interface Saved { speckle?: number; smooth?: number; simplify?: number; fillHoles?: boolean; stickerOn?: boolean; onlyContour?: boolean }
function lsLoad(): Saved {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Saved } catch { return {} }
}
function lsSave(v: Saved): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(v)) } catch { /* ignorieren */ }
}
const numOr = (v: unknown, def: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def)

/** Dialog „Bild nachzeichnen“: öffnet für das erste wartende Bild der Warteschlange. */
export function TraceDialog(): JSX.Element | null {
  const job = useTraceStore((s) => s.queue[0])
  if (!job) return null
  return <TraceDialogInner key={job.id} job={job} />
}

type WorkerMsg = { type: 'result'; id: number; result: TraceResult } | { type: 'error'; id: number; message: string }

function TraceDialogInner({ job }: { job: TraceJob }): JSX.Element {
  const t = useT()
  const saved = useMemo(lsLoad, [])
  const remaining = useTraceStore((s) => s.queue.length - 1)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [img, setImg] = useState<DecodedImage | null>(null)

  const [mode, setMode] = useState<TraceMode>('bw')
  const [thrBw, setThrBw] = useState(DEFAULT_TRACE.threshold)
  const [thrAlpha, setThrAlpha] = useState(128)
  const [autoThr, setAutoThr] = useState(128)
  const [invert, setInvert] = useState(false)
  const [speckle, setSpeckle] = useState(numOr(saved.speckle, DEFAULT_TRACE.speckle, 0, 200))
  const [smooth, setSmooth] = useState(numOr(saved.smooth, DEFAULT_TRACE.smooth, 0, 5))
  const [simplify, setSimplify] = useState(numOr(saved.simplify, DEFAULT_TRACE.simplifyPx, 0, 5))
  const [fillHoles, setFillHoles] = useState(saved.fillHoles === true)
  const [color, setColor] = useState<{ r: number; g: number; b: number } | undefined>(undefined)
  const [tolerance, setTolerance] = useState(DEFAULT_TRACE.tolerance)
  const [widthMm, setWidthMm] = useState(100)
  const [stickerOn, setStickerOn] = useState(saved.stickerOn === true)
  const [onlyContour, setOnlyContour] = useState(saved.onlyContour === true)
  const [sticker, setSticker] = useState<StickerOptions>(loadSticker)
  const [alpha, setAlpha] = useState(false)

  const [traced, setTraced] = useState<TraceResult | null>(null)
  const [tracing, setTracing] = useState(false)
  const [traceError, setTraceError] = useState('')
  const origRef = useRef<HTMLCanvasElement>(null)

  const next = useTraceStore((s) => s.next)
  const clear = useTraceStore((s) => s.clear)
  const wa = useStore((s) => s.settings.activeWorkArea)

  /* ----- Bild laden und decodieren ----- */
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const bytes = await job.read()
        const d = await decodeImage(bytes, job.name)
        if (!alive) return
        const al = hasSignificantAlpha(d)
        const otsu = otsuThreshold(d)
        setImg(d)
        setAlpha(al)
        setAutoThr(otsu)
        setThrBw(otsu)
        setMode(al ? 'alpha' : 'bw')
        setWidthMm(defaultWidthMm(d.origWidth))
        setPhase('ready')
        if (d.reduced && Math.max(d.origWidth, d.origHeight) > WARN_EDGE) {
          useStore.getState().toast('info', t('trace.toast.large', { name: job.name, w: d.origWidth, h: d.origHeight }))
        }
      } catch (e) {
        if (!alive) return
        setError(e instanceof Error ? e.message : String(e))
        setPhase('error')
      }
    })()
    return () => { alive = false }
  }, [job]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ----- Original anzeigen ----- */
  useEffect(() => {
    const c = origRef.current
    if (!c || !img) return
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext('2d')
    if (ctx) ctx.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0)
  }, [img, phase])

  /* ----- Nachzeichnen (Web Worker, sonst Hauptthread) ----- */
  const workerRef = useRef<Worker | null>(null)
  const inflight = useRef(false)
  const pending = useRef<Partial<TraceOptions> | null>(null)
  const imgRef = useRef<DecodedImage | null>(null)
  imgRef.current = img

  const finish = useCallback((r: TraceResult | null, err = ''): void => {
    inflight.current = false
    if (pending.current) { pump() ; return }
    setTracing(false)
    if (r) setTraced(r)
    setTraceError(err)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pumpRef = useRef<() => void>(() => undefined)
  const pump = (): void => pumpRef.current()
  pumpRef.current = (): void => {
    if (inflight.current || !pending.current || !imgRef.current) return
    const opts = pending.current
    pending.current = null
    inflight.current = true
    setTracing(true)
    const w = workerRef.current
    if (w) {
      w.postMessage({ type: 'trace', id: 0, opts })
    } else {
      // Rückfall ohne Worker: kurz warten, damit die Ladeanzeige erscheint, dann im Hauptthread rechnen
      setTimeout(() => {
        try { finish(traceImage(imgRef.current as DecodedImage, opts)) } catch (e) { finish(null, e instanceof Error ? e.message : String(e)) }
      }, 30)
    }
  }

  useEffect(() => {
    if (!img) return
    let w: Worker | null = null
    try {
      w = new Worker(new URL('../lib/traceWorker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent<WorkerMsg>): void => {
        if (e.data.type === 'result') finish(e.data.result)
        else finish(null, e.data.message)
      }
      w.onerror = (): void => {
        // Worker nicht nutzbar: auf den Hauptthread ausweichen und die laufende Anfrage wiederholen
        workerRef.current?.terminate()
        workerRef.current = null
        inflight.current = false
        pending.current = pending.current ?? lastOpts.current
        pump()
      }
      w.postMessage({ type: 'image', img: { width: img.width, height: img.height, data: img.data } })
    } catch { w = null }
    workerRef.current = w
    return () => { w?.terminate(); workerRef.current = null }
  }, [img]) // eslint-disable-line react-hooks/exhaustive-deps

  const nominalMm = img ? defaultWidthMm(img.origWidth) : 100
  const lastOpts = useRef<Partial<TraceOptions> | null>(null)
  const firstRun = useRef(true)
  useEffect(() => {
    if (!img || phase !== 'ready') return
    if (mode === 'color' && !color) { setTraced(null); setTracing(false); return }
    const opts: Partial<TraceOptions> = {
      mode, threshold: mode === 'alpha' ? thrAlpha : thrBw, invert, speckle, smooth, simplifyPx: simplify, fillHoles,
      widthMm: nominalMm, color, tolerance
    }
    lastOpts.current = opts
    const delay = firstRun.current ? 0 : 200
    firstRun.current = false
    setTracing(true)
    const timer = setTimeout(() => { pending.current = opts; pump() }, delay)
    return () => clearTimeout(timer)
  }, [img, phase, mode, thrBw, thrAlpha, invert, speckle, smooth, simplify, fillHoles, color, tolerance, nominalMm]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ----- Ergebnis als Bauteile (genau das, was übernommen wird) ----- */
  const built = useMemo(() => {
    if (!traced || !img || traced.empty) return null
    try {
      const scaled = scaleTrace(traced, widthMm / nominalMm)
      return imageToParts(img, job.name, job.path, { trace: {}, traced: scaled, sticker: stickerOn ? sticker : null, onlyContour: stickerOn && onlyContour })
    } catch { return null }
  }, [traced, img, widthMm, nominalMm, stickerOn, sticker, onlyContour, job])
  const parts: Part[] = built?.parts ?? []
  const box = useMemo(() => unionBox(parts), [parts])
  const shapeBox = useMemo(() => unionBox(parts.filter((p) => p.role !== 'border')), [parts])
  const ratio = img ? img.origHeight / img.origWidth : 1
  const empty = !!traced && traced.empty
  const tooBig = !!box && (box.width > wa.width * 0.95 || box.height > wa.height * 0.95)

  const previewPaths = useMemo(() => parts.map((p) => {
    const line = p.role === 'border' || p.paths.every((pl) => pl.filled === false)
    return { id: p.id, line, d: partPaths(p).map((pl) => pathD(pl.points, pl.closed)).join('') }
  }), [parts])
  const pad = box ? Math.max(box.width, box.height) * 0.04 : 1

  /* ----- Pipette ----- */
  const pick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (mode !== 'color' || !img) return
    const c = e.currentTarget
    const r = c.getBoundingClientRect()
    const s = Math.min(r.width / img.width, r.height / img.height)
    const ox = (r.width - img.width * s) / 2, oy = (r.height - img.height * s) / 2
    const x = Math.floor((e.clientX - r.left - ox) / s), y = Math.floor((e.clientY - r.top - oy) / s)
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
    const i = (y * img.width + x) * 4
    if (img.data[i + 3] < 128) return
    setColor({ r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] })
  }

  /* ----- Größe (Seitenverhältnis fest) ----- */
  const heightMm = widthMm * ratio

  /* ----- Schließen / Übernehmen ----- */
  const cancel = useCallback((): void => {
    if (useStore.getState().dialog) return
    next()
  }, [next])
  const apply = (): void => {
    if (!built || !built.parts.length || !box) return
    const st = useStore.getState()
    let list = built.parts
    let b = box
    let shrunk = false
    if (b.width > wa.width * 0.95 || b.height > wa.height * 0.95) {
      const f = Math.min((wa.width * 0.9) / b.width, (wa.height * 0.9) / b.height)
      list = scaleParts(list, { x: b.x, y: b.y }, f)
      b = unionBox(list) ?? b
      shrunk = true
    }
    let x: number, y: number
    if (job.drop) {
      x = job.drop.x - b.width / 2
      y = job.drop.y - b.height / 2
      x = Math.min(Math.max(x, 0), Math.max(0, wa.width - b.width))
      y = Math.min(Math.max(y, 0), Math.max(0, wa.height - b.height))
    } else {
      const probe: Part = { id: '_', name: '', sourcePath: '', paths: [], width: b.width, height: b.height, x: b.x, y: b.y, rotation: 0, scale: 1 }
      const spot = findFreeSpot(probe, st.parts, wa)
      x = spot.x; y = spot.y
    }
    const placed = translateParts(list, x - b.x, y - b.y)
    st.addParts(placed, true) // ein Undo-Schritt
    lsSave({ speckle, smooth, simplify, fillHoles, stickerOn, onlyContour })
    saveSticker(sticker)
    if (built.stickerFailed) st.toast('warn', t('trace.toast.stickerFailed'))
    st.toast('success', stickerOn && !onlyContour ? t('trace.toast.doneSticker', { name: job.name, n: placed.length }) : stickerOn ? t('trace.toast.doneStickerOnly', { name: job.name }) : t('trace.toast.done', { name: job.name }))
    if (shrunk) st.toast('info', t('trace.toast.shrunk'))
    next()
  }
  const applyRef = useRef(apply)
  applyRef.current = apply
  const cancelAll = (): void => clear()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel()
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyRef.current() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancel])

  const modes: { id: TraceMode; label: string; tip: string }[] = [
    { id: 'bw', label: t('trace.mode.bw'), tip: t('trace.mode.bw.tip') },
    { id: 'alpha', label: t('trace.mode.alpha'), tip: t('trace.mode.alpha.tip') },
    { id: 'color', label: t('trace.mode.color'), tip: t('trace.mode.color.tip') }
  ]
  const swatch = color ? `rgb(${color.r}, ${color.g}, ${color.b})` : 'transparent'

  return (
    <div className="modal-backdrop" onMouseDown={cancel}>
      <div className={'modal trace-dialog' + (phase === 'ready' ? ' tall' : '')} role="dialog" aria-modal="true" aria-label={t('trace.title')} onMouseDown={(e) => e.stopPropagation()} data-testid="trace-dialog">
        <div className="modal-head">
          <h2><ScanLine size={17} /> {t('trace.title')} <small className="trace-file">{remaining > 0 ? t('trace.file.remaining', { name: job.name, n: remaining }) : job.name}</small></h2>
          <button className="icon-btn" onClick={cancel} title={t('trace.close')}><X size={16} /></button>
        </div>

        {phase === 'loading' && <div className="trace-state"><Loader2 size={20} className="spin" /> {t('trace.loading')}</div>}
        {phase === 'error' && (
          <div className="trace-state err" data-testid="trace-error">
            <AlertTriangle size={20} />
            <div>
              <b>{t('trace.error.title', { name: job.name })}</b>
              <p>{error}</p>
              <p className="subtle">{remaining > 0 ? t('trace.error.noteNext') : t('trace.error.note')}</p>
            </div>
          </div>
        )}

        {phase === 'ready' && img && (
          <div className="modal-body trace-body">
            <div className="trace-panes">
              <div className="trace-pane">
                <div className="pane-title">{t('trace.original')} <small>{t('trace.size.px', { w: img.origWidth, h: img.origHeight })}</small></div>
                <div className={'trace-view checker' + (mode === 'color' ? ' pipette' : '')}>
                  <canvas ref={origRef} onClick={pick} data-testid="trace-original" title={mode === 'color' ? t('trace.original.pickTip') : undefined} />
                </div>
              </div>
              <div className="trace-pane">
                <div className="pane-title">{t('trace.result')} <small>{parts.length ? t('trace.size.mm', { w: fmt(shapeBox?.width ?? 0), h: fmt(shapeBox?.height ?? 0) }) : ''}</small></div>
                <div className="trace-view result" data-testid="trace-result">
                  {box && (
                    <svg viewBox={`${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`} preserveAspectRatio="xMidYMid meet">
                      {previewPaths.map((p) => <path key={p.id} d={p.d} className={p.line ? 'trace-line' : 'trace-fill'} fillRule="evenodd" />)}
                    </svg>
                  )}
                  {empty && (
                    <div className="trace-empty" data-testid="trace-empty">
                      <AlertTriangle size={20} />
                      <b>{t('trace.empty.title')}</b>
                      <span>{mode === 'color' ? t('trace.empty.color') : t('trace.empty.threshold')}</span>
                    </div>
                  )}
                  {mode === 'color' && !color && !tracing && <div className="trace-empty"><Pipette size={20} /><b>{t('trace.pickColor.title')}</b><span>{t('trace.pickColor.text')}</span></div>}
                  {tracing && <span className="preview-busy" data-testid="trace-busy"><Loader2 size={14} className="spin" /> {t('trace.busy')}</span>}
                </div>
              </div>
            </div>

            <div className="trace-controls">
              <div className="seg seg3" role="group" aria-label={t('trace.mode.group')}>
                {modes.map((m) => (
                  <button key={m.id} className={mode === m.id ? 'on' : ''} aria-pressed={mode === m.id} onClick={() => setMode(m.id)} title={m.tip} data-testid={'trace-mode-' + m.id}>{m.label}</button>
                ))}
              </div>
              {alpha && mode !== 'alpha' && <p className="hint subtle"><Info size={12} />{t('trace.hint.hasAlpha')}</p>}
              {!alpha && mode === 'alpha' && <p className="hint warn"><AlertTriangle size={14} />{t('trace.hint.noAlpha')}</p>}

              {mode === 'bw' && (
                <div className="thr-row">
                  <SliderField label={t('trace.threshold')} value={thrBw} min={0} max={255} onChange={setThrBw} title={t('trace.threshold.tip')} />
                  <button className="btn small" onClick={() => setThrBw(autoThr)} disabled={thrBw === autoThr} title={t('trace.auto.tip', { n: autoThr })} data-testid="trace-auto"><Wand2 size={13} /> {t('trace.auto', { n: autoThr })}</button>
                </div>
              )}
              {mode === 'alpha' && <SliderField label={t('trace.alphaThreshold')} value={thrAlpha} min={1} max={254} onChange={setThrAlpha} title={t('trace.alphaThreshold.tip')} />}
              {mode === 'color' && (
                <>
                  <div className="pipette-row">
                    <span className="swatch" style={{ background: swatch }} />
                    <span className="pipette-hint"><Pipette size={13} /> {color ? t('trace.color.rgb', { r: color.r, g: color.g, b: color.b }) : t('trace.color.clickHint')}</span>
                  </div>
                  <SliderField label={t('trace.tolerance')} value={tolerance} min={0} max={255} onChange={setTolerance} title={t('trace.tolerance.tip')} />
                </>
              )}
              <div className="check-row">
                <label className="check"><input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} data-testid="trace-invert" /> {t('trace.invert')}</label>
                <label className="check" title={t('trace.fillHoles.tip')}><input type="checkbox" checked={fillHoles} onChange={(e) => setFillHoles(e.target.checked)} data-testid="trace-fill" /> {t('trace.fillHoles')}</label>
              </div>
              <SliderField label={t('trace.speckle')} value={speckle} min={0} max={100} unit="px" onChange={setSpeckle} title={t('trace.speckle.tip')} />
              <SliderField label={t('trace.smooth')} value={smooth} min={0} max={5} step={0.5} digits={1} onChange={setSmooth} title={t('trace.smooth.tip')} />
              <SliderField label={t('trace.simplify')} value={simplify} min={0} max={5} step={0.1} digits={1} unit="px" onChange={setSimplify} title={t('trace.simplify.tip')} />

              <div className="grid2 size-row">
                <NumberField label={t('trace.width')} unit="mm" value={Math.round(widthMm * 10) / 10} min={1} max={5000} step={1} digits={1} onCommit={setWidthMm} title={t('trace.width.tip')} />
                <NumberField label={t('trace.height')} unit="mm" value={Math.round(heightMm * 10) / 10} min={1} max={5000} step={1} digits={1} onCommit={(v) => setWidthMm(v / ratio)} title={t('trace.height.tip')} />
              </div>

              <div className="border-box sticker-box">
                <label className="check strong"><input type="checkbox" checked={stickerOn} onChange={(e) => setStickerOn(e.target.checked)} data-testid="trace-sticker" /> <Stamp size={14} /> {t('trace.sticker.add')}</label>
                {stickerOn && (
                  <>
                    <NumberField label={t('sticker.offset.label')} unit="mm" value={sticker.offsetMm} min={0.1} max={50} step={0.5} digits={1} onCommit={(v) => setSticker((s) => ({ ...s, offsetMm: v }))} title={t('trace.sticker.offset.tip')} />
                    <NumberField label={t('sticker.gap.label')} unit="mm" value={sticker.gapMm} min={0} max={20} step={0.5} digits={1} onCommit={(v) => setSticker((s) => ({ ...s, gapMm: v }))} title={t('trace.sticker.gap.tip')} />
                    <NumberField label={t('sticker.smooth.label')} unit="mm" value={sticker.smoothMm} min={0} max={20} step={0.5} digits={1} onCommit={(v) => setSticker((s) => ({ ...s, smoothMm: v }))} title={t('trace.sticker.smooth.tip')} />
                    <label className="check" title={t('trace.sticker.only.tip')}><input type="checkbox" checked={onlyContour} onChange={(e) => setOnlyContour(e.target.checked)} data-testid="trace-only" /> {t('trace.sticker.only')}</label>
                    <p className="hint subtle"><Info size={12} />{onlyContour ? t('trace.sticker.hint.only') : t('trace.sticker.hint.grouped')}</p>
                  </>
                )}
              </div>
              {traceError && <p className="hint danger"><AlertTriangle size={14} />{traceError}</p>}
              {tooBig && <p className="hint warn"><AlertTriangle size={14} />{t('trace.tooBig', { w: wa.width, h: wa.height })}</p>}
            </div>
          </div>
        )}

        <div className="modal-foot">
          {phase === 'ready' && traced && !empty && <span className="trace-stats">{traced.downscale < 1 ? t('trace.statsReduced', { n: traced.paths.length, points: formatNumber(traced.pointCount) }) : t('trace.stats', { n: traced.paths.length, points: formatNumber(traced.pointCount) })}</span>}
          {remaining > 0 && <button className="btn" onClick={cancelAll} title={t('trace.cancelAll.tip')}>{t('trace.cancelAll')}</button>}
          <button className="btn" onClick={cancel} data-testid="trace-cancel" title="Esc">{phase === 'error' && remaining > 0 ? t('trace.next') : t('trace.cancel')}</button>
          {phase !== 'error' && (
            <button className="btn primary big" onClick={apply} disabled={phase !== 'ready' || !parts.length || tracing} data-testid="trace-apply" title={t('trace.apply.tip')}><ScanLine size={16} /> {t('trace.apply')}</button>
          )}
        </div>
      </div>
    </div>
  )
}

