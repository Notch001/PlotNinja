import { useMemo } from 'react'
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, Copy, Cpu, Group, LayoutGrid, Split, Move, Plug, PlugZap,
  Merge, RefreshCw, RotateCw, Ruler, Save, Scissors, Trash2, Ungroup, Wand2, Info, Usb, FlaskConical
} from 'lucide-react'
import type { DeviceStatus } from '@shared/types'
import { alignParts, autoArrange, countUnits, distributeParts, outOfBoundsUnits } from '../core'
import { useStore, selectedParts } from '../store'
import { Card } from './Card'
import { NumberField } from './NumberField'
import { unionBounds } from '../lib/transform'

const STATUS_LABEL: Record<DeviceStatus, string> = {
  disconnected: 'Getrennt', ready: 'Bereit', busy: 'Beschäftigt', 'no-media': 'Kein Medium', error: 'Fehler'
}

export function PlotterPanel(): JSX.Element {
  const { devices, devicesLoading, selectedDeviceId, connectedId, deviceStatus } = useStore()
  const refresh = useStore((s) => s.refreshDevices)
  const selectDevice = useStore((s) => s.selectDevice)
  const connect = useStore((s) => s.connect)
  const disconnect = useStore((s) => s.disconnect)
  const connected = connectedId !== null && deviceStatus !== 'disconnected'
  const hasUsb = devices.some((d) => d.kind === 'usb')
  return (
    <Card
      id="plotter" title="Plotter" icon={<Cpu size={15} />}
      right={<span className={'pill ' + deviceStatus}><i />{STATUS_LABEL[deviceStatus]}</span>}
    >
      <div className="device-list">
        {devices.map((d) => (
          <button
            key={d.id}
            className={'device' + (selectedDeviceId === d.id ? ' sel' : '') + (connectedId === d.id ? ' conn' : '')}
            onClick={() => !connected && selectDevice(d.id)}
            disabled={connected && connectedId !== d.id}
            title={d.name}
          >
            <span className="device-ico">{d.kind === 'simulator' ? <FlaskConical size={15} /> : <Usb size={15} />}</span>
            <span className="device-name">{d.name}</span>
            {connectedId === d.id && <span className="device-tag">verbunden</span>}
          </button>
        ))}
        {!devices.length && <div className="empty-mini">{devicesLoading ? 'Suche Geräte …' : 'Keine Geräte gefunden'}</div>}
      </div>
      {!hasUsb && !devicesLoading && (
        <p className="hint"><Info size={14} />Kein Plotter gefunden. Schließe den Cameo per USB an, schalte ihn ein und klicke „Aktualisieren“. Zum Ausprobieren ohne Hardware kannst du den <b>Simulator</b> verbinden.</p>
      )}
      <div className="row">
        <button className="btn" onClick={() => void refresh()} disabled={devicesLoading || connected} title="Nach angeschlossenen Geräten suchen">
          <RefreshCw size={14} className={devicesLoading ? 'spin' : ''} /> Aktualisieren
        </button>
        {connected ? (
          <button className="btn" onClick={() => void disconnect()} disabled={deviceStatus === 'busy'} title="Verbindung zum Plotter trennen"><Plug size={14} /> Trennen</button>
        ) : (
          <button className="btn primary" onClick={() => void connect()} disabled={!selectedDeviceId} title={selectedDeviceId ? 'Mit dem ausgewählten Gerät verbinden' : 'Zuerst ein Gerät auswählen'}><PlugZap size={14} /> Verbinden</button>
        )}
      </div>
      {deviceStatus === 'no-media' && <p className="hint warn"><Info size={14} />Es ist kein Material eingelegt. Lege die Matte ein und bestätige am Plotter.</p>}
    </Card>
  )
}

