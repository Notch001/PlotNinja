import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, CopyPlus, Info, Loader2, Shapes, X } from 'lucide-react'
import type { NestRotate, Part, WorkArea } from '@shared/types'
import { NEST_MAX_COUNT, NEST_MAX_MM } from '@shared/types'
import {
  applyArrange, applyMulti, buildArrangeJob, buildMultiJob, buildShape, expandToGroups, interpretMulti, partPaths, rotatedOrigin, sanitizeNest,
  shapeBox, unionBox, type ArrangeJob, type MultiOptions, type MultiPlan, type NestOptions, type NestResult
} from '../core'
import { runNest } from '../lib/nestRunner'
import { fmt, pathD } from '../lib/transform'
import { useStore } from '../store'
import { NumberField } from './NumberField'

const DEBOUNCE_MS = 250

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

const ROT_LABEL: Record<NestRotate, string> = { off: 'Aus', '90': '90°-Schritte', free: 'Frei (alle 15°)' }
const ROT_TIP: Record<NestRotate, string> = {
  off: 'Teile behalten ihre Ausrichtung',
  '90': 'Teile dürfen in 90°-Schritten gedreht werden (0°, 90°, 180°, 270°) – gut für Material mit Faserrichtung oder Raster',
  free: 'Teile dürfen in 15°-Schritten gedreht werden – dichteste Packung, aber längere Rechenzeit'
}

