import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FlipHorizontal2, Loader2, PauseCircle, Scissors, X } from 'lucide-react'
import type { PlotEvent } from '@shared/types'
import { DEFAULT_AFTER_CUT } from '@shared/types'
import { buildJob, buildTestCutJob, cutSpeedMmPerS, estimateDurationSeconds } from '../core'
import { selectedParts, useStore } from '../store'
import { EjectDistance } from './RightPanels'
import { pathD, polylineLength } from '../lib/transform'
import { formatNumber } from '@shared/i18n'
import { useT, type TFunction } from '../lib/useT'

type Phase = 'summary' | 'running' | 'paused' | 'done' | 'cancelled' | 'error'

interface Live {
  totalLength: number
  cutLength: number
  pathIndex: number
  pathDone: boolean
  x: number
  y: number
  startedAt: number
  /** Zeitpunkt des letzten Fortschrittsereignisses */
  at: number
  /** Ereignis meldet den Beginn eines Pfades (Position = Pfadanfang): ab dort wird zum Ende hin geschätzt */
  atPathStart: boolean
}

/** Zahl in der aktuellen Sprache mit höchstens `digits` Nachkommastellen. */
function fmt(n: number, digits = 1): string {
  return formatNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

/** Dauer sprachabhängig: "45 s", "3 min 20 s", "1 h 05 min". */
function fmtDuration(t: TFunction, sec: number): string {
  sec = Math.max(0, Math.round(sec))
  const two = (n: number): string => n.toString().padStart(2, '0')
  if (sec < 60) return t('cut.duration.s', { s: sec })
  const m = Math.floor(sec / 60), s = sec % 60
  if (m < 60) return t('cut.duration.minS', { m, s: two(s) })
  return t('cut.duration.hMin', { h: Math.floor(m / 60), m: two(m % 60) })
}

/** Position nach `dist` mm entlang des Pfades (am Ende festgehalten). */
function pointAlong(pts: { x: number; y: number }[], closed: boolean, dist: number): { x: number; y: number } {
  const p = closed && pts.length > 1 ? [...pts, pts[0]] : pts
  let rest = dist
  for (let i = 1; i < p.length; i++) {
    const l = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)
    if (rest <= l) {
      const t = l === 0 ? 1 : rest / l
      return { x: p[i - 1].x + (p[i].x - p[i - 1].x) * t, y: p[i - 1].y + (p[i].y - p[i - 1].y) * t }
    }
    rest -= l
  }
  return p[p.length - 1]
}

export function CutDialog(): JSX.Element | null {
  const open = useStore((s) => s.cutOpen)
  if (!open) return null
  return <CutDialogInner />
}