export function WorkAreaPanel(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const setWorkArea = useStore((s) => s.setWorkArea)
  const askText = useStore((s) => s.askText)
  const save = useStore((s) => s.saveWorkAreaPreset)
  const del = useStore((s) => s.deleteWorkAreaPreset)
  const wa = settings.activeWorkArea
  const preset = settings.workAreas.find((w) => w.name === wa.name && w.width === wa.width && w.height === wa.height)
  return (
    <Card id="workarea" title="Arbeitsfläche" icon={<Ruler size={15} />}>
      <label className="field stacked">
        <span className="field-label">Vorlage</span>
        <select
          className="select"
          value={preset ? preset.name : '__custom'}
          onChange={(e) => {
            const w = settings.workAreas.find((x) => x.name === e.target.value)
            if (w) setWorkArea(w)
          }}
        >
          {!preset && <option value="__custom">Benutzerdefiniert</option>}
          {settings.workAreas.map((w) => <option key={w.name} value={w.name}>{w.name} ({w.width} × {w.height})</option>)}
        </select>
      </label>
      <div className="grid2">
        <NumberField label="Breite" unit="mm" value={wa.width} min={20} max={2000} digits={0} onCommit={(v) => setWorkArea({ ...wa, name: 'Benutzerdefiniert', width: v })} />
        <NumberField label="Höhe" unit="mm" value={wa.height} min={20} max={5000} digits={0} onCommit={(v) => setWorkArea({ ...wa, name: 'Benutzerdefiniert', height: v })} />
      </div>
      <div className="row">
        <button
          className="btn grow2"
          title="Aktuelle Größe als neue Vorlage speichern"
          onClick={async () => {
            const name = await askText('Als Vorlage speichern', 'Name der Vorlage', `${wa.width} × ${wa.height} mm`)
            if (name) save(name)
          }}
        ><Save size={14} /> Als Vorlage speichern</button>
        <button className="btn" disabled={!preset} onClick={() => preset && del(preset.name)} title={preset ? 'Ausgewählte Vorlage löschen' : 'Keine gespeicherte Vorlage ausgewählt'}><Trash2 size={14} /> Löschen</button>
      </div>
    </Card>
  )
}