function NestDialogInner({ mode }: { mode: 'multi' | 'arrange' }): JSX.Element {
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
    const t = setTimeout(() => {
      nr = runNest(job)
      nr.promise.then((result) => {
        setRun({ state: 'done', result, plan: isMulti ? interpretMulti(result, mopt) : null, arrange })
      }).catch((e: Error) => setRun({ state: 'error', message: e.message }))
    }, first.current ? 0 : DEBOUNCE_MS)
    first.current = false
    return () => { clearTimeout(t); nr?.cancel() }
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
      st.toast('success', `${run.plan.copies.length} ${run.plan.copies.length === 1 ? 'Kopie' : 'Kopien'} platziert – Strg+Z macht alles in einem Schritt rückgängig`)
      if (want !== 'fill' && run.plan.copies.length < want) st.toast('warn', `Nur ${run.plan.copies.length} von ${want} passen – der Rest wurde nicht platziert`)
    } else if (!isMulti && run.arrange) {
      const out = applyArrange(st.parts, run.arrange.groups, run.result, wa, { gap: o.gapMm, margin: o.marginMm })
      st.commitParts(out.parts, st.selection)
      st.toast(out.unplaced ? 'warn' : 'success', out.unplaced
        ? `${out.placed} Einheiten kompakt angeordnet – ${out.unplaced} passen nicht auf die Matte und liegen darunter (rot markiert)`
        : `${out.placed} ${out.placed === 1 ? 'Einheit' : 'Einheiten'} kompakt angeordnet (${Math.round(run.result.utilization * 100)} % Auslastung)`)
    }
    close(null)
  }

  // Vorschau-Daten
  const view = useMemo(() => buildView(parts, template, done, isMulti, scopeIds, wa, o.includeOriginal), [parts, template, done, isMulti, scopeIds, wa, o.includeOriginal])

  const usable = { w: Math.max(0, wa.width - 2 * o.marginMm), h: Math.max(0, wa.height - 2 * o.marginMm) }
  const tooBig = isMulti && !!plan?.tooBig
  const title = isMulti ? 'Mehrfach platzieren' : 'Kompakt anordnen (Nesting)'
  const Icon = isMulti ? CopyPlus : Shapes
  const util = done ? Math.round(done.result.utilization * 100) : 0
  const total = copies + 1

  return (
    <div className="modal-backdrop" onMouseDown={() => close(null)}>
      <div className="modal nest-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()} data-testid="nest-dialog">
        <div className="modal-head">
          <h2><Icon size={17} /> {title}</h2>
          <button className="icon-btn" onClick={() => close(null)} title="Schließen (Esc)"><X size={16} /></button>
        </div>
        <div className="modal-body nest-body">
          <div className="nest-form">
            {empty ? (
              <div className="empty-mini" data-testid="nest-empty">{isMulti ? 'Nichts ausgewählt. Wähle zuerst ein Bauteil oder eine Gruppe auf der Arbeitsfläche aus.' : 'Es sind keine Bauteile vorhanden.'}</div>
            ) : (
              <>
                {isMulti ? (
                  <p className="nest-source"><b>{template.length === 1 ? template[0].name : `${template.length} Teile`}</b>{tbox && <> · {fmt(tbox.width)} × {fmt(tbox.height)} mm</>}<br /><small>Gruppen und Schnittrand werden als eine Einheit vervielfältigt.</small></p>
                ) : (
                  <div className="seg" role="group" aria-label="Umfang">
                    <button className={!allUnits ? 'on' : ''} disabled={!selIds.length} onClick={() => setAllUnits(false)} title={selIds.length ? 'Nur die gewählten Einheiten werden neu angeordnet; alle anderen bleiben liegen und sind Hindernisse' : 'Nichts ausgewählt'} data-testid="nest-scope-sel">Auswahl</button>
                    <button className={allUnits ? 'on' : ''} onClick={() => setAllUnits(true)} title="Alle Einheiten auf der Arbeitsfläche werden neu angeordnet" data-testid="nest-scope-all">Alle</button>
                  </div>
                )}
                {isMulti && (
                  <>
                    <div className="seg" role="group" aria-label="Menge">
                      <button className={o.mode === 'count' ? 'on' : ''} onClick={() => setDefaults({ mode: 'count' })} title="Eine feste Anzahl Kopien platzieren" data-testid="nest-mode-count">Anzahl</button>
                      <button className={o.mode === 'fill' ? 'on' : ''} onClick={() => setDefaults({ mode: 'fill' })} title="So viele Kopien platzieren, wie auf die Matte passen" data-testid="nest-mode-fill">So viele wie passen</button>
                    </div>
                    <NumberField label="Kopien" value={o.count} min={1} max={NEST_MAX_COUNT} step={1} digits={0} disabled={o.mode === 'fill'} onCommit={(v) => setDefaults({ count: Math.round(v) })} title={`Anzahl neuer Kopien (1–${NEST_MAX_COUNT})`} />
                  </>
                )}
                <div className="grid2">
                  <NumberField label="Abstand" unit="mm" value={o.gapMm} min={0} max={NEST_MAX_MM} step={0.5} digits={1} onCommit={(v) => setDefaults({ gapMm: v })} title="Mindestabstand zwischen den Teilen (0–50 mm). Der tatsächliche Abstand kann bis etwa 1 mm größer sein." />
                  <NumberField label="Rand" unit="mm" value={o.marginMm} min={0} max={NEST_MAX_MM} step={0.5} digits={1} onCommit={(v) => setDefaults({ marginMm: v })} title="Abstand der Teile zum Rand der Matte" />
                </div>
                <div className="nest-label">Drehen erlaubt</div>
                <div className="seg seg-n3" role="group" aria-label="Drehen erlaubt">
                  {(['off', '90', 'free'] as NestRotate[]).map((r) => (
                    <button key={r} className={o.rotate === r ? 'on' : ''} onClick={() => setDefaults({ rotate: r })} title={ROT_TIP[r]} data-testid={'nest-rot-' + r}>{ROT_LABEL[r]}</button>
                  ))}
                </div>
                <label className="check" title="Kleinere Teile dürfen in Löcher größerer Teile (z. B. Rahmen, Ring). Aus: die Außenhülle bleibt frei. Vorsicht: Teile im Loch lassen sich beim Entgittern schwerer lösen."><input type="checkbox" checked={o.holes} onChange={(e) => setDefaults({ holes: e.target.checked })} data-testid="nest-holes" /> In Löcher einpassen</label>
                {isMulti && (
                  <label className="check" title="Das Original wird zusammen mit den Kopien neu eingeordnet. Aus: das Original bleibt an seinem Platz und ist ein Hindernis."><input type="checkbox" checked={o.includeOriginal} onChange={(e) => setDefaults({ includeOriginal: e.target.checked })} data-testid="nest-include-original" /> Original mit neu einordnen</label>
                )}
                <div className="nest-result" data-testid="nest-result" aria-live="polite">
                  {run.state === 'error' && <p className="hint danger"><AlertTriangle size={14} />Berechnung fehlgeschlagen: {run.message}</p>}
                  {tooBig && <p className="hint danger"><AlertTriangle size={14} />Das Bauteil ({tbox ? `${fmt(tbox.width)} × ${fmt(tbox.height)}` : '?'} mm) ist größer als die nutzbare Matte ({fmt(usable.w)} × {fmt(usable.h)} mm) – auch gedreht passt es nicht. Verkleinere es, den Randabstand oder wähle eine größere Arbeitsfläche.</p>}
                  {!isMulti && done && done.result.tooBig.some(Boolean) && <p className="hint warn"><AlertTriangle size={14} />{done.result.tooBig.filter(Boolean).length} Einheit(en) sind größer als die nutzbare Matte und werden unterhalb abgelegt.</p>}
                  {done && !tooBig && isMulti && plan && (
                    <>
                      <p className="nest-count">{o.mode === 'fill'
                        ? <>Es passen <b>{total}</b> Stück <small>(Original + {copies} {copies === 1 ? 'Kopie' : 'Kopien'})</small></>
                        : <><b>{copies}</b> von {o.count} {o.count === 1 ? 'Kopie' : 'Kopien'} platziert</>}</p>
                      {o.mode === 'count' && copies < o.count && <p className="hint warn"><AlertTriangle size={14} />Nur {copies} passen – der Rest ({o.count - copies}) wird nicht platziert.</p>}
                      {o.mode === 'fill' && copies === 0 && <p className="hint warn"><AlertTriangle size={14} />Es passt keine weitere Kopie auf die Matte.</p>}
                    </>
                  )}
                  {done && !isMulti && (
                    <>
                      <p className="nest-count"><b>{placedUnits}</b> von {done.arrange?.groups.length ?? 0} Einheiten angeordnet</p>
                      {placedUnits < (done.arrange?.groups.length ?? 0) && <p className="hint warn"><AlertTriangle size={14} />Nur {placedUnits} passen – {(done.arrange?.groups.length ?? 0) - placedUnits} werden unterhalb der Matte abgelegt (rot markiert).</p>}
                    </>
                  )}
                  {done && !tooBig && <p className="nest-util">Material-Auslastung <b>{util} %</b></p>}
                  {done?.result.timedOut && <p className="hint warn"><Info size={14} />Zeitlimit erreicht – das ist der beste Stand bis dahin. Weniger Drehungen oder weniger Kopien rechnen schneller.</p>}
                  {!isMulti && <p className="hint subtle"><Info size={12} />Das Anordnen ändert nur Lage und Drehung; Gruppen bleiben starr. Das bisherige „Automatisch anordnen“ bleibt unverändert verfügbar.</p>}
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
            {run.state === 'busy' && !empty && <span className="preview-busy" data-testid="nest-busy"><Loader2 size={14} className="spin" /> Berechne …</span>}
            {run.state === 'done' && !empty && !tooBig && <span className="preview-size"><CheckCircle2 size={12} /> {wa.width} × {wa.height} mm</span>}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => close(null)}>Abbrechen</button>
          <button className="btn primary big" onClick={apply} disabled={!canApply} data-testid="nest-apply" title="Übernehmen (Strg+Enter) – ein Rückgängig-Schritt">
            <Icon size={16} /> {isMulti ? (copies > 0 ? `${copies} ${copies === 1 ? 'Kopie' : 'Kopien'} übernehmen` : 'Übernehmen') : 'Anordnen'}
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
