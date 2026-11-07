import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ChevronDown, LayoutGrid, RotateCcw, RotateCw, Shapes, Wand2
} from 'lucide-react'
import { alignParts, autoArrange, countUnits, distributeParts } from '../core'
import { selectedParts, useStore } from '../store'
import { useT } from '../lib/useT'


/** 90°-Drehung links/rechts (Einzelteil, Gruppe, Mehrfachauswahl um die gemeinsame Mitte). */
export function RotateButtons(): JSX.Element {
  const hasSel = useStore((s) => s.selection.length > 0)
  const rotate = useStore((s) => s.rotateSelectionBy)
  const t = useT()
  const off = t('headerTools.rotate.needSelection')
  return (
    <div className="btn-group" role="group" aria-label={t('headerTools.rotate.label')}>
      <button className="icon-btn" onClick={() => rotate(-90)} disabled={!hasSel} data-testid="rot-ccw"
        title={t('headerTools.rotate.ccw') + (hasSel ? '' : off)}><RotateCcw size={17} /><span className="deg90">90</span></button>
      <button className="icon-btn" onClick={() => rotate(90)} disabled={!hasSel} data-testid="rot-cw"
        title={t('headerTools.rotate.cw') + (hasSel ? '' : off)}><RotateCw size={17} /><span className="deg90">90</span></button>
    </div>
  )
}

/** Ausrichten, Verteilen, Anordnen – Werkzeugblock der Kopfzeile. `compact`: einklappbares Popover. */
export function AlignTools({ compact }: { compact: boolean }): JSX.Element {
  const parts = useStore((s) => s.parts)
  const selection = useStore((s) => s.selection)
  const wa = useStore((s) => s.settings.activeWorkArea)
  const target = useStore((s) => s.alignTarget)
  const setTarget = useStore((s) => s.setAlignTarget)
  const replace = useStore((s) => s.replaceParts)
  const centerAll = useStore((s) => s.centerAll)
  const toast = useStore((s) => s.toast)
  const t = useT()
  const setNestOpen = useStore((s) => s.setNestOpen)
  const sel = useMemo(() => selectedParts(parts, selection), [parts, selection])
  const units = countUnits(sel)
  // Genau eine Einheit gewählt: „an Auswahl“ ergäbe nichts -> automatisch auf Arbeitsfläche, danach zurück
  const auto = useRef(false)
  useEffect(() => {
    if (units === 1 && target === 'selection') { auto.current = true; setTarget('workarea') }
    else if (units >= 2 && target === 'workarea' && auto.current) { auto.current = false; setTarget('selection') }
  }, [units, target, setTarget])
  const setManual = (to: 'selection' | 'workarea'): void => { auto.current = false; setTarget(to) }

  const canAlign = target === 'workarea' ? units >= 1 : units >= 2
  const reason = target === 'workarea' ? t('headerTools.align.reason.workarea') : t('headerTools.align.reason.selection')
  const btn = (mode: Parameters<typeof alignParts>[1], label: string, icon: JSX.Element): JSX.Element => (
    <button className="icon-btn" disabled={!canAlign} onClick={() => replace(alignParts(sel, mode, target, wa))} title={canAlign ? label : t('headerTools.align.disabled', { label, reason })} data-testid={'align-' + mode}>{icon}</button>
  )
  const body = (
    <>
      <div className="seg seg-mini" role="group" aria-label={t('headerTools.align.to.label')}>
        <button className={target === 'selection' ? 'on' : ''} aria-pressed={target === 'selection'} onClick={() => setManual('selection')} title={t('headerTools.align.to.selection.tooltip')} data-testid="align-target-sel">{t('headerTools.align.to.selection')}</button>
        <button className={target === 'workarea' ? 'on' : ''} aria-pressed={target === 'workarea'} onClick={() => setManual('workarea')} title={t('headerTools.align.to.workarea.tooltip')} data-testid="align-target-wa">{t('headerTools.align.to.workarea')}</button>
      </div>
      <div className="btn-group">
        {btn('left', t('headerTools.align.left'), <AlignStartVertical size={17} />)}
        {btn('hcenter', t('headerTools.align.hcenter'), <AlignCenterVertical size={17} />)}
        {btn('right', t('headerTools.align.right'), <AlignEndVertical size={17} />)}
        <span className="align-sep" />
        {btn('top', t('headerTools.align.top'), <AlignStartHorizontal size={17} />)}
        {btn('vcenter', t('headerTools.align.vcenter'), <AlignCenterHorizontal size={17} />)}
        {btn('bottom', t('headerTools.align.bottom'), <AlignEndHorizontal size={17} />)}
      </div>
      <div className="btn-group">
        <button className="icon-btn" disabled={units < 3} onClick={() => replace(distributeParts(sel, 'h'))} title={units < 3 ? t('headerTools.distribute.h.disabled') : t('headerTools.distribute.h')} data-testid="dist-h"><AlignHorizontalDistributeCenter size={17} /></button>
        <button className="icon-btn" disabled={units < 3} onClick={() => replace(distributeParts(sel, 'v'))} title={units < 3 ? t('headerTools.distribute.v.disabled') : t('headerTools.distribute.v')} data-testid="dist-v"><AlignVerticalDistributeCenter size={17} /></button>
      </div>
      <div className="btn-group">
        <button
          className="icon-btn" disabled={!parts.length} data-testid="auto-arrange"
          title={parts.length ? t('headerTools.arrange.tooltip') : t('headerTools.arrange.empty')}
          onClick={() => {
            replace(autoArrange(parts, wa))
            const loose = new Map<string, number>()
            for (const p of parts) if (!p.groupId) loose.set(p.sourcePath, (loose.get(p.sourcePath) ?? 0) + 1)
            const scattered = [...loose.values()].some((n) => n > 1)
            toast('success', scattered ? t('headerTools.arrange.doneHint') : t('headerTools.arrange.done'))
          }}
        ><LayoutGrid size={17} /></button>
        <button
          className="icon-btn" disabled={!parts.length} data-testid="nest-arrange" onClick={() => setNestOpen('arrange')}
          title={parts.length ? t('headerTools.nest.tooltip') : t('headerTools.nest.empty')}
        ><Shapes size={17} /></button>
        <button className="icon-btn" disabled={!parts.length} onClick={centerAll} title={parts.length ? t('headerTools.centerAll.tooltip') : t('headerTools.centerAll.empty')} data-testid="center-all"><Wand2 size={17} /></button>
      </div>
    </>
  )
  if (!compact) return <div className="align-tools" role="group" aria-label={t('headerTools.align.label')}>{body}</div>
  return <AlignPopover>{body}</AlignPopover>
}

function AlignPopover({ children }: { children: JSX.Element }): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="align-pop" ref={ref}>
      <button className={'btn ghost' + (open ? ' open' : '')} onClick={() => setOpen(!open)} aria-haspopup="true" aria-expanded={open} title={t('headerTools.align.popover')} data-testid="align-pop-btn">
        <AlignStartVertical size={15} /> {t('headerTools.align.label')} <ChevronDown size={13} />
      </button>
      {open && <div className="align-pop-panel" role="group" aria-label={t('headerTools.align.label')}>{children}</div>}
    </div>
  )
}