export function SelectionPanel(): JSX.Element {
  const parts = useStore((s) => s.parts)
  const selection = useStore((s) => s.selection)
  const wa = useStore((s) => s.settings.activeWorkArea)
  const st = useStore()
  const sel = useMemo(() => selectedParts(parts, selection), [parts, selection])
  const b = useMemo(() => unionBounds(sel), [sel])
  const single = sel.length === 1 ? sel[0] : null
  const out = outOfBoundsUnits(sel, wa).length > 0
  const firstGroup = sel[0]?.groupId
  const isGroup = sel.length >= 2 && !!firstGroup && sel.every((p) => p.groupId === firstGroup)
  const hasGroup = sel.some((p) => p.groupId)
  const canGroup = sel.length >= 2 && !isGroup
  const splitBlocked = isGroup || (single !== null && !!single.groupId)
  return (
    <Card id="selection" title="Auswahl" icon={<Move size={15} />} right={sel.length ? <span className="muted">{single ? single.name : isGroup ? `Gruppe (${sel.length})` : `${sel.length} Teile`}</span> : null}>
      {!b ? (
        <div className="empty-mini">Nichts ausgewählt. Klicke ein Bauteil auf der Arbeitsfläche an.</div>
      ) : (
        <>
          <div className="grid2">
            <NumberField label="X" unit="mm" value={round(b.x)} step={1} onCommit={(v) => st.moveSelectionTo(v, undefined)} />
            <NumberField label="Y" unit="mm" value={round(b.y)} step={1} onCommit={(v) => st.moveSelectionTo(undefined, v)} />
            <NumberField label="Breite" unit="mm" value={round(b.width)} min={0.5} step={1} onCommit={(v) => st.resizeSelection('width', v)} />
            <NumberField label="Höhe" unit="mm" value={round(b.height)} min={0.5} step={1} onCommit={(v) => st.resizeSelection('height', v)} />
            {!single && <NumberField label="Drehen um" unit="°" value={0} step={15} digits={1} onCommit={(v) => { if (v) st.rotateSelectionBy(v) }} />}
            {single && <NumberField label="Drehung" unit="°" value={single.rotation} step={1} digits={1} onCommit={(v) => st.setSelectedRotation(v)} />}
            {single && <NumberField label="Maßstab" unit="%" value={Math.round(single.scale * 1000) / 10} min={1} max={5000} step={5} digits={1} onCommit={(v) => st.setSelectedScalePct(v)} />}
          </div>
          {isGroup && <p className="hint"><Group size={14} />Gruppe aus {sel.length} Teilen – wird als Einheit bewegt, skaliert, gedreht und angeordnet. Doppelklick wählt ein einzelnes Teil der Gruppe.</p>}
          {single?.groupId && <p className="hint"><Group size={14} />Einzelteil einer Gruppe – Klick außerhalb wählt wieder die ganze Gruppe.</p>}
          <p className="hint subtle">Die Größe wird immer proportional geändert.</p>
          {out && <p className="hint danger"><Info size={14} />Ragt über die Arbeitsfläche hinaus.</p>}
          <div className="row">
            <button className="btn" onClick={st.duplicateSelected} title="Duplizieren (Strg+D)"><Copy size={14} /> Duplizieren</button>
            <button className="btn" onClick={() => st.rotateSelectionBy(90)} title="Um 90° im Uhrzeigersinn drehen"><RotateCw size={14} /> 90°</button>
            <button className="btn danger-ghost" onClick={st.deleteSelected} title="Löschen (Entf)"><Trash2 size={14} /> Löschen</button>
          </div>
          <div className="row">
            <button className="btn" disabled={!canGroup} onClick={st.groupSelected} title={canGroup ? 'Auswahl zu einer Gruppe zusammenfassen (Strg+G)' : 'Mindestens zwei nicht gruppierte Teile wählen'}><Group size={14} /> Gruppieren</button>
            <button className="btn" disabled={!hasGroup} onClick={st.ungroupSelected} title={hasGroup ? 'Gruppierung aufheben (Strg+Umschalt+G)' : 'Die Auswahl enthält keine Gruppe'}><Ungroup size={14} /> Aufheben</button>
          </div>
          <div className="row">
            <button
              className="btn"
              disabled={!single || splitBlocked}
              onClick={st.splitSelected}
              title={splitBlocked ? 'Gruppen werden nicht zerlegt – zuerst die Gruppierung aufheben (Strg+Umschalt+G)' : single ? 'Das Bauteil in zusammengehörige Einzelteile zerlegen (Anordnung bleibt erhalten, danach mit Strg+G wieder gruppierbar, Strg+Z macht es rückgängig)' : 'Nur möglich, wenn genau ein Bauteil gewählt ist'}
            ><Split size={14} /> In Einzelteile zerlegen</button>
          </div>
          <div className="row">
            <button
              className="btn"
              disabled={!single}
              onClick={st.weldSelected}
              title={single ? 'Entfernt Linien innerhalb von Buchstaben, die durch überlappende Formen entstehen. Löcher wie im P bleiben.' : 'Nur möglich, wenn genau ein Bauteil gewählt ist'}
            ><Merge size={14} /> Konturen vereinen (Weld)</button>
          </div>
        </>
      )}
    </Card>
  )
}
const round = (n: number): number => Math.round(n * 100) / 100

