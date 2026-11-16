import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, PauseCircle, Plus, RotateCcw, Save, Scissors, Undo2, Wand2, X } from 'lucide-react'
import type { CutJob, CutSettings, PlotEvent } from '@shared/types'
import { MAX_EJECT_MM } from '@shared/types'
import type { MessageKey } from '@shared/i18n'
import { formatNumber } from '@shared/i18n'
import {
  BUILTIN_MATERIALS, GRID_MAX_COUNT, GRID_MIN_COUNT, VERDICTS, buildGridJobs, buildWizardJob, gridDefaults, gridVariants, materialLabel,
  slotCount, slotPosition, suggestAdjustment
} from '../core'
import type { GridParam, Verdict } from '../core'
import { useStore, wizardTestCount, type WizardAttempt, type WizardStage } from '../store'
import { useT } from '../lib/useT'
import { pathD } from '../lib/transform'
import { NumberField } from './NumberField'
import { SliderField, useTestCutBlocker } from './RightPanels'

const fmt = (n: number, digits = 1): string => formatNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: digits })
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

type Phase = 'idle' | 'running' | 'paused' | 'cancelled' | 'error'

interface Live { totalLength: number; cutLength: number; pathIndex: number; pathDone: boolean; x: number; y: number }
const freshLive = (): Live => ({ totalLength: 0, cutLength: 0, pathIndex: -1, pathDone: false, x: 0, y: 0 })

/** Laufender Auftragsblock: bei einem Raster mehrere Aufträge nacheinander. */
interface Run {
  jobs: CutJob[]
  index: number
  /** Anzahl der für diesen Lauf neu angelegten Versuche (die letzten der Liste). */
  added: number
  before: { attempts: WizardAttempt[]; nextSlot: number; stage: WizardStage }
  /** Wartet zwischen zwei Aufträgen auf den Plotter. */
  between: boolean
  stopped: boolean
}

const PARAM_KEY: Record<GridParam, MessageKey> = { force: 'cut.setting.force', speed: 'cut.setting.speed', blade: 'rightPanel.cut.blade' }
const VERDICT_KEY: Record<Verdict, MessageKey> = {
  good: 'wizard.verdict.good', notThrough: 'wizard.verdict.notThrough', tooDeep: 'wizard.verdict.tooDeep',
  cornersTorn: 'wizard.verdict.cornersTorn', liftsOff: 'wizard.verdict.liftsOff'
}
const VERDICT_TIP: Record<Exclude<Verdict, 'good'>, MessageKey> = {
  notThrough: 'wizard.verdict.tip.notThrough', tooDeep: 'wizard.verdict.tip.tooDeep',
  cornersTorn: 'wizard.verdict.tip.cornersTorn', liftsOff: 'wizard.verdict.tip.liftsOff'
}
const TITLE_KEY: Record<WizardStage, MessageKey> = {
  setup: 'wizard.title.setup', rate: 'wizard.title.rate', adjust: 'wizard.title.adjust', save: 'wizard.title.save'
}

export function MaterialWizard(): JSX.Element | null {
  const open = useStore((s) => s.wizardOpen)
  if (!open) return null
  return <WizardInner />
}

/** Mattenansicht mit den bisherigen Versuchen (und optional dem nächsten Platz); `children` liegt oben drauf (Live-Schnitt). */
function MatView({ wa, items, next, children }: {
  wa: { width: number; height: number }
  items: { d: string; cls: string }[]
  next: { x: number; y: number; w: number; h: number } | null
  children?: React.ReactNode
}): JSX.Element {
  const t = useT()
  const m = 8
  return (
    <svg viewBox={`${-m} ${-m} ${wa.width + m * 2} ${wa.height + m * 2}`} preserveAspectRatio="xMidYMid meet" data-testid="wizard-mat" role="img" aria-label={t('wizard.mat.aria')}>
      <rect x={-m} y={-m} width={wa.width + m * 2} height={wa.height + m * 2} className="mat-board" />
      <rect x={0} y={0} width={wa.width} height={wa.height} className="mat-area" />
      {next && <rect x={next.x - 2} y={next.y - 2} width={next.w + 4} height={next.h + 4} rx={2} className="wiz-next" />}
      {items.map((it, i) => <path key={i} d={it.d} className={it.cls} />)}
      {children}
      <rect x={0} y={0} width={wa.width} height={wa.height} className="mat-frame" />
    </svg>
  )
}

