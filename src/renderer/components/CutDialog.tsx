import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FlipHorizontal2, Loader2, PauseCircle, Scissors, X } from 'lucide-react'
import type { PlotEvent } from '@shared/types'
import { DEFAULT_AFTER_CUT } from '@shared/types'
import { buildJob, buildTestCutJob, cutSpeedMmPerS, estimateDurationSeconds } from '../core'
import { selectedParts, useStore } from '../store'
import { EjectDistance } from './RightPanels'
import { fmt, fmtDuration, pathD, polylineLength } from '../lib/transform'

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
    const t = setInterval(() => setNow(Date.now()), 120)
    return () => clearInterval(t)
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
      setError((e as Error).message || 'Der Schnitt konnte nicht gestartet werden.')
      setPhase('error')
    }
  }
  const cancel = async (): Promise<void> => {
    setCancelling(true)
    try { await window.api.cancelPlot() } catch (e) { toast('error', 'Abbrechen fehlgeschlagen: ' + (e as Error).message) }
  }

  const resume = async (): Promise<void> => {
    try { await window.api.resumePlot() } catch (e) { toast('error', 'Fortsetzen fehlgeschlagen: ' + (e as Error).message) }
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
      <div className="modal cut" role="dialog" aria-modal="true" aria-label="Schneiden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2><Scissors size={17} /> {phase === 'summary' ? (testMode ? 'Testschnitt vorbereiten' : 'Schnitt vorbereiten') : phase === 'running' ? (testMode ? 'Testschnitt läuft …' : 'Schneide …') : phase === 'paused' ? 'Pausiert – Medium prüfen' : phase === 'done' ? 'Fertig' : phase === 'cancelled' ? 'Abgebrochen' : 'Fehler'}</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} disabled={active} title={active ? 'Während des Schneidens nicht möglich – bitte zuerst abbrechen' : 'Schließen'}><X size={16} /></button>
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
            {mirror && !testMode && <div className="live-flag"><FlipHorizontal2 size={13} /> gespiegelt</div>}
            {phase === 'done' && <div className="live-badge ok"><CheckCircle2 size={28} strokeWidth={2.4} /></div>}
          </div>

          <div className="cut-side">
            {phase === 'summary' && (
              <>
                <dl className="summary">
                  {testMode
                    ? <div><dt>Inhalt</dt><dd>Testschnitt</dd></div>
                    : <div><dt>Bauteile</dt><dd>{cutParts.length}{scope === 'selection' ? ` von ${parts.length}` : ''}</dd></div>}
                  <div><dt>Schnittlänge</dt><dd>{fmt(total / 10, 1)} cm{cut.passes > 1 ? ` × ${cut.passes}` : ''}</dd></div>
                  <div><dt>Arbeitsfläche</dt><dd>{wa.width} × {wa.height} mm</dd></div>
                  <div><dt>Gerät</dt><dd>{device?.name ?? '–'}</dd></div>
                  <div><dt>Geschätzte Dauer</dt><dd>ca. {fmtDuration(estimate)}</dd></div>
                </dl>
                <div className="summary-cut">
                  {device?.autoBlade === true
                    ? <span title="Der Cameo stellt die Klinge selbst ein">Klingentiefe <b>{cut.blade}</b> (auto)</span>
                    : <span title="Bitte am Messer von Hand einstellen">Klinge manuell <b>{cut.blade}</b></span>}<span>Druck <b>{cut.force}</b></span><span>Tempo <b>{cut.speed}</b></span>
                  <span>Durchgänge <b>{cut.passes}</b></span><span>Überschnitt <b>{fmt(cut.overcut)} mm</b></span>
                </div>
                {!testMode && (
                  <div className="cut-options" data-testid="cut-options">
                    <div className="seg" role="group" aria-label="Was schneiden">
                      <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')} title="Alle Bauteile der Arbeitsfläche schneiden">Alle Teile ({parts.length})</button>
                      <button
                        className={scope === 'selection' ? 'on' : ''} disabled={!selParts.length} onClick={() => setScope('selection')}
                        title={selParts.length ? 'Nur die gewählten Bauteile schneiden – alles andere bleibt unberührt' : 'Zum Schneiden einer Auswahl zuerst Bauteile auf der Arbeitsfläche wählen'}
                      >Nur Auswahl ({selParts.length})</button>
                    </div>
                    <label className="check" title="Nächstgelegene Konturen zuerst, innere vor äußeren. Aus: Reihenfolge der Bauteile in der Liste.">
                      <input type="checkbox" checked={optimize} onChange={(e) => setOptimize(e.target.checked)} /> Schnittreihenfolge optimieren
                    </label>
                    <label className="check" title="Spiegelt den gesamten Auftrag an der Mitte der Matte – für Folie, die mit der Rückseite nach oben liegt. Das Dokument bleibt unverändert.">
                      <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Gesamten Auftrag spiegeln (Rückseiten-Schnitt)
                    </label>
                    <label className="check" title="Fährt das Material nach dem Schneiden hinten aus dem Plotter, damit es dort abgeschnitten werden kann. Nur bei Rollenmaterial, nicht mit Matte.">
                      <input type="checkbox" data-testid="eject-check" checked={afterCut.eject} onChange={(e) => setAfterCut({ eject: e.target.checked })} /> Material nach dem Schneiden ausfahren
                    </label>
                    <label className="check" style={{ opacity: 0.55 }} title="Ein Befehl zum automatischen Abschneiden ist nicht bekannt: Das Quermesser (Cameo 4: Schieber hinten, Cameo 2/3: Zubehör) wird nach dem Ausfahren von Hand durchgezogen.">
                      <input type="checkbox" disabled checked={false} readOnly /> Anschließend abschneiden (Quermesser) – nur von Hand
                    </label>
                    <EjectDistance disabled={!afterCut.eject} />
                    {mirror && <p className="hint subtle"><FlipHorizontal2 size={12} />Der Auftrag wird links/rechts an der Mattenmitte gespiegelt (siehe Vorschau). Nur der Schnitt ist gespiegelt, nicht dein Dokument.</p>}
                  </div>
                )}
                {testMode
                  ? <p className="hint"><AlertTriangle size={14} />Geschnitten wird ein kleines Muster (Quadrat 20 × 20 mm mit Dreieck und ein Kreis, ca. 25 mm) in der oberen linken Ecke der Matte, ab x = 10 mm, y = 10 mm. Lege dafür Abfallmaterial auf diese Stelle und prüfe danach, ob Druck und Klinge passen. Dein Projekt wird nicht geschnitten.</p>
                  : <p className="hint"><AlertTriangle size={14} />Material auflegen, Matte einlegen und Klinge prüfen. Das Schneiden kann jederzeit abgebrochen werden. Tipp: Mit „Testschnitt“ in den Schnitteinstellungen lassen sich Druck und Klinge vorher an Abfallmaterial prüfen.</p>}
                {notReady && (
                  <p className="hint danger"><AlertTriangle size={14} />{deviceStatus === 'no-media'
                    ? 'Im Plotter ist kein Medium eingelegt. Matte einlegen und am Plotter die Lade-Taste drücken.'
                    : deviceStatus === 'disconnected' ? 'Der Plotter ist nicht verbunden.' : 'Der Plotter meldet einen Fehler oder antwortet nicht.'}</p>
                )}
              </>
            )}
            {paused && (
              <p className="hint warn big" data-testid="pause-hint"><PauseCircle size={16} /><span><b>Pausiert – Medium prüfen</b><br />{pauseMsg}<br />Danach hier auf „Weiter“ klicken. Es wurde noch nichts geschnitten.</span></p>
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
                {running && <p className="hint"><Loader2 size={14} className="spin" />{cancelling ? 'Wird abgebrochen …' : ejecting ? 'Material wird ausgefahren …' : 'Bitte den Plotter nicht ausschalten und die Matte nicht berühren.'}</p>}
                {phase === 'done' && <p className="hint ok"><CheckCircle2 size={14} />{ejecting ? 'Schnitt abgeschlossen, Material ausgefahren. Ein vorhandenes Quermesser jetzt von Hand durchziehen.' : 'Schnitt abgeschlossen. Du kannst das Material jetzt entnehmen.'}</p>}
                {phase === 'cancelled' && <p className="hint warn"><AlertTriangle size={14} />Der Schnitt wurde abgebrochen.</p>}
              </>
            )}
            {phase === 'error' && (
              <p className="hint danger big"><AlertTriangle size={16} /><span><b>{lost ? 'Verbindung zum Plotter verloren.' : testMode ? 'Der Testschnitt ist fehlgeschlagen.' : 'Der Schnitt ist fehlgeschlagen.'}</b><br />{error}{lost && <><br />Die App bleibt benutzbar; nach dem Wiederverbinden kannst du erneut starten.</>}</span></p>
            )}
          </div>
        </div>
        <div className="modal-foot">
          {phase === 'summary' && (<>
            <button className="btn" onClick={() => setOpen(false)}>Abbrechen</button>
            <button className="btn primary big" onClick={() => void start()} disabled={notReady || !job.paths.length} title={notReady ? 'Der Plotter ist nicht bereit' : !job.paths.length ? 'Es gibt nichts zu schneiden' : undefined}><Scissors size={16} /> {testMode ? 'Testschnitt starten' : 'Jetzt schneiden'}</button>
          </>)}
          {paused && <button className="btn primary" onClick={() => void resume()}>Weiter</button>}
          {active && <button className="btn danger" onClick={() => void cancel()} disabled={cancelling}>{cancelling ? 'Breche ab …' : 'Abbrechen'}</button>}
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