export function AlignPanel(): JSX.Element {
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
  const canAlign = target === 'workarea' ? units >= 1 : units >= 2
  const reason = target === 'workarea' ? 'Zuerst ein Bauteil auswählen' : 'Mindestens 2 Bauteile auswählen (oder auf „Arbeitsfläche“ umschalten)'
  const al = (mode: Parameters<typeof alignParts>[1]) => (): void => replace(alignParts(sel, mode, target, wa))
  const btn = (mode: Parameters<typeof alignParts>[1], label: string, icon: JSX.Element): JSX.Element => (
    <button className="icon-btn boxed" disabled={!canAlign} onClick={al(mode)} title={canAlign ? label : `${label} – ${reason}`}>{icon}</button>
  )
  return (
    <Card id="align" title="Ausrichten" icon={<AlignStartVertical size={15} />}>
      <div className="seg" role="group" aria-label="Ausrichten an">
        <button className={target === 'selection' ? 'on' : ''} onClick={() => setTarget('selection')} title="Teile aneinander ausrichten">An Auswahl</button>
        <button className={target === 'workarea' ? 'on' : ''} onClick={() => setTarget('workarea')} title="Teile an der Arbeitsfläche ausrichten">An Arbeitsfläche</button>
      </div>
      <div className="align-grid">
        {btn('left', 'Links ausrichten', <AlignStartVertical size={17} />)}
        {btn('hcenter', 'Horizontal zentrieren', <AlignCenterVertical size={17} />)}
        {btn('right', 'Rechts ausrichten', <AlignEndVertical size={17} />)}
        <span className="align-sep" />
        {btn('top', 'Oben ausrichten', <AlignStartHorizontal size={17} />)}
        {btn('vcenter', 'Vertikal zentrieren', <AlignCenterHorizontal size={17} />)}
        {btn('bottom', 'Unten ausrichten', <AlignEndHorizontal size={17} />)}
      </div>
      <div className="row">
        <button className="btn" disabled={units < 3} onClick={() => replace(distributeParts(sel, 'h'))} title={units < 3 ? 'Mindestens 3 Bauteile auswählen' : 'Gleichmäßig horizontal verteilen'}><AlignHorizontalDistributeCenter size={14} /> Verteilen H</button>
        <button className="btn" disabled={units < 3} onClick={() => replace(distributeParts(sel, 'v'))} title={units < 3 ? 'Mindestens 3 Bauteile auswählen' : 'Gleichmäßig vertikal verteilen'}><AlignVerticalDistributeCenter size={14} /> Verteilen V</button>
      </div>
      <div className="row col">
        <button
          className="btn" disabled={!parts.length}
          title={parts.length ? 'Alle Bauteile platzsparend anordnen (Gruppen bleiben als Einheit zusammen)' : 'Keine Bauteile vorhanden'}
          onClick={() => {
            replace(autoArrange(parts, wa))
            const loose = new Map<string, number>()
            for (const p of parts) if (!p.groupId) loose.set(p.sourcePath, (loose.get(p.sourcePath) ?? 0) + 1)
            const scattered = [...loose.values()].some((n) => n > 1)
            toast('success', scattered ? 'Angeordnet – zusammengehörige Teile vorher mit Strg+G gruppieren, damit sie zusammenbleiben' : 'Bauteile angeordnet')
          }}
        ><LayoutGrid size={14} /> Automatisch anordnen</button>
        <button className="btn" disabled={!parts.length} onClick={centerAll} title="Alle Bauteile als Gruppe auf der Arbeitsfläche zentrieren"><Wand2 size={14} /> Alles zentrieren</button>
      </div>
    </Card>
  )
}

const MATERIALS: { name: string; cut: { blade: number; force: number; speed: number; passes: number; overcut: number } }[] = [
  { name: 'Papier 80g', cut: { blade: 1, force: 8, speed: 8, passes: 1, overcut: 0 } },
  { name: 'Karton', cut: { blade: 4, force: 25, speed: 3, passes: 1, overcut: 0.5 } },
  { name: 'Vinyl', cut: { blade: 2, force: 10, speed: 5, passes: 1, overcut: 0.5 } },
  { name: 'Flexfolie', cut: { blade: 1, force: 14, speed: 4, passes: 1, overcut: 0 } },
  { name: 'Stoff/Filz', cut: { blade: 6, force: 30, speed: 2, passes: 2, overcut: 0 } }
]

function SliderField({ label, value, min, max, step = 1, unit, digits = 0, onChange, title }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; digits?: number; onChange: (v: number) => void; title?: string
}): JSX.Element {
  return (
    <div className="slider-row" title={title}>
      <span className="field-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))} onChange={(e) => onChange(Number(e.target.value))} />
      <NumberField value={value} min={min} max={max} step={step} digits={digits} unit={unit} onCommit={onChange} />
    </div>
  )
}