/** Die fünf Schnittwerte als Regler (wie im Panel „Schnitteinstellungen“). */
function CutSliders({ cut, onChange, autoBlade, prev }: { cut: CutSettings; onChange: (c: CutSettings) => void; autoBlade: boolean | undefined; prev?: CutSettings }): JSX.Element {
  const t = useT()
  const set = (patch: Partial<CutSettings>): void => onChange({ ...cut, ...patch })
  // Mit `prev` (Werte des letzten Tests) werden geänderte Regler orange markiert und zeigen "alt → neu".
  const wrap = (key: keyof CutSettings, unit: string, field: JSX.Element): JSX.Element => {
    const changed = !!prev && Math.abs(prev[key] - cut[key]) > 1e-9
    return (
      <div className={'wiz-slider' + (changed ? ' changed' : '')} data-testid={'wizard-slider-' + key} data-changed={changed ? 'true' : 'false'}>
        {field}
        {changed && prev && <span className="wiz-delta" data-testid={'wizard-delta-' + key}>{prev[key]}{unit} → <b>{cut[key]}{unit}</b></span>}
      </div>
    )
  }
  return (
    <div className="wiz-sliders" data-testid="wizard-sliders">
      {wrap('blade', '', <SliderField
        label={autoBlade === true ? t('rightPanel.cut.bladeDepth') : t('rightPanel.cut.blade')} value={cut.blade} min={1} max={10} onChange={(v) => set({ blade: v })}
        title={autoBlade === true ? t('rightPanel.cut.bladeTooltipAuto') : autoBlade === false ? t('rightPanel.cut.bladeTooltipManual') : t('rightPanel.cut.bladeTooltip')}
      />)}
      {autoBlade === true && <p className="hint subtle blade-note"><Info size={12} />{t('rightPanel.cut.bladeNoteAuto')}</p>}
      {autoBlade === false && <p className="hint subtle blade-note" data-testid="wizard-blade-manual"><Info size={12} />{t('rightPanel.cut.bladeNoteManual', { level: cut.blade })}</p>}
      {wrap('force', '', <SliderField label={t('rightPanel.cut.force')} value={cut.force} min={1} max={33} onChange={(v) => set({ force: v })} title={t('rightPanel.cut.forceTooltip')} />)}
      {wrap('speed', '', <SliderField label={t('rightPanel.cut.speed')} value={cut.speed} min={1} max={10} onChange={(v) => set({ speed: v })} title={t('rightPanel.cut.speedTooltip')} />)}
      {wrap('passes', '', <SliderField label={t('rightPanel.cut.passes')} value={cut.passes} min={1} max={5} onChange={(v) => set({ passes: v })} title={t('rightPanel.cut.passesTooltip')} />)}
      {wrap('overcut', ' mm', <SliderField label={t('rightPanel.cut.overcut')} value={cut.overcut} min={0} max={5} step={0.1} digits={1} unit="mm" onChange={(v) => set({ overcut: Math.round(v * 10) / 10 })} title={t('rightPanel.cut.overcutTooltip')} />)}
    </div>
  )
}

/** Kurzfassung der Werte als Chips (wie im Schneiden-Dialog). */
function CutChips({ cut, autoBlade }: { cut: CutSettings; autoBlade: boolean | undefined }): JSX.Element {
  const t = useT()
  return (
    <div className="summary-cut">
      {autoBlade === true
        ? <span title={t('cut.blade.auto.tooltip')}>{t('cut.blade.auto')} <b>{cut.blade}</b> {t('cut.blade.autoSuffix')}</span>
        : <span title={t('cut.blade.manual.tooltip')}>{t('cut.blade.manual')} <b>{cut.blade}</b></span>}
      <span>{t('cut.setting.force')} <b>{cut.force}</b></span><span>{t('cut.setting.speed')} <b>{cut.speed}</b></span>
      <span>{t('cut.setting.passes')} <b>{cut.passes}</b></span><span>{t('cut.setting.overcut')} <b>{fmt(cut.overcut)} mm</b></span>
    </div>
  )
}

