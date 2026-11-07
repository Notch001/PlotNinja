import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ChevronDown, LayoutGrid, RotateCcw, RotateCw, Wand2
} from 'lucide-react'
import { alignParts, autoArrange, countUnits, distributeParts } from '../core'
import { selectedParts, useStore } from '../store'


/** 90°-Drehung links/rechts (Einzelteil, Gruppe, Mehrfachauswahl um die gemeinsame Mitte). */
export function RotateButtons(): JSX.Element {
  const hasSel = useStore((s) => s.selection.length > 0)
  const rotate = useStore((s) => s.rotateSelectionBy)
  const off = ' – zuerst ein Bauteil auswählen'
  return (
    <div className="btn-group" role="group" aria-label="Drehen">
      <button className="icon-btn" onClick={() => rotate(-90)} disabled={!hasSel} data-testid="rot-ccw"
        title={'90° gegen den Uhrzeigersinn drehen (Umschalt+R)' + (hasSel ? '' : off)}><RotateCcw size={17} /><span className="deg90">90</span></button>
      <button className="icon-btn" onClick={() => rotate(90)} disabled={!hasSel} data-testid="rot-cw"
        title={'90° im Uhrzeigersinn drehen (R)' + (hasSel ? '' : off)}><RotateCw size={17} /><span className="deg90">90</span></button>
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
  const sel = useMemo(() => selectedParts(parts, selection), [parts, selection])
  const units = countUnits(sel)
  // Genau eine Einheit gewählt: „an Auswahl“ ergäbe nichts -> automatisch auf Arbeitsfläche, danach zurück
  const auto = useRef(false)
  useEffect(() => {
    if (units === 1 && target === 'selection') { auto.current = true; setTarget('workarea') }
    else if (units >= 2 && target === 'workarea' && auto.current) { auto.current = false; setTarget('selection') }
  }, [units, target, setTarget])
  const setManual = (t: 'selection' | 'workarea'): void => { auto.current = false; setTarget(t) }

  const canAlign = target === 'workarea' ? units >= 1 : units >= 2
  const reason = target === 'workarea' ? 'zuerst ein Bauteil auswählen' : 'mindestens 2 Bauteile auswählen (oder auf „Fläche“ umschalten)'
  const btn = (mode: Parameters<typeof alignParts>[1], label: string, icon: JSX.Element): JSX.Element => (
    <button className="icon-btn" disabled={!canAlign} onClick={() => replace(alignParts(sel, mode, target, wa))} title={canAlign ? label : `${label} – ${reason}`} data-testid={'align-' + mode}>{icon}</button>
  )
  const body = (
    <>
      <div className="seg seg-mini" role="group" aria-label="Ausrichten an">
        <button className={target === 'selection' ? 'on' : ''} aria-pressed={target === 'selection'} onClick={() => setManual('selection')} title="Ausrichten an der Auswahl: die gewählten Teile werden aneinander ausgerichtet (mind. 2)" data-testid="align-target-sel">Auswahl</button>
        <button className={target === 'workarea' ? 'on' : ''} aria-pressed={target === 'workarea'} onClick={() => setManual('workarea')} title="Ausrichten an der Arbeitsfläche: die gewählten Teile werden an Rändern bzw. Mitte der Fläche ausgerichtet" data-testid="align-target-wa">Fläche</button>
      </div>
      <div className="btn-group">
        {btn('left', 'Links ausrichten', <AlignStartVertical size={17} />)}
        {btn('hcenter', 'Horizontal zentrieren', <AlignCenterVertical size={17} />)}
        {btn('right', 'Rechts ausrichten', <AlignEndVertical size={17} />)}
        <span className="align-sep" />
        {btn('top', 'Oben ausrichten', <AlignStartHorizontal size={17} />)}
        {btn('vcenter', 'Vertikal zentrieren', <AlignCenterHorizontal size={17} />)}
        {btn('bottom', 'Unten ausrichten', <AlignEndHorizontal size={17} />)}
      </div>
      <div className="btn-group">
        <button className="icon-btn" disabled={units < 3} onClick={() => replace(distributeParts(sel, 'h'))} title={units < 3 ? 'Horizontal verteilen – mindestens 3 Bauteile auswählen' : 'Gleichmäßig horizontal verteilen'} data-testid="dist-h"><AlignHorizontalDistributeCenter size={17} /></button>
        <button className="icon-btn" disabled={units < 3} onClick={() => replace(distributeParts(sel, 'v'))} title={units < 3 ? 'Vertikal verteilen – mindestens 3 Bauteile auswählen' : 'Gleichmäßig vertikal verteilen'} data-testid="dist-v"><AlignVerticalDistributeCenter size={17} /></button>
      </div>
      <div className="btn-group">
        <button
          className="icon-btn" disabled={!parts.length} data-testid="auto-arrange"
          title={parts.length ? 'Automatisch anordnen: alle Bauteile platzsparend platzieren (Gruppen bleiben zusammen)' : 'Automatisch anordnen – keine Bauteile vorhanden'}
          onClick={() => {
            replace(autoArrange(parts, wa))
            const loose = new Map<string, number>()
            for (const p of parts) if (!p.groupId) loose.set(p.sourcePath, (loose.get(p.sourcePath) ?? 0) + 1)
            const scattered = [...loose.values()].some((n) => n > 1)
            toast('success', scattered ? 'Angeordnet – zusammengehörige Teile vorher mit Strg+G gruppieren, damit sie zusammenbleiben' : 'Bauteile angeordnet')
          }}
        ><LayoutGrid size={17} /></button>
        <button className="icon-btn" disabled={!parts.length} onClick={centerAll} title={parts.length ? 'Alles zentrieren: alle Bauteile als Gruppe auf der Arbeitsfläche zentrieren' : 'Alles zentrieren – keine Bauteile vorhanden'} data-testid="center-all"><Wand2 size={17} /></button>
      </div>
    </>
  )
  if (!compact) return <div className="align-tools" role="group" aria-label="Ausrichten">{body}</div>
  return <AlignPopover>{body}</AlignPopover>
}

function AlignPopover({ children }: { children: JSX.Element }): JSX.Element {
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
      <button className={'btn ghost' + (open ? ' open' : '')} onClick={() => setOpen(!open)} aria-haspopup="true" aria-expanded={open} title="Ausrichten, Verteilen und Anordnen" data-testid="align-pop-btn">
        <AlignStartVertical size={15} /> Ausrichten <ChevronDown size={13} />
      </button>
      {open && <div className="align-pop-panel" role="group" aria-label="Ausrichten">{children}</div>}
    </div>
  )
}