export function CutPanel(): JSX.Element {
  const cut = useStore((s) => s.settings.cut)
  const setCut = useStore((s) => s.setCut)
  const active = MATERIALS.find((m) => (Object.keys(m.cut) as (keyof typeof m.cut)[]).every((k) => m.cut[k] === cut[k]))
  return (
    <Card id="cut" title="Schnitteinstellungen" icon={<Scissors size={15} />}>
      <div className="chips">
        {MATERIALS.map((m) => (
          <button key={m.name} className={'chip' + (active === m ? ' on' : '')} onClick={() => setCut(m.cut)} title={`Richtwerte für ${m.name} setzen – bitte mit einem Probeschnitt prüfen`}>{m.name}</button>
        ))}
        <span className={'chip static' + (!active ? ' on' : '')} title="Eigene Werte: einfach unten anpassen – wird automatisch markiert">Eigene</span>
      </div>
      <SliderField label="Klinge" value={cut.blade} min={1} max={10} onChange={(v) => setCut({ blade: v })} title="Klingenüberstand (1–10)" />
      <SliderField label="Druck" value={cut.force} min={1} max={33} onChange={(v) => setCut({ force: v })} title="Anpressdruck (1–33)" />
      <SliderField label="Tempo" value={cut.speed} min={1} max={10} onChange={(v) => setCut({ speed: v })} title="Geschwindigkeit (1–10)" />
      <SliderField label="Durchgänge" value={cut.passes} min={1} max={5} onChange={(v) => setCut({ passes: v })} title="Wie oft jeder Pfad geschnitten wird (1–5)" />
      <SliderField label="Überschnitt" value={cut.overcut} min={0} max={5} step={0.1} digits={1} unit="mm" onChange={(v) => setCut({ overcut: Math.round(v * 10) / 10 })} title="Geschlossene Pfade werden um diese Strecke überschnitten (0 = aus)" />
    </Card>
  )
}

export function useCutBlocker(): string | null {
  const parts = useStore((s) => s.parts)
  const wa = useStore((s) => s.settings.activeWorkArea)
  const connectedId = useStore((s) => s.connectedId)
  const status = useStore((s) => s.deviceStatus)
  return useMemo(() => {
    if (!parts.length) return 'Füge zuerst Bauteile zur Arbeitsfläche hinzu.'
    if (!connectedId || status === 'disconnected') return 'Verbinde zuerst einen Plotter (oder den Simulator) im Panel „Plotter“.'
    if (status === 'busy') return 'Der Plotter ist gerade beschäftigt.'
    if (status === 'no-media') return 'Im Plotter ist kein Material eingelegt.'
    if (status === 'error') return 'Der Plotter meldet einen Fehler.'
    const n = outOfBoundsUnits(parts, wa).length
    if (n) return `${n} ${n === 1 ? 'Bauteil liegt' : 'Bauteile liegen'} außerhalb der Arbeitsfläche (rot markiert).`
    return null
  }, [parts, wa, connectedId, status])
}

export function CutButton(): JSX.Element {
  const blocker = useCutBlocker()
  const setOpen = useStore((s) => s.setCutOpen)
  return (
    <div className="cut-bar">
      {blocker && <p className="cut-reason"><Info size={13} />{blocker}</p>}
      <button className="btn-cut" disabled={!!blocker} onClick={() => setOpen(true)} title={blocker ?? 'Schnitt vorbereiten und starten'}>
        <Scissors size={20} /> Schneiden starten
      </button>
    </div>
  )
}

export function RightColumn(): JSX.Element {
  return (
    <aside className="right">
      <div className="right-scroll">
        <PlotterPanel />
        <WorkAreaPanel />
        <SelectionPanel />
        <AlignPanel />
        <CutPanel />
      </div>
      <CutButton />
    </aside>
  )
}