function CutDialogInner(): JSX.Element {
  const t = useT()
  const parts = useStore((s) => s.parts)
  const settings = useStore((s) => s.settings)
  const setOpen = useStore((s) => s.setCutOpen)
  const toast = useStore((s) => s.toast)
  const device = useStore((s) => s.devices.find((d) => d.id === s.connectedId))
  const deviceStatus = useStore((s) => s.deviceStatus)
  const testMode = useStore((s) => s.cutMode) === 'test'
  const wa = settings.activeWorkArea
  const cut = settings.cut
  const afterCut = settings.afterCut ?? DEFAULT_AFTER_CUT
  const setAfterCut = useStore((s) => s.setAfterCut)
  const [ejecting, setEjecting] = useState(false)

  const selection = useStore((s) => s.selection)
  const selParts = useMemo(() => selectedParts(parts, selection), []) // eslint-disable-line react-hooks/exhaustive-deps
  // Optionen für den Auftrag (nur im Übersichtsschritt änderbar)
  const [scope, setScope] = useState<'all' | 'selection'>('all')
  const [optimize, setOptimize] = useState(true)
  const [mirror, setMirror] = useState(false)
  const cutParts = scope === 'selection' ? selParts : parts
  const job = useMemo(
    () => (testMode ? buildTestCutJob(wa, cut) : buildJob(cutParts, wa, cut, { optimize, mirror })),
    [scope, optimize, mirror] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const total = useMemo(() => job.paths.reduce((s, p) => s + polylineLength(p.points, p.closed), 0), [job])
  const estimate = useMemo(() => estimateDurationSeconds(job), [job])
  const ds = useMemo(() => job.paths.map((p) => pathD(p.points, p.closed)), [job])

  const [phase, setPhase] = useState<Phase>('summary')
  const [live, setLive] = useState<Live>({ totalLength: total * cut.passes, cutLength: 0, pathIndex: -1, pathDone: false, x: 0, y: 0, startedAt: 0, at: 0, atPathStart: false })
  const [error, setError] = useState('')
  const [lost, setLost] = useState(false)
  const [pauseMsg, setPauseMsg] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [now, setNow] = useState(Date.now())
  const unsub = useRef<(() => void) | null>(null)
  const phaseRef = useRef<Phase>('summary')
  phaseRef.current = phase

  useEffect(() => () => { unsub.current?.() }, [])
  useEffect(() => {
    if (phase !== 'running') return
    const timer = setInterval(() => setNow(Date.now()), 120)
    return () => clearInterval(timer)
  }, [phase])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && phaseRef.current !== 'running' && phaseRef.current !== 'paused') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  const onEvent = (e: PlotEvent): void => {
    switch (e.type) {
      case 'started':
        setLive((l) => ({ ...l, totalLength: e.totalLength || l.totalLength, startedAt: Date.now() }))
        break
      case 'progress': {
        const p0 = job.paths[e.pathIndex]?.points[0]
        const atStart = !e.done && !!p0 && Math.hypot(e.x - p0.x, e.y - p0.y) < 0.05
        setLive((l) => ({ ...l, cutLength: e.cutLength, pathIndex: e.pathIndex, pathDone: e.done, x: e.x, y: e.y, at: Date.now(), atPathStart: atStart }))
        break
      }
      case 'finished': setPhase('done'); unsub.current?.(); unsub.current = null; break
      case 'cancelled': setPhase('cancelled'); setCancelling(false); unsub.current?.(); unsub.current = null; break
      case 'paused': setPauseMsg(e.message); setPhase('paused'); break
      case 'resumed': setPhase('running'); break
      case 'ejecting': setEjecting(true); break
      case 'error': setError(e.message); setLost(!!e.deviceLost); setPhase('error'); setCancelling(false); unsub.current?.(); unsub.current = null; break
    }
  }

  const start = async (): Promise<void> => {
    setError('')
    setLost(false)
    setCancelling(false)
    setLive({ totalLength: total * cut.passes, cutLength: 0, pathIndex: -1, pathDone: false, x: 0, y: 0, startedAt: Date.now(), at: 0, atPathStart: false })
    setEjecting(false)
    setPhase('running')
    unsub.current?.()
    unsub.current = window.api.onPlotEvent(onEvent)
    try {
      await window.api.startPlot(!testMode && afterCut.eject ? { ...job, ejectExtraMm: afterCut.ejectExtraMm } : job)
    } catch (e) {
      unsub.current?.(); unsub.current = null
      setError((e as Error).message || t('cut.error.startFailed'))
      setPhase('error')
    }
  }
  const cancel = async (): Promise<void> => {
    setCancelling(true)
    try { await window.api.cancelPlot() } catch (e) { toast('error', t('cut.error.cancelFailed', { message: (e as Error).message })) }
  }

  const resume = async (): Promise<void> => {
    try { await window.api.resumePlot() } catch (e) { toast('error', t('cut.error.resumeFailed', { message: (e as Error).message })) }
  }

  const pct = live.totalLength > 0 ? Math.min(100, (live.cutLength / live.totalLength) * 100) : 0
  const elapsed = live.startedAt ? (now - live.startedAt) / 1000 : 0
  const remaining = pct > 2 ? (elapsed / pct) * (100 - pct) : estimate
  const doneCount = phase === 'done' ? ds.length : Math.max(0, live.pathIndex + (live.pathDone ? 1 : 0))
  const dDone = useMemo(() => ds.slice(0, doneCount).join(''), [ds, doneCount])
  const dRest = useMemo(() => ds.slice(doneCount).join(''), [ds, doneCount])
  const dCur = !live.pathDone && live.pathIndex >= 0 && phase === 'running' ? ds[live.pathIndex] : ''
  const m = 8
  const running = phase === 'running'
  const paused = phase === 'paused'
  const active = running || paused
  const notReady = deviceStatus === 'no-media' || deviceStatus === 'error' || deviceStatus === 'disconnected'
  // Echte Plotter melden nur Pfadanfang und -ende. Dazwischen läuft der Punkt (geschätzt) entlang des Pfades,
  // bis das nächste Ereignis kommt (der Simulator sendet laufend Positionen; dort wirkt das praktisch nicht).
  const curPath = live.pathIndex >= 0 ? job.paths[live.pathIndex] : undefined
  const silentFor = live.at ? now - live.at : 0
  const pos = running && curPath && !live.pathDone && live.atPathStart && silentFor > 0
    ? pointAlong(curPath.points, curPath.closed, (silentFor / 1000) * cutSpeedMmPerS(cut.speed))
    : { x: live.x, y: live.y }

  return (
    <div className="modal-backdrop" onMouseDown={() => !active && setOpen(false)}>
      <div className="modal cut" role="dialog" aria-modal="true" aria-label={t('cut.dialog.aria')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2><Scissors size={17} /> {phase === 'summary' ? (testMode ? t('cut.title.summaryTest') : t('cut.title.summary')) : phase === 'running' ? (testMode ? t('cut.title.runningTest') : t('cut.title.running')) : phase === 'paused' ? t('cut.title.paused') : phase === 'done' ? t('cut.title.done') : phase === 'cancelled' ? t('cut.title.cancelled') : t('cut.title.error')}</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} disabled={active} title={active ? t('cut.close.disabled') : t('cut.close')}><X size={16} /></button>
        </div>
        <div className="modal-body cut-body">
          <div className="live">
            <svg viewBox={`${-m} ${-m} ${wa.width + m * 2} ${wa.height + m * 2}`} preserveAspectRatio="xMidYMid meet" data-testid="live-view">
              <rect x={-m} y={-m} width={wa.width + m * 2} height={wa.height + m * 2} className="mat-board" />
              <rect x={0} y={0} width={wa.width} height={wa.height} className="mat-area" />
              <path d={dRest} className="live-pending" />
              <path d={dDone} className="live-done" />
              {dCur && <path d={dCur} className="live-current" />}
              {running && live.pathIndex >= 0 && (
                <g transform={`translate(${pos.x} ${pos.y})`}>
                  <circle r={Math.max(wa.width, wa.height) * 0.012} className="live-pulse" />
                  <circle r={Math.max(wa.width, wa.height) * 0.006} className="live-dot" />
                  <path d={`M${-wa.width * 0.03} 0H${wa.width * 0.03}M0 ${-wa.width * 0.03}V${wa.width * 0.03}`} className="live-cross" />
                </g>
              )}
              <rect x={0} y={0} width={wa.width} height={wa.height} className="mat-frame" />
            </svg>
            {mirror && !testMode && <div className="live-flag"><FlipHorizontal2 size={13} /> {t('cut.mirrored')}</div>}
            {phase === 'done' && <div className="live-badge ok"><CheckCircle2 size={28} strokeWidth={2.4} /></div>}
          </div>

          <div className="cut-side">
            {phase === 'summary' && (
              <>
                <dl className="summary">
                  {testMode
                    ? <div><dt>{t('cut.sum.content')}</dt><dd>{t('cut.sum.contentTest')}</dd></div>
                    : <div><dt>{t('cut.sum.parts')}</dt><dd>{scope === 'selection' ? t('cut.sum.partsOf', { n: cutParts.length, total: parts.length }) : cutParts.length}</dd></div>}
                  <div><dt>{t('cut.sum.length')}</dt><dd>{cut.passes > 1 ? t('cut.sum.lengthPasses', { cm: fmt(total / 10, 1), passes: cut.passes }) : t('cut.sum.lengthValue', { cm: fmt(total / 10, 1) })}</dd></div>
                  <div><dt>{t('cut.sum.workArea')}</dt><dd>{t('cut.sum.workAreaValue', { w: wa.width, h: wa.height })}</dd></div>
                  <div><dt>{t('cut.sum.device')}</dt><dd>{device?.name ?? '–'}</dd></div>
                  <div><dt>{t('cut.sum.estimate')}</dt><dd>{t('cut.approx', { value: fmtDuration(t, estimate) })}</dd></div>
                </dl>
                <div className="summary-cut">
                  {device?.autoBlade === true
                    ? <span title={t('cut.blade.auto.tooltip')}>{t('cut.blade.auto')} <b>{cut.blade}</b> {t('cut.blade.autoSuffix')}</span>
                    : <span title={t('cut.blade.manual.tooltip')}>{t('cut.blade.manual')} <b>{cut.blade}</b></span>}<span>{t('cut.setting.force')} <b>{cut.force}</b></span><span>{t('cut.setting.speed')} <b>{cut.speed}</b></span>
                  <span>{t('cut.setting.passes')} <b>{cut.passes}</b></span><span>{t('cut.setting.overcut')} <b>{fmt(cut.overcut)} mm</b></span>
                </div>
                {!testMode && (
                  <div className="cut-options" data-testid="cut-options">
                    <div className="seg" role="group" aria-label={t('cut.scope.aria')}>
                      <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')} title={t('cut.scope.all.tooltip')}>{t('cut.scope.all', { n: parts.length })}</button>
                      <button
                        className={scope === 'selection' ? 'on' : ''} disabled={!selParts.length} onClick={() => setScope('selection')}
                        title={selParts.length ? t('cut.scope.selection.tooltip') : t('cut.scope.selection.empty')}
                      >{t('cut.scope.selection', { n: selParts.length })}</button>
                    </div>
                    <label className="check" title={t('cut.optimize.tooltip')}>
                      <input type="checkbox" checked={optimize} onChange={(e) => setOptimize(e.target.checked)} /> {t('cut.optimize')}
                    </label>
                    <label className="check" title={t('cut.mirror.tooltip')}>
                      <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> {t('cut.mirror')}
                    </label>
                    <label className="check" title={t('cut.eject.tooltip')}>
                      <input type="checkbox" data-testid="eject-check" checked={afterCut.eject} onChange={(e) => setAfterCut({ eject: e.target.checked })} /> {t('cut.eject')}
                    </label>
                    <label className="check" style={{ opacity: 0.55 }} title={t('cut.crossCut.tooltip')}>
                      <input type="checkbox" disabled checked={false} readOnly /> {t('cut.crossCut')}
                    </label>
                    <EjectDistance disabled={!afterCut.eject} />
                    {mirror && <p className="hint subtle"><FlipHorizontal2 size={12} />{t('cut.mirror.hint')}</p>}
                  </div>
                )}
                {testMode
                  ? <p className="hint"><AlertTriangle size={14} />{t('cut.hint.test')}</p>
                  : <p className="hint"><AlertTriangle size={14} />{t('cut.hint.prepare')}</p>}
                {notReady && (
                  <p className="hint danger"><AlertTriangle size={14} />{deviceStatus === 'no-media'
                    ? t('cut.hint.noMedia')
                    : deviceStatus === 'disconnected' ? t('cut.hint.disconnected') : t('cut.hint.deviceError')}</p>
                )}
              </>
            )}
            {paused && (
              <p className="hint warn big" data-testid="pause-hint"><PauseCircle size={16} /><span><b>{t('cut.title.paused')}</b><br />{pauseMsg}<br />{t('cut.paused.next')}</span></p>
            )}
            {(phase === 'running' || phase === 'done' || phase === 'cancelled') && (
              <>
                <div className="big-pct">{Math.round(phase === 'done' ? 100 : pct)}<small>%</small></div>
                <div className="progress"><div className={'progress-bar' + (phase === 'done' ? ' ok' : '')} style={{ width: (phase === 'done' ? 100 : pct) + '%' }} /></div>
                <dl className="summary">
                  <div><dt>{t('cut.progress.cut')}</dt><dd>{t('cut.progress.cutValue', { done: fmt((phase === 'done' ? live.totalLength : live.cutLength) / 10, 1), total: fmt(live.totalLength / 10, 1) })}</dd></div>
                  <div><dt>{t('cut.progress.paths')}</dt><dd>{t('cut.progress.pathsValue', { done: Math.min(doneCount, ds.length), total: ds.length })}</dd></div>
                  {running && <div><dt>{t('cut.progress.remaining')}</dt><dd>{t('cut.approx', { value: fmtDuration(t, remaining) })}</dd></div>}
                  {phase === 'done' && <div><dt>{t('cut.progress.duration')}</dt><dd>{fmtDuration(t, elapsed || 0)}</dd></div>}
                </dl>
                {running && <p className="hint"><Loader2 size={14} className="spin" />{cancelling ? t('cut.running.cancelling') : ejecting ? t('cut.running.ejecting') : t('cut.running.warn')}</p>}
                {phase === 'done' && <p className="hint ok"><CheckCircle2 size={14} />{ejecting ? t('cut.done.ejected') : t('cut.done.plain')}</p>}
                {phase === 'cancelled' && <p className="hint warn"><AlertTriangle size={14} />{t('cut.cancelled')}</p>}
              </>
            )}
            {phase === 'error' && (
              <p className="hint danger big"><AlertTriangle size={16} /><span><b>{lost ? t('cut.error.lost') : testMode ? t('cut.error.failedTest') : t('cut.error.failed')}</b><br />{error}{lost && <><br />{t('cut.error.lostHint')}</>}</span></p>
            )}
          </div>
        </div>
        <div className="modal-foot">
          {phase === 'summary' && (<>
            <button className="btn" onClick={() => setOpen(false)}>{t('cut.btn.cancel')}</button>
            <button className="btn primary big" onClick={() => void start()} disabled={notReady || !job.paths.length} title={notReady ? t('cut.btn.notReady') : !job.paths.length ? t('cut.btn.nothing') : undefined}><Scissors size={16} /> {testMode ? t('cut.btn.startTest') : t('cut.btn.start')}</button>
          </>)}
          {paused && <button className="btn primary" onClick={() => void resume()}>{t('cut.btn.resume')}</button>}
          {active && <button className="btn danger" onClick={() => void cancel()} disabled={cancelling}>{cancelling ? t('cut.btn.cancelling') : t('cut.btn.cancel')}</button>}
          {(phase === 'done') && <button className="btn primary" onClick={() => setOpen(false)}>{t('cut.close')}</button>}
          {(phase === 'cancelled' || phase === 'error') && (<>
            <button className="btn" onClick={() => setOpen(false)}>{t('cut.close')}</button>
            <button className="btn primary" onClick={() => setPhase('summary')}>{t('cut.btn.back')}</button>
          </>)}
        </div>
      </div>
    </div>
  )
}