function WizardInner(): JSX.Element {
  const t = useT()
  const wizard = useStore((s) => s.wizard)
  const patch = useStore((s) => s.patchWizard)
  const close = useStore((s) => s.closeWizard)
  const reset = useStore((s) => s.resetWizard)
  const save = useStore((s) => s.saveWizardProfile)
  const setCut = useStore((s) => s.setCut)
  const toast = useStore((s) => s.toast)
  const askConfirm = useStore((s) => s.askConfirm)
  const settings = useStore((s) => s.settings)
  const device = useStore((s) => s.devices.find((d) => d.id === s.connectedId))
  const blocker = useTestCutBlocker()
  const wa = settings.activeWorkArea
  const autoBlade = device?.autoBlade
  const profiles = settings.materialProfiles ?? []
  const { attempts, cut, stage } = wizard

  // ---- Lauf (Schneiden) ----
  const [phase, setPhase] = useState<Phase>('idle')
  const [run, setRun] = useState<{ jobs: CutJob[]; index: number; added: number } | null>(null)
  const [live, setLive] = useState<Live>(freshLive())
  const [error, setError] = useState('')
  const [lost, setLost] = useState(false)
  const [pauseMsg, setPauseMsg] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [ejecting, setEjecting] = useState(false)
  const [startFrom, setStartFrom] = useState('cur')
  const unsub = useRef<(() => void) | null>(null)
  const runRef = useRef<Run | null>(null)
  const liveRef = useRef<Live>(live)
  const phaseRef = useRef<Phase>('idle')
  phaseRef.current = phase
  const onEventRef = useRef<(e: PlotEvent) => void>(() => undefined)

  const setLiveBoth = (l: Live): void => { liveRef.current = l; setLive(l) }
  const active = phase === 'running' || phase === 'paused'

  useEffect(() => () => { unsub.current?.() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Escape gehört einem offenen Namens-/Bestätigungsdialog; beim Schneiden gesperrt
      if (e.key === 'Escape' && !useStore.getState().dialog && phaseRef.current !== 'running' && phaseRef.current !== 'paused') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const stopRun = (kind: 'cancelled' | 'error', message = '', deviceLost = false): void => {
    const r = runRef.current
    unsub.current?.(); unsub.current = null
    runRef.current = null
    if (r) {
      // Behalten: fertig geschnittene Aufträge plus der angeschnittene; nichts geschnitten = alles zurückrollen (Platz bleibt frei)
      const kept = Math.min(r.added, r.index + (liveRef.current.cutLength > 0 ? 1 : 0))
      const cur = useStore.getState().wizard
      const mine = cur.attempts.slice(r.before.attempts.length, r.before.attempts.length + r.added)
      patch({
        attempts: [...r.before.attempts, ...mine.slice(0, kept)],
        nextSlot: kept === 0 ? r.before.nextSlot : cur.nextSlot,
        stage: kept > 0 ? 'rate' : r.before.stage
      })
    }
    setRun(null)
    setCancelling(false)
    setError(message)
    setLost(deviceLost)
    setPhase(kind)
  }

  const sendJob = async (i: number): Promise<void> => {
    const r = runRef.current
    if (!r) return
    setEjecting(false)
    try {
      await window.api.startPlot(r.jobs[i])
    } catch (e) {
      stopRun('error', (e as Error).message || t('cut.error.startFailed'))
    }
  }

  /** Nächster Auftrag des Rasters: erst warten, bis der Plotter wieder frei ist. */
  const advance = async (): Promise<void> => {
    const r = runRef.current
    if (!r) return
    r.index += 1
    r.between = true
    setRun({ jobs: r.jobs, index: r.index, added: r.added })
    setLiveBoth(freshLive())
    await sleep(150)
    for (let i = 0; i < 50 && useStore.getState().deviceStatus === 'busy'; i++) await sleep(100)
    if (runRef.current !== r || r.stopped) return
    r.between = false
    await sendJob(r.index)
  }

  const onEvent = (e: PlotEvent): void => {
    switch (e.type) {
      case 'started': setLiveBoth({ ...liveRef.current, totalLength: e.totalLength || liveRef.current.totalLength }); break
      case 'progress': setLiveBoth({ ...liveRef.current, cutLength: e.cutLength, pathIndex: e.pathIndex, pathDone: e.done, x: e.x, y: e.y }); break
      case 'finished': {
        const r = runRef.current
        if (!r) break
        if (r.index + 1 < r.jobs.length) { void advance(); break }
        unsub.current?.(); unsub.current = null
        runRef.current = null
        setRun(null)
        patch({ stage: 'rate' })
        setPhase('idle')
        break
      }
      case 'cancelled': stopRun('cancelled'); break
      case 'paused': setPauseMsg(e.message); setPhase('paused'); break
      case 'resumed': setPhase('running'); break
      case 'ejecting': setEjecting(true); break
      case 'error': stopRun('error', e.message, !!e.deviceLost); break
    }
  }
  onEventRef.current = onEvent

  const startRun = (jobs: CutJob[], added: WizardAttempt[], nextSlot: number): void => {
    setError(''); setLost(false); setCancelling(false); setEjecting(false)
    runRef.current = { jobs, index: 0, added: added.length, before: { attempts, nextSlot: wizard.nextSlot, stage }, between: false, stopped: false }
    setRun({ jobs, index: 0, added: added.length })
    setLiveBoth(freshLive())
    patch({ attempts: [...attempts, ...added], nextSlot })
    setPhase('running')
    unsub.current?.()
    unsub.current = window.api.onPlotEvent((e) => onEventRef.current(e))
    void sendJob(0)
  }

  const cancel = async (): Promise<void> => {
    setCancelling(true)
    const r = runRef.current
    if (r?.between) { r.stopped = true; stopRun('cancelled'); return }
    try { await window.api.cancelPlot() } catch (e) { toast('error', t('cut.error.cancelFailed', { message: (e as Error).message })) }
  }
  const resume = async (): Promise<void> => {
    try { await window.api.resumePlot() } catch (e) { toast('error', t('cut.error.resumeFailed', { message: (e as Error).message })) }
  }

  // ---- Tests starten ----
  const ejectMm = wizard.ejectOn ? wizard.ejectMm : undefined
  const variants = useMemo(
    () => gridVariants(cut, wizard.gridParam, wizard.gridStart, wizard.gridStep, wizard.gridCount),
    [cut, wizard.gridParam, wizard.gridStart, wizard.gridStep, wizard.gridCount]
  )
  const gridPlan = useMemo(() => buildGridJobs(wa, variants, wizard.nextSlot, ejectMm), [wa, variants, wizard.nextSlot, ejectMm])
  const singleSlot = slotPosition(wa, wizard.nextSlot)
  const total = slotCount(wa)

  const runSingle = (c: CutSettings): void => {
    const n = attempts.filter((a) => a.kind === 'single').length + 1
    const job = buildWizardJob(wa, c, wizard.nextSlot, n, ejectMm)
    if (!job) return
    startRun([job], [{ n, cut: { ...c }, slot: wizard.nextSlot, kind: 'single', piece: wizard.piece }], wizard.nextSlot + 1)
  }
  const runGrid = (): void => {
    if (!gridPlan) return
    startRun(
      gridPlan.jobs,
      variants.map((c, i) => ({ n: i + 1, cut: c, slot: gridPlan.firstSlot, kind: 'grid' as const, piece: wizard.piece })),
      gridPlan.nextSlot
    )
  }

  // ---- Bewertung ----
  const last = attempts[attempts.length - 1]
  const group = useMemo(
    () => (!last ? [] : last.kind === 'grid' ? attempts.filter((a) => a.kind === 'grid' && a.slot === last.slot && a.piece === last.piece) : [last]),
    [attempts, last]
  )
  const setVerdict = (target: WizardAttempt, verdict: Verdict | undefined): WizardAttempt[] =>
    attempts.map((a) => (a === target ? { ...a, verdict } : a))
  const rate = (v: Verdict): void => {
    if (!last) return
    const list = setVerdict(last, v)
    if (v === 'good') patch({ attempts: list, cut: { ...last.cut }, stage: 'save' })
    else patch({ attempts: list, cut: suggestAdjustment(last.cut, v, autoBlade).cut, stage: 'adjust' })
  }
  const pick = (a: WizardAttempt): void => patch({ attempts: setVerdict(a, 'good'), cut: { ...a.cut }, stage: 'save' })
  /** Zurück zur Bewertung des letzten Tests (Urteil wird gelöscht). */
  const rerate = (): void => {
    const picked = group.find((a) => a.verdict !== undefined)
    patch({ attempts: picked ? setVerdict(picked, undefined) : attempts, stage: 'rate' })
  }
  const toGrid = (param: GridParam = wizard.gridParam): void => {
    const g = gridDefaults(cut, param, wizard.gridCount)
    patch({ stage: 'setup', mode: 'grid', gridParam: param, gridStart: g.start, gridStep: g.step })
  }
  const backFromSetup = (): void => {
    patch({ stage: last?.verdict && last.verdict !== 'good' ? 'adjust' : 'rate' })
  }
  const newPiece = (): void => patch({ nextSlot: 0, piece: wizard.piece + 1 })
  const doReset = async (): Promise<void> => {
    if (await askConfirm(t('wizard.reset.title'), t('wizard.reset.message'), t('wizard.reset.confirm'), true)) { reset(); setStartFrom('cur') }
  }
  const applyOnly = (): void => {
    setCut(cut)
    toast('success', t('wizard.save.applied'))
    reset()
    close()
  }

  const full = wizard.mode === 'grid' && stage === 'setup' ? gridPlan === null : singleSlot === null
  const startBlock = blocker ?? (full ? t('wizard.slots.full') : undefined)
  const used = Math.min(wizard.nextSlot, total)

  // ---- Vorschau ----
  const piece = wizard.piece
  const preview = useMemo(() => {
    const shown = run ? attempts.slice(0, attempts.length - run.added) : attempts
    const items: { d: string; cls: string }[] = []
    const cls = (a: WizardAttempt): string => 'wiz-p ' + (group.includes(a) ? 'cur' : 'old') + (a.verdict === 'good' ? ' ok' : a.verdict ? ' bad' : '')
    const add = (job: CutJob | null, a: WizardAttempt): void => { if (job) items.push({ d: job.paths.map((p) => pathD(p.points, p.closed)).join(''), cls: cls(a) }) }
    const grids = new Map<number, WizardAttempt[]>()
    for (const a of shown) {
      if (a.piece !== piece) continue
      if (a.kind === 'single') add(buildWizardJob(wa, a.cut, a.slot, a.n), a)
      else grids.set(a.slot, [...(grids.get(a.slot) ?? []), a])
    }
    for (const [slot, list] of grids) {
      const sorted = [...list].sort((x, y) => x.n - y.n)
      buildGridJobs(wa, sorted.map((a) => a.cut), slot)?.jobs.forEach((job, i) => add(job, sorted[i]))
    }
    return items
  }, [attempts, run, piece, wa, group])

  const nextRect = useMemo(() => {
    if (stage !== 'setup' && stage !== 'adjust') return null
    if (wizard.mode === 'grid' && stage === 'setup') {
      const pos = gridPlan ? slotPosition(wa, gridPlan.firstSlot) : null
      return pos ? { x: pos.x, y: pos.y, w: (variants.length - 1) * 22 + 15, h: 35 } : null
    }
    const pos = slotPosition(wa, wizard.nextSlot)
    return pos ? { x: pos.x, y: pos.y, w: 55, h: 35 } : null
  }, [stage, wizard.mode, wizard.nextSlot, gridPlan, variants.length, wa])

  // ---- Live-Ansicht ----
  const liveD = useMemo(() => (run ? run.jobs.map((j) => j.paths.map((p) => pathD(p.points, p.closed))) : []), [run])
  const idx = run?.index ?? 0
  const doneCount = Math.max(0, live.pathIndex + (live.pathDone ? 1 : 0))
  const dDone = run ? liveD.slice(0, idx).flat().join('') + (liveD[idx] ?? []).slice(0, doneCount).join('') : ''
  const dRest = run ? (liveD[idx] ?? []).slice(doneCount).join('') + liveD.slice(idx + 1).flat().join('') : ''
  const dCur = run && phase === 'running' && !live.pathDone && live.pathIndex >= 0 ? (liveD[idx] ?? [])[live.pathIndex] ?? '' : ''
  const frac = live.totalLength > 0 ? Math.min(1, live.cutLength / live.totalLength) : 0
  const pct = run ? Math.min(100, ((idx + frac) / run.jobs.length) * 100) : 0

  // ---- Teilbereiche der Oberfläche ----
  const slotStatus = (
    <>
      <p className="hint subtle" data-testid="wizard-slots"><Info size={12} />{t('wizard.slots.status', { used, total })}</p>
      {full && <p className="hint danger" data-testid="wizard-full"><AlertTriangle size={14} />{wizard.mode === 'grid' && stage === 'setup' && singleSlot !== null ? t('wizard.slots.fullGrid') : t('wizard.slots.full')}</p>}
      <button className={'btn small' + (full ? ' primary' : '')} onClick={newPiece} disabled={wizard.nextSlot === 0} data-testid="wizard-new-piece" title={t('wizard.slots.newPieceTooltip')}>
        <Plus size={13} /> {t('wizard.slots.newPiece')}
      </button>
    </>
  )
  const ejectBlock = (
    <div className="wiz-eject" data-testid="wizard-eject">
      <label className="check" title={t('wizard.eject.tooltip')}>
        <input type="checkbox" data-testid="wizard-eject-check" checked={wizard.ejectOn} onChange={(e) => patch({ ejectOn: e.target.checked })} /> {t('wizard.eject.label')}
      </label>
      {wizard.ejectOn && (
        <>
          <NumberField label={t('wizard.eject.distance')} unit="mm" value={wizard.ejectMm} min={0} max={MAX_EJECT_MM} step={1} digits={0} onCommit={(v) => patch({ ejectMm: v })} title={t('wizard.eject.tooltip')} />
          <p className="hint subtle"><Info size={12} />{t('wizard.eject.hint')}</p>
        </>
      )}
    </div>
  )
  const noteField = (
    <label className="field stacked">
      <span className="field-label">{t('wizard.note.label')}</span>
      <input className="text-input" type="text" maxLength={200} value={wizard.note} placeholder={t('wizard.note.placeholder')} data-testid="wizard-note" onChange={(e) => patch({ note: e.target.value })} />
    </label>
  )

  const startFromChange = (v: string): void => {
    setStartFrom(v)
    const p = v === 'cur' ? { cut: settings.cut } : v.startsWith('b:') ? BUILTIN_MATERIALS.find((m) => m.name === v.slice(2)) : profiles.find((m) => m.name === v.slice(2))
    if (p) patch({ cut: { ...p.cut } })
  }

  const lastCut = last?.cut
  const adj = last?.verdict && last.verdict !== 'good' ? suggestAdjustment(last.cut, last.verdict, autoBlade) : null
  const titleKey: MessageKey = phase === 'paused' ? 'wizard.title.paused' : phase === 'running' ? 'wizard.title.running' : phase === 'cancelled' ? 'wizard.title.cancelled' : phase === 'error' ? 'wizard.title.error' : TITLE_KEY[stage]

  return (
    <div className="modal-backdrop" onMouseDown={() => !active && close()}>
      <div className="modal wizard" role="dialog" aria-modal="true" aria-label={t('wizard.aria')} data-testid="wizard-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2><Wand2 size={17} /> {t(titleKey)}</h2>
          <button className="icon-btn" onClick={close} disabled={active} title={active ? t('cut.close.disabled') : t('cut.close')}><X size={16} /></button>
        </div>
        <div className="modal-body wizard-body">
          <div className="cut-body">
            <div className="live">
              <MatView wa={wa} items={preview} next={phase === 'idle' ? nextRect : null}>
                {run && (
                  <>
                    <path d={dRest} className="live-pending" />
                    <path d={dDone} className="live-done" />
                    {dCur && <path d={dCur} className="live-current" />}
                    {phase === 'running' && live.pathIndex >= 0 && (
                      <g transform={`translate(${live.x} ${live.y})`}>
                        <circle r={Math.max(wa.width, wa.height) * 0.012} className="live-pulse" />
                        <circle r={Math.max(wa.width, wa.height) * 0.006} className="live-dot" />
                      </g>
                    )}
                  </>
                )}
              </MatView>
            </div>

            <div className="cut-side wiz-side">
              {phase === 'idle' && stage === 'setup' && (
                <>
                  <p className="hint"><Wand2 size={14} />{t('wizard.setup.intro')}</p>
                  <label className="field stacked">
                    <span className="field-label">{t('wizard.setup.startFrom')}</span>
                    <select className="select" value={startFrom} onChange={(e) => startFromChange(e.target.value)} data-testid="wizard-start-from">
                      <option value="cur">{t('wizard.setup.startCurrent')}</option>
                      {BUILTIN_MATERIALS.map((m) => <option key={'b:' + m.name} value={'b:' + m.name}>{materialLabel(m)}</option>)}
                      {profiles.map((m) => <option key={'c:' + m.name} value={'c:' + m.name}>{m.name}</option>)}
                    </select>
                  </label>
                  <CutSliders cut={cut} onChange={(c) => patch({ cut: c })} autoBlade={autoBlade} />
                  <div className="seg" role="group" aria-label={t('wizard.mode.aria')}>
                    <button className={wizard.mode === 'single' ? 'on' : ''} aria-pressed={wizard.mode === 'single'} onClick={() => patch({ mode: 'single' })} data-testid="wizard-mode-single" title={t('wizard.mode.singleTooltip')}>{t('wizard.mode.single')}</button>
                    <button className={wizard.mode === 'grid' ? 'on' : ''} aria-pressed={wizard.mode === 'grid'} onClick={() => toGrid()} data-testid="wizard-mode-grid" title={t('wizard.mode.gridTooltip')}>{t('wizard.mode.grid')}</button>
                  </div>
                  {wizard.mode === 'single'
                    ? <p className="hint subtle"><Info size={12} />{t('wizard.mode.singleHint')}</p>
                    : (
                      <div className="wiz-grid" data-testid="wizard-grid-setup">
                        <div className="seg seg3" role="group" aria-label={t('wizard.grid.param.aria')}>
                          {(['force', 'speed', 'blade'] as GridParam[]).map((p) => (
                            <button
                              key={p} className={wizard.gridParam === p ? 'on' : ''} aria-pressed={wizard.gridParam === p} onClick={() => toGrid(p)} data-testid={'wizard-param-' + p}
                              disabled={p === 'blade' && autoBlade === false} title={p === 'blade' && autoBlade === false ? t('wizard.grid.bladeManual') : undefined}
                            >{t(PARAM_KEY[p])}</button>
                          ))}
                        </div>
                        <div className="grid2">
                          <NumberField label={t('wizard.grid.start')} value={wizard.gridStart} min={1} max={33} step={1} digits={0} onCommit={(v) => patch({ gridStart: v })} />
                          <NumberField label={t('wizard.grid.step')} value={wizard.gridStep} min={-10} max={10} step={1} digits={0} onCommit={(v) => patch({ gridStep: v })} />
                          <NumberField label={t('wizard.grid.count')} value={wizard.gridCount} min={GRID_MIN_COUNT} max={GRID_MAX_COUNT} step={1} digits={0} onCommit={(v) => patch({ gridCount: v })} />
                        </div>
                        <p className="hint subtle" data-testid="wizard-grid-variants"><Info size={12} />{t('wizard.grid.variants', { param: t(PARAM_KEY[wizard.gridParam]), list: variants.map((c) => c[wizard.gridParam]).join(', ') })}</p>
                        <p className="hint subtle"><Info size={12} />{t('wizard.grid.hint')}</p>
                      </div>
                    )}
                  {noteField}
                  {ejectBlock}
                  {slotStatus}
                  {blocker && <p className="hint danger"><AlertTriangle size={14} />{blocker}</p>}
                </>
              )}

              {phase === 'idle' && stage === 'rate' && last && (
                <>
                  {group.length > 1 || last.kind === 'grid' ? (
                    <>
                      <p className="hint"><Wand2 size={14} />{t('wizard.rate.gridIntro')}</p>
                      <div className="row col" data-testid="wizard-grid-pick">
                        {[...group].sort((a, b) => a.n - b.n).map((a) => (
                          <button key={a.n} className="btn" onClick={() => pick(a)} data-testid={'wizard-pick-' + a.n}>
                            {t('wizard.grid.variantLabel', { n: a.n, param: t(PARAM_KEY[wizard.gridParam]), value: a.cut[wizard.gridParam] })}
                          </button>
                        ))}
                        <button className="btn danger-ghost" onClick={() => toGrid()} data-testid="wizard-grid-none">{t('wizard.rate.gridNone')}</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="hint"><Wand2 size={14} />{t('wizard.rate.intro', { n: last.n })}</p>
                      <CutChips cut={last.cut} autoBlade={autoBlade} />
                      <div className="sub-head">{t('wizard.rate.question')}</div>
                      <div className="row col" data-testid="wizard-verdicts">
                        <button className="btn primary" onClick={() => rate('good')} data-testid="wizard-verdict-good"><CheckCircle2 size={14} /> {t('wizard.rate.good')}</button>
                        {VERDICTS.filter((v): v is Exclude<Verdict, 'good'> => v !== 'good').map((v) => (
                          <button key={v} className="btn" onClick={() => rate(v)} data-testid={'wizard-verdict-' + v} title={t(VERDICT_TIP[v])}>{t(VERDICT_KEY[v])}</button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              {phase === 'idle' && stage === 'adjust' && last && (
                <>
                  <p className="hint"><AlertTriangle size={14} /><span>{t('wizard.adjust.verdict', { verdict: last.verdict ? t(VERDICT_KEY[last.verdict]) : '' })}<br />{adj && t(adj.reasonKey)}</span></p>
                  <CutSliders cut={cut} onChange={(c) => patch({ cut: c })} autoBlade={autoBlade} prev={last.cut} />
                  <p className="hint subtle" data-testid="wizard-changed-legend"><Info size={12} />{(['blade', 'force', 'speed', 'passes', 'overcut'] as const).some((k) => Math.abs(last.cut[k] - cut[k]) > 1e-9) ? t('wizard.adjust.changedLegend') : t('wizard.adjust.noChange')}</p>
                  <div className="row">
                    <button className="btn small" onClick={() => adj && patch({ cut: { ...adj.cut } })} disabled={!adj} title={t('wizard.adjust.suggestionTooltip')}><RotateCcw size={13} /> {t('wizard.adjust.suggestion')}</button>
                    <button className="btn small" onClick={rerate} data-testid="wizard-rerate"><Undo2 size={13} /> {t('wizard.adjust.rerate')}</button>
                  </div>
                  <button className="btn small" onClick={() => toGrid()} data-testid="wizard-to-grid" title={t('wizard.adjust.toGridTooltip')}>{t('wizard.adjust.toGrid')}</button>
                  {ejectBlock}
                  {slotStatus}
                  {blocker && <p className="hint danger"><AlertTriangle size={14} />{blocker}</p>}
                </>
              )}

              {phase === 'idle' && stage === 'save' && (
                <>
                  <p className="hint ok"><CheckCircle2 size={14} />{t('wizard.save.intro', { n: wizardTestCount(attempts) })}</p>
                  <CutChips cut={cut} autoBlade={autoBlade} />
                  {noteField}
                  <p className="hint subtle"><Info size={12} />{t('wizard.save.historyNote', { history: t('wizard.save.history', { n: wizardTestCount(attempts), force: cut.force, speed: cut.speed }) })}</p>
                  <button className="btn small" onClick={rerate} data-testid="wizard-back-rate"><Undo2 size={13} /> {t('wizard.save.back')}</button>
                  {ejectBlock}
                  {slotStatus}
                  {blocker && <p className="hint danger"><AlertTriangle size={14} />{blocker}</p>}
                </>
              )}

              {run && (phase === 'running' || phase === 'paused') && (
                <>
                  {phase === 'paused'
                    ? <p className="hint warn big" data-testid="wizard-pause"><PauseCircle size={16} /><span><b>{t('cut.title.paused')}</b><br />{pauseMsg}<br />{t('cut.paused.next')}</span></p>
                    : (
                      <>
                        <div className="big-pct">{Math.round(pct)}<small>%</small></div>
                        <div className="progress"><div className="progress-bar" style={{ width: pct + '%' }} /></div>
                      </>
                    )}
                  {run.jobs.length > 1 && <p className="hint subtle"><Info size={12} />{t('wizard.running.gridStep', { n: Math.min(idx + 1, run.jobs.length), total: run.jobs.length })}</p>}
                  <p className="hint"><Loader2 size={14} className="spin" />{cancelling ? t('cut.running.cancelling') : ejecting ? t('cut.running.ejecting') : t('cut.running.warn')}</p>
                </>
              )}
              {phase === 'cancelled' && <p className="hint warn"><AlertTriangle size={14} />{t('cut.cancelled')}</p>}
              {phase === 'error' && (
                <p className="hint danger big"><AlertTriangle size={16} /><span><b>{lost ? t('cut.error.lost') : t('cut.error.failedTest')}</b><br />{error}{lost && <><br />{t('cut.error.lostHint')}</>}</span></p>
              )}
            </div>
          </div>

          {attempts.length > 0 && (
            <div className="wiz-table-wrap" data-testid="wizard-table-wrap">
              <div className="sub-head">{t('wizard.table.title')}</div>
              <table className="wiz-table" data-testid="wizard-table">
                <thead>
                  <tr>
                    <th>{t('wizard.table.no')}</th><th>{autoBlade === true ? t('rightPanel.cut.bladeDepth') : t('rightPanel.cut.blade')}</th><th>{t('cut.setting.force')}</th>
                    <th>{t('cut.setting.speed')}</th><th>{t('cut.setting.passes')}</th><th>{t('cut.setting.overcut')}</th><th>{t('wizard.table.verdict')}</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((a, i) => (
                    <tr key={i} className={group.includes(a) ? 'cur' : ''}>
                      <td>{a.kind === 'grid' ? t('wizard.table.grid', { n: a.n }) : a.n}</td><td>{a.cut.blade}</td><td>{a.cut.force}</td><td>{a.cut.speed}</td>
                      <td>{a.cut.passes}</td><td>{fmt(a.cut.overcut)}</td><td>{a.verdict ? t(VERDICT_KEY[a.verdict]) : t('wizard.table.open')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-foot">
          {active && (
            <>
              {phase === 'paused' && <button className="btn primary" onClick={() => void resume()}>{t('cut.btn.resume')}</button>}
              <button className="btn danger" onClick={() => void cancel()} disabled={cancelling}>{cancelling ? t('cut.btn.cancelling') : t('cut.btn.cancel')}</button>
            </>
          )}
          {(phase === 'cancelled' || phase === 'error') && (
            <>
              <button className="btn" onClick={close}>{t('cut.close')}</button>
              <button className="btn primary" onClick={() => setPhase('idle')} data-testid="wizard-continue">{t('cut.btn.back')}</button>
            </>
          )}
          {phase === 'idle' && (
            <>
              <button className="btn" onClick={close} title={t('wizard.close.tooltip')}>{t('cut.close')}</button>
              {attempts.length > 0 && <button className="btn" onClick={() => void doReset()} data-testid="wizard-reset" title={t('wizard.reset.tooltip')}>{t('wizard.btn.reset')}</button>}
              {stage === 'setup' && attempts.length > 0 && <button className="btn" onClick={backFromSetup}>{t('wizard.btn.back')}</button>}
              {stage === 'setup' && (
                <button
                  className="btn primary big" data-testid="wizard-start" disabled={!!startBlock || (wizard.mode === 'grid' && !gridPlan)} title={startBlock}
                  onClick={() => (wizard.mode === 'grid' ? runGrid() : runSingle(cut))}
                ><Scissors size={16} /> {wizard.mode === 'grid' ? t('wizard.btn.cutGrid') : t('wizard.btn.cutSingle')}</button>
              )}
              {stage === 'adjust' && (
                <>
                  <button className="btn" disabled={!!startBlock || !lastCut} title={startBlock ?? t('wizard.btn.cutSameTooltip')} onClick={() => lastCut && runSingle(lastCut)} data-testid="wizard-same">{t('wizard.btn.cutSame')}</button>
                  <button className="btn primary big" disabled={!!startBlock} title={startBlock} onClick={() => runSingle(cut)} data-testid="wizard-next"><Scissors size={16} /> {t('wizard.btn.cutNext')}</button>
                </>
              )}
              {stage === 'save' && (
                <>
                  <button className="btn" disabled={!!startBlock} title={startBlock ?? t('wizard.btn.cutConfirmTooltip')} onClick={() => runSingle(cut)} data-testid="wizard-confirm-cut">{t('wizard.btn.cutConfirm')}</button>
                  <button className="btn" onClick={applyOnly} title={t('wizard.btn.applyTooltip')} data-testid="wizard-apply">{t('wizard.btn.apply')}</button>
                  <button className="btn primary big" onClick={() => void save()} data-testid="wizard-save"><Save size={16} /> {t('wizard.btn.save')}</button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
