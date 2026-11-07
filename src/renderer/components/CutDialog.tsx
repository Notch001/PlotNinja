import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Scissors, X } from 'lucide-react'
import type { CutJob, PlotEvent } from '@shared/types'
import { buildJob } from '../core'
import { useStore } from '../store'
import { fmt, fmtDuration, pathD, polylineLength } from '../lib/transform'

type Phase = 'summary' | 'running' | 'done' | 'cancelled' | 'error'

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

/** Grobe Dauerschätzung: Geschwindigkeitsstufe 1–10 ≈ 10–100 mm/s plus Leerfahrten/Anlauf. */
export function estimateSeconds(job: CutJob): number {
  const len = job.paths.reduce((s, p) => s + polylineLength(p.points, p.closed), 0) * job.settings.passes
  const v = Math.max(1, job.settings.speed) * 10
  return len / v * 1.35 + job.paths.length * 0.15 + 5
}

export function CutDialog(): JSX.Element | null {
  const open = useStore((s) => s.cutOpen)
  if (!open) return null
  return <CutDialogInner />
}

function CutDialogInner(): JSX.Element {
  const parts = useStore((s) => s.parts)
  const settings = useStore((s) => s.settings)
  const setOpen = useStore((s) => s.setCutOpen)
  const toast = useStore((s) => s.toast)
  const device = useStore((s) => s.devices.find((d) => d.id === s.connectedId))
  const wa = settings.activeWorkArea
  const cut = settings.cut

  const job = useMemo(() => buildJob(parts, wa, cut), []) // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => job.paths.reduce((s, p) => s + polylineLength(p.points, p.closed), 0), [job])
  const estimate = useMemo(() => estimateSeconds(job), [job])
  const ds = useMemo(() => job.paths.map((p) => pathD(p.points, p.closed)), [job])

  const [phase, setPhase] = useState<Phase>('summary')
  const [live, setLive] = useState<Live>({ totalLength: total * cut.passes, cutLength: 0, pathIndex: -1, pathDone: false, x: 0, y: 0, startedAt: 0, at: 0, atPathStart: false })
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [now, setNow] = useState(Date.now())
  const unsub = useRef<(() => void) | null>(null)
  const phaseRef = useRef<Phase>('summary')
  phaseRef.current = phase

  useEffect(() => () => { unsub.current?.() }, [])
  useEffect(() => {
    if (phase !== 'running') return
    const t = setInterval(() => setNow(Date.now()), 120)
    return () => clearInterval(t)
  }, [phase])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && phaseRef.current !== 'running') setOpen(false) }
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
      case 'error': setError(e.message); setPhase('error'); setCancelling(false); unsub.current?.(); unsub.current = null; break
    }
  }

  const start = async (): Promise<void> => {
    setError('')
    setCancelling(false)
    setLive({ totalLength: total * cut.passes, cutLength: 0, pathIndex: -1, pathDone: false, x: 0, y: 0, startedAt: Date.now(), at: 0, atPathStart: false })
    setPhase('running')
    unsub.current?.()
    unsub.current = window.api.onPlotEvent(onEvent)
    try {
      await window.api.startPlot(job)
    } catch (e) {
      unsub.current?.(); unsub.current = null
      setError((e as Error).message || 'Der Schnitt konnte nicht gestartet werden.')
      setPhase('error')
    }
  }
  const cancel = async (): Promise<void> => {
    setCancelling(true)
    try { await window.api.cancelPlot() } catch (e) { toast('error', 'Abbrechen fehlgeschlagen: ' + (e as Error).message) }
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
  // Echte Plotter melden nur Pfadanfang und -ende. Dazwischen läuft der Punkt (geschätzt) entlang des Pfades,
  // bis das nächste Ereignis kommt (der Simulator sendet laufend Positionen; dort wirkt das praktisch nicht).
  const curPath = live.pathIndex >= 0 ? job.paths[live.pathIndex] : undefined
  const silentFor = live.at ? now - live.at : 0
  const pos = running && curPath && !live.pathDone && live.atPathStart && silentFor > 0
    ? pointAlong(curPath.points, curPath.closed, (silentFor / 1000) * Math.max(1, cut.speed) * 10)
    : { x: live.x, y: live.y }

  return (
    <div className="modal-backdrop" onMouseDown={() => !running && setOpen(false)}>
      <div className="modal cut" role="dialog" aria-modal="true" aria-label="Schneiden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2><Scissors size={17} /> {phase === 'summary' ? 'Schnitt vorbereiten' : phase === 'running' ? 'Schneide …' : phase === 'done' ? 'Fertig' : phase === 'cancelled' ? 'Abgebrochen' : 'Fehler'}</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} disabled={running} title={running ? 'Während des Schneidens nicht möglich – bitte zuerst abbrechen' : 'Schließen'}><X size={16} /></button>
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
            {phase === 'done' && <div className="live-badge ok"><CheckCircle2 size={28} strokeWidth={2.4} /></div>}
          </div>

          <div className="cut-side">
            {phase === 'summary' && (
              <>
                <dl className="summary">
                  <div><dt>Bauteile</dt><dd>{parts.length}</dd></div>
                  <div><dt>Schnittlänge</dt><dd>{fmt(total / 10, 1)} cm{cut.passes > 1 ? ` × ${cut.passes}` : ''}</dd></div>
                  <div><dt>Arbeitsfläche</dt><dd>{wa.width} × {wa.height} mm</dd></div>
                  <div><dt>Gerät</dt><dd>{device?.name ?? '–'}</dd></div>
                  <div><dt>Geschätzte Dauer</dt><dd>ca. {fmtDuration(estimate)}</dd></div>
                </dl>
                <div className="summary-cut">
                  <span>Klinge <b>{cut.blade}</b></span><span>Druck <b>{cut.force}</b></span><span>Tempo <b>{cut.speed}</b></span>
                  <span>Durchgänge <b>{cut.passes}</b></span><span>Überschnitt <b>{fmt(cut.overcut)} mm</b></span>
                </div>
                <p className="hint"><AlertTriangle size={14} />Material auflegen, Matte einlegen und Klinge prüfen. Das Schneiden kann jederzeit abgebrochen werden.</p>
              </>
            )}
            {(phase === 'running' || phase === 'done' || phase === 'cancelled') && (
              <>
                <div className="big-pct">{Math.round(phase === 'done' ? 100 : pct)}<small>%</small></div>
                <div className="progress"><div className={'progress-bar' + (phase === 'done' ? ' ok' : '')} style={{ width: (phase === 'done' ? 100 : pct) + '%' }} /></div>
                <dl className="summary">
                  <div><dt>Geschnitten</dt><dd>{fmt((phase === 'done' ? live.totalLength : live.cutLength) / 10, 1)} von {fmt(live.totalLength / 10, 1)} cm</dd></div>
                  <div><dt>Pfade</dt><dd>{Math.min(doneCount, ds.length)} von {ds.length}</dd></div>
                  {running && <div><dt>Restzeit</dt><dd>ca. {fmtDuration(remaining)}</dd></div>}
                  {phase === 'done' && <div><dt>Dauer</dt><dd>{fmtDuration(elapsed || 0)}</dd></div>}
                </dl>
                {running && <p className="hint"><Loader2 size={14} className="spin" />{cancelling ? 'Wird abgebrochen …' : 'Bitte den Plotter nicht ausschalten und die Matte nicht berühren.'}</p>}
                {phase === 'done' && <p className="hint ok"><CheckCircle2 size={14} />Schnitt abgeschlossen. Du kannst das Material jetzt entnehmen.</p>}
                {phase === 'cancelled' && <p className="hint warn"><AlertTriangle size={14} />Der Schnitt wurde abgebrochen.</p>}
              </>
            )}
            {phase === 'error' && (
              <p className="hint danger big"><AlertTriangle size={16} /><span><b>Der Schnitt ist fehlgeschlagen.</b><br />{error}</span></p>
            )}
          </div>
        </div>
        <div className="modal-foot">
          {phase === 'summary' && (<>
            <button className="btn" onClick={() => setOpen(false)}>Abbrechen</button>
            <button className="btn primary big" onClick={() => void start()}><Scissors size={16} /> Jetzt schneiden</button>
          </>)}
          {running && <button className="btn danger" onClick={() => void cancel()} disabled={cancelling}>{cancelling ? 'Breche ab …' : 'Abbrechen'}</button>}
          {(phase === 'done') && <button className="btn primary" onClick={() => setOpen(false)}>Schließen</button>}
          {(phase === 'cancelled' || phase === 'error') && (<>
            <button className="btn" onClick={() => setOpen(false)}>Schließen</button>
            <button className="btn primary" onClick={() => setPhase('summary')}>Zurück zur Übersicht</button>
          </>)}
        </div>
      </div>
    </div>
  )
}
