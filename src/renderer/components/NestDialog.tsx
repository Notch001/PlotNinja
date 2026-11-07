import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, CopyPlus, Info, Loader2, Shapes, X } from 'lucide-react'
import type { NestRotate, Part, WorkArea } from '@shared/types'
import { NEST_MAX_COUNT, NEST_MAX_MM } from '@shared/types'
import { formatNumber, type MessageKey } from '@shared/i18n'
import {
  applyArrange, applyMulti, buildArrangeJob, buildMultiJob, buildShape, expandToGroups, interpretMulti, partPaths, rotatedOrigin, sanitizeNest,
  shapeBox, unionBox, type ArrangeJob, type MultiOptions, type MultiPlan, type NestOptions, type NestResult
} from '../core'
import { runNest } from '../lib/nestRunner'
import { useT } from '../lib/useT'
import { pathD } from '../lib/transform'
import { useStore } from '../store'
import { NumberField } from './NumberField'

const DEBOUNCE_MS = 250

/** Zahl mit höchstens einer Nachkommastelle nach der aktuellen Sprache. */
const fmt = (n: number): string => formatNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: 1 })

/** Wandelt <b>…</b> und <small>…</small> eines Katalogtexts in React-Knoten. */
function rich(s: string): ReactNode[] {
  return s.split(/(<b>.*?<\/b>|<small>.*?<\/small>)/).map((part, i) => {
    const m = /^<(b|small)>(.*)<\/\1>$/.exec(part)
    return m ? (m[1] === 'b' ? <b key={i}>{m[2]}</b> : <small key={i}>{m[2]}</small>) : part
  })
}

export function NestDialog(): JSX.Element | null {
  const mode = useStore((s) => s.nestOpen)
  if (!mode) return null
  return <NestDialogInner mode={mode} />
}

type Run =
  | { state: 'busy'; prev: Done | null }
  | { state: 'error'; message: string }
  | ({ state: 'done' } & Done)
interface Done { result: NestResult; plan: MultiPlan | null; arrange: ArrangeJob | null }

const ROT_LABEL: Record<NestRotate, MessageKey> = { off: 'nest.dialog.rotate.off', '90': 'nest.dialog.rotate.90', free: 'nest.dialog.rotate.free' }
const ROT_TIP: Record<NestRotate, MessageKey> = { off: 'nest.dialog.rotate.offTip', '90': 'nest.dialog.rotate.90Tip', free: 'nest.dialog.rotate.freeTip' }

function NestDialogInner({ mode }: { mode: 'multi' | 'arrange' }): JSX.Element {
  const t = useT()
  const close = useStore((s) => s.setNestOpen)
  const parts = useStore((s) => s.parts)
  const selection = useStore((s) => s.selection)
  const wa = useStore((s) => s.settings.activeWorkArea)
  const raw = useStore((s) => s.settings.nestDefaults)
  const setDefaults = useStore((s) => s.setNestDefaults)
  const o = sanitizeNest(raw)
  const isMulti = mode === 'multi'

  // Einheit(en): Mehrfach = die gewählte Einheit (Gruppen komplett); Anordnen = Auswahl oder alle
  const selIds = useMemo(() => expandToGroups(parts, selection), [parts, selection])
  const [allUnits, setAllUnits] = useState(selection.length === 0)
  const scopeIds = isMulti || !allUnits ? selIds : null
  const template = useMemo(() => (isMulti ? parts.filter((p) => selIds.includes(p.id)) : []), [isMulti, parts, selIds])
  const tbox = useMemo(() => unionBox(template), [template])
  const unitCount = useMemo(() => {
    const ids = scopeIds ? new Set(scopeIds) : null
    const gs = new Set<string>()
    let n = 0
    for (const p of parts) { if (ids && !ids.has(p.id)) continue; if (p.groupId) { if (gs.has(p.groupId)) continue; gs.add(p.groupId) } n++ }
    return n
  }, [parts, scopeIds])

  const [run, setRun] = useState<Run>({ state: 'busy', prev: null })
  const first = useRef(true)
  const optKey = JSON.stringify([o.mode, o.count, o.gapMm, o.marginMm, o.rotate, o.holes, o.includeOriginal, allUnits, wa.width, wa.height])
  const empty = isMulti ? template.length === 0 : unitCount === 0

  useEffect(() => {
    if (empty) return
    setRun((r) => ({ state: 'busy', prev: r.state === 'done' ? r : r.state === 'busy' ? r.prev : null }))
    const nopt: NestOptions = { gap: o.gapMm, margin: o.marginMm, rotate: o.rotate, holes: o.holes }
    const mopt: MultiOptions = { ...nopt, count: o.mode === 'fill' ? 'fill' : o.count, includeOriginal: o.includeOriginal }
    let job, arrange: ArrangeJob | null = null
    try {
      if (isMulti) job = buildMultiJob(parts, template, wa, mopt)
      else { arrange = buildArrangeJob(parts, scopeIds, wa, nopt); job = arrange.job }
    } catch (e) { setRun({ state: 'error', message: String((e as Error)?.message ?? e) }); return }
    let nr: ReturnType<typeof runNest> | null = null
    const timer = setTimeout(() => {
      nr = runNest(job)
      nr.promise.then((result) => {
        setRun({ state: 'done', result, plan: isMulti ? interpretMulti(result, mopt) : null, arrange })
      }).catch((e: Error) => setRun({ state: 'error', message: e.message }))
    }, first.current ? 0 : DEBOUNCE_MS)
    first.current = false
    return () => { clearTimeout(timer); nr?.cancel() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optKey, parts, template, empty])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !useStore.getState().dialog) close(null)
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const done: Done | null = run.state === 'done' ? run : run.state === 'busy' ? run.prev : null
  const plan = done?.plan ?? null
  const copies = plan?.copies.length ?? 0
  const placedUnits = done?.result.placements.length ?? 0
  const canApply = run.state === 'done' && (isMulti ? copies > 0 || !!plan?.original : placedUnits > 0 || (done?.arrange?.groups.length ?? 0) > 0)

  const apply = (): void => {
    const st = useStore.getState()
    if (run.state !== 'done') return
    if (isMulti && run.plan) {
      const { original, copies: cps } = applyMulti(template, run.plan)
      if (!cps.length && !original) return
      const orig = new Map((original ?? []).map((p) => [p.id, p]))
      const next = [...st.parts.map((p) => orig.get(p.id) ?? p), ...cps]
      st.commitParts(next, cps.length ? cps.map((p) => p.id) : template.map((p) => p.id))
      const want = run.plan.requested
      st.toast('success', t('nest.dialog.toast.placed', { n: run.plan.copies.length }))
      if (want !== 'fill' && run.plan.copies.length < want) st.toast('warn', t('nest.dialog.toast.onlyFit', { n: run.plan.copies.length, want }))
    } else if (!isMulti && run.arrange) {
      const out = applyArrange(st.parts, run.arrange.groups, run.result, wa, { gap: o.gapMm, margin: o.marginMm })
      st.commitParts(out.parts, st.selection)
      st.toast(out.unplaced ? 'warn' : 'success', out.unplaced
        ? t('nest.dialog.toast.arrangedUnplaced', { placed: out.placed, unplaced: out.unplaced })
        : t('nest.dialog.toast.arranged', { n: out.placed, util: Math.round(run.result.utilization * 100) }))
    }
    close(null)
  }

  // Vorschau-Daten
  const view = useMemo(() => buildView(parts, template, done, isMulti, scopeIds, wa, o.includeOriginal), [parts, template, done, isMulti, scopeIds, wa, o.includeOriginal])

  const usable = { w: Math.max(0, wa.width - 2 * o.marginMm), h: Math.max(0, wa.height - 2 * o.marginMm) }
  const tooBig = isMulti && !!plan?.tooBig
  const title = isMulti ? t('nest.dialog.title.multi') : t('nest.dialog.title.arrange')
  const Icon = isMulti ? CopyPlus : Shapes
  const util = done ? Math.round(done.result.utilization * 100) : 0
  const total = copies + 1

  return (
    <div className="modal-backdrop" onMouseDown={() => close(null)}>
      <div className="modal nest-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()} data-testid="nest-dialog">
        <div className="modal-head">
          <h2><Icon size={17} /> {title}</h2>
          <button className="icon-btn" onClick={() => close(null)} title={t('nest.dialog.close')}><X size={16} /></button>
        </div>
        <div className="modal-body nest-body">
          <div className="nest-form">
            {empty ? (
              <div className="empty-mini" data-testid="nest-empty">{isMulti ? t('nest.dialog.empty.multi') : t('nest.dialog.empty.arrange')}</div>
            ) : (
              <>
                {isMulti ? (
                  <p className="nest-source"><b>{template.length === 1 ? template[0].name : t('nest.dialog.source.parts', { n: template.length })}</b>{tbox && <> · {fmt(tbox.width)} × {fmt(tbox.height)} mm</>}<br /><small>{t('nest.dialog.source.hint')}</small></p>
                ) : (
                  <div className="seg" role="group" aria-label={t('nest.dialog.scope.aria')}>
                    <button className={!allUnits ? 'on' : ''} disabled={!selIds.length} onClick={() => setAllUnits(false)} title={selIds.length ? t('nest.dialog.scope.selTip') : t('nest.dialog.scope.selNone')} data-testid="nest-scope-sel">{t('nest.dialog.scope.sel')}</button>
                    <button className={allUnits ? 'on' : ''} onClick={() => setAllUnits(true)} title={t('nest.dialog.scope.allTip')} data-testid="nest-scope-all">{t('nest.dialog.scope.all')}</button>
                  </div>
                )}
                {isMulti && (
                  <>
                    <div className="seg" role="group" aria-label={t('nest.dialog.qty.aria')}>
                      <button className={o.mode === 'count' ? 'on' : ''} onClick={() => setDefaults({ mode: 'count' })} title={t('nest.dialog.mode.countTip')} data-testid="nest-mode-count">{t('nest.dialog.mode.count')}</button>
                      <button className={o.mode === 'fill' ? 'on' : ''} onClick={() => setDefaults({ mode: 'fill' })} title={t('nest.dialog.mode.fillTip')} data-testid="nest-mode-fill">{t('nest.dialog.mode.fill')}</button>
                    </div>
                    <NumberField label={t('nest.dialog.copies.label')} value={o.count} min={1} max={NEST_MAX_COUNT} step={1} digits={0} disabled={o.mode === 'fill'} onCommit={(v) => setDefaults({ count: Math.round(v) })} title={t('nest.dialog.copies.tip', { max: NEST_MAX_COUNT })} />
                  </>
                )}
                <div className="grid2">
                  <NumberField label={t('nest.dialog.gap.label')} unit="mm" value={o.gapMm} min={0} max={NEST_MAX_MM} step={0.5} digits={1} onCommit={(v) => setDefaults({ gapMm: v })} title={t('nest.dialog.gap.tip')} />
                  <NumberField label={t('nest.dialog.margin.label')} unit="mm" value={o.marginMm} min={0} max={NEST_MAX_MM} step={0.5} digits={1} onCommit={(v) => setDefaults({ marginMm: v })} title={t('nest.dialog.margin.tip')} />
                </div>
                <div className="nest-label">{t('nest.dialog.rotate.label')}</div>
                <div className="seg seg-n3" role="group" aria-label={t('nest.dialog.rotate.label')}>
                  {(['off', '90', 'free'] as NestRotate[]).map((r) => (
                    <button key={r} className={o.rotate === r ? 'on' : ''} onClick={() => setDefaults({ rotate: r })} title={t(ROT_TIP[r])} data-testid={'nest-rot-' + r}>{t(ROT_LABEL[r])}</button>
                  ))}
                </div>
                <label className="check" title={t('nest.dialog.holes.tip')}><input type="checkbox" checked={o.holes} onChange={(e) => setDefaults({ holes: e.target.checked })} data-testid="nest-holes" /> {t('nest.dialog.holes.label')}</label>
                {isMulti && (
                  <label className="check" title={t('nest.dialog.original.tip')}><input type="checkbox" checked={o.includeOriginal} onChange={(e) => setDefaults({ includeOriginal: e.target.checked })} data-testid="nest-include-original" /> {t('nest.dialog.original.label')}</label>
                )}
                <div className="nest-result" data-testid="nest-result" aria-live="polite">
                  {run.state === 'error' && <p className="hint danger"><AlertTriangle size={14} />{t('nest.dialog.error', { message: run.message })}</p>}
                  {tooBig && <p className="hint danger"><AlertTriangle size={14} />{t('nest.dialog.tooBig', { size: tbox ? `${fmt(tbox.width)} × ${fmt(tbox.height)}` : '?', usable: `${fmt(usable.w)} × ${fmt(usable.h)}` })}</p>}
                  {!isMulti && done && done.result.tooBig.some(Boolean) && <p className="hint warn"><AlertTriangle size={14} />{t('nest.dialog.unitsTooBig', { n: done.result.tooBig.filter(Boolean).length })}</p>}
                  {done && !tooBig && isMulti && plan && (
                    <>
                      <p className="nest-count">{o.mode === 'fill'
                        ? rich(t('nest.dialog.fit.fill', { total, copies: t('nest.dialog.copiesCount', { n: copies }) }))
                        : rich(t('nest.dialog.fit.count', { copies, wanted: t('nest.dialog.copiesCount', { n: o.count }) }))}</p>
                      {o.mode === 'count' && copies < o.count && <p className="hint warn"><AlertTriangle size={14} />{t('nest.dialog.onlyFit', { copies, rest: o.count - copies })}</p>}
                      {o.mode === 'fill' && copies === 0 && <p className="hint warn"><AlertTriangle size={14} />{t('nest.dialog.fillNone')}</p>}
                    </>
                  )}
                  {done && !isMulti && (
                    <>
                      <p className="nest-count">{rich(t('nest.dialog.arranged', { placed: placedUnits, total: done.arrange?.groups.length ?? 0 }))}</p>
                      {placedUnits < (done.arrange?.groups.length ?? 0) && <p className="hint warn"><AlertTriangle size={14} />{t('nest.dialog.arrangeOnlyFit', { placed: placedUnits, rest: (done.arrange?.groups.length ?? 0) - placedUnits })}</p>}
                    </>
                  )}
                  {done && !tooBig && <p className="nest-util">{rich(t('nest.dialog.util', { util }))}</p>}
                  {done?.result.timedOut && <p className="hint warn"><Info size={14} />{t('nest.dialog.timedOut')}</p>}
                  {!isMulti && <p className="hint subtle"><Info size={12} />{t('nest.dialog.arrangeHint')}</p>}
                </div>
              </>
            )}
          </div>
          <div className="nest-preview" data-testid="nest-preview">
            {!empty && (
              <svg viewBox={`${-6} ${-6} ${wa.width + 12} ${wa.height + 12}`} preserveAspectRatio="xMidYMid meet">
                <rect x={0} y={0} width={wa.width} height={wa.height} className="nest-mat" />
                <rect x={o.marginMm} y={o.marginMm} width={usable.w} height={usable.h} className="nest-margin" />
                {view.fixed && <path d={view.fixed} className="nest-fixed" fillRule="evenodd" />}
                {view.defId && view.unitD && <defs><path id={view.defId} d={view.unitD} fillRule="evenodd" /></defs>}
                {view.uses.map((u, i) => <use key={i} href={'#' + view.defId} transform={u} className={i === 0 && view.firstIsOriginal ? 'nest-ghost orig' : 'nest-ghost'} />)}
                {view.moved && <path d={view.moved} className="nest-ghost" fillRule="evenodd" />}
                {view.overflow && <path d={view.overflow} className="nest-over" fillRule="evenodd" />}
              </svg>
            )}
            {run.state === 'busy' && !empty && <span className="preview-busy" data-testid="nest-busy"><Loader2 size={14} className="spin" /> {t('nest.dialog.busy')}</span>}
            {run.state === 'done' && !empty && !tooBig && <span className="preview-size"><CheckCircle2 size={12} /> {formatNumber(wa.width)} × {formatNumber(wa.height)} mm</span>}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => close(null)}>{t('nest.dialog.cancel')}</button>
          <button className="btn primary big" onClick={apply} disabled={!canApply} data-testid="nest-apply" title={t('nest.dialog.apply.tip')}>
            <Icon size={16} /> {isMulti ? (copies > 0 ? t('nest.dialog.apply.copies', { n: copies }) : t('nest.dialog.apply.plain')) : t('nest.dialog.apply.arrange')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface View { fixed: string; unitD: string; defId: string; uses: string[]; firstIsOriginal: boolean; moved: string; overflow: string }

const dOf = (ps: Part[]): string => ps.map((p) => partPaths(p).map((pl) => pathD(pl.points, pl.closed)).join('')).join('')

/** Zeichnet Hindernisse, Geisterkonturen (Kopien per <use>) bzw. das angeordnete Ergebnis. */
function buildView(parts: Part[], template: Part[], done: Done | null, isMulti: boolean, scopeIds: string[] | null, wa: WorkArea, includeOriginal: boolean): View {
  const v: View = { fixed: '', unitD: '', defId: 'nest-unit', uses: [], firstIsOriginal: false, moved: '', overflow: '' }
  if (isMulti) {
    const tids = new Set(template.map((p) => p.id))
    v.fixed = dOf(parts.filter((p) => includeOriginal ? !tids.has(p.id) : true))
    const plan = done?.plan
    if (!plan) return v
    v.unitD = dOf(template)
    const sh = buildShape(template, false)
    const b = shapeBox(sh)
    if (!b) return v
    const cache = new Map<number, { x: number; y: number }>()
    const tf = (pl: { rotation: number; cx: number; cy: number; x: number; y: number }): string => {
      let og = cache.get(pl.rotation)
      if (!og) { og = rotatedOrigin(sh, pl.cx, pl.cy, pl.rotation); cache.set(pl.rotation, og) }
      return `translate(${(pl.x - og.x).toFixed(3)} ${(pl.y - og.y).toFixed(3)})` + (pl.rotation ? ` rotate(${pl.rotation} ${pl.cx.toFixed(3)} ${pl.cy.toFixed(3)})` : '')
    }
    if (plan.original) { v.uses.push(tf(plan.original)); v.firstIsOriginal = true }
    for (const pl of plan.copies) v.uses.push(tf(pl))
    return v
  }
  const ids = scopeIds ? new Set(scopeIds) : null
  v.fixed = dOf(parts.filter((p) => (ids ? !ids.has(p.id) : false)))
  if (done?.arrange) {
    const out = applyArrange(parts, done.arrange.groups, done.result, wa, { gap: 0, margin: 0 })
    const moved: Part[] = [], over: Part[] = []
    const placed = new Set(done.result.placements.map((pl) => pl.item))
    done.arrange.groups.forEach((g, k) => { for (const i of g) (placed.has(k) ? moved : over).push(out.parts[i]) })
    v.moved = dOf(moved)
    v.overflow = dOf(over)
  }
  return v
}
