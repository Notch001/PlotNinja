import { useMemo } from 'react'
import {
  Copy, Cpu, FlipHorizontal2, FlipVertical2, Group, Lock, LockOpen, Pencil, Plus, Split, Move, Plug, PlugZap,
  Merge, RefreshCw, Ruler, Save, Scissors, Trash2, Ungroup, Info, Usb, FlaskConical
} from 'lucide-react'
import type { DeviceStatus } from '@shared/types'
import { BUILTIN_MATERIALS, findMatchingProfile, outOfBoundsUnits, partScale, partSize } from '../core'
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
  const lock = useStore((s) => s.lockAspect)
  const sc = single ? partScale(single) : { x: 1, y: 1 }
  // Einzelteil: Maße im Teilsystem (vor der Drehung, = Bounding-Box bei 0°); sonst Bounding-Box der Auswahl
  const sz = single ? partSize(single) : null
  const dims = sz && b ? { w: sz.w, h: sz.h } : { w: b?.width ?? 0, h: b?.height ?? 0 }
  // Mehrere lose Teile derselben Datei (z. B. nach „In Einzelteile zerlegen“): Gruppieren hervorheben
  const looseSiblings = canGroup && sel.every((p) => !p.groupId) && sel.every((p) => p.sourcePath === sel[0].sourcePath)
  return (
    <Card id="selection" title="Auswahl" icon={<Move size={15} />} right={sel.length ? <span className="muted">{single ? single.name : isGroup ? `Gruppe (${sel.length})` : `${sel.length} Teile`}</span> : null}>
      {!b ? (
        <div className="empty-mini">Nichts ausgewählt. Klicke ein Bauteil auf der Arbeitsfläche an.</div>
      ) : (
        <>
          <div className="grid2">
            <NumberField label="X" unit="mm" value={round(b.x)} step={1} onCommit={(v) => st.moveSelectionTo(v, undefined)} />
            <NumberField label="Y" unit="mm" value={round(b.y)} step={1} onCommit={(v) => st.moveSelectionTo(undefined, v)} />
            <NumberField label="Breite" unit="mm" value={round(dims.w)} min={0.5} step={1} onCommit={(v) => st.resizeSelection('width', v)} title={single && single.rotation !== 0 ? 'Breite des Teils vor der Drehung' : undefined} />
            <NumberField label="Höhe" unit="mm" value={round(dims.h)} min={0.5} step={1} onCommit={(v) => st.resizeSelection('height', v)} title={single && single.rotation !== 0 ? 'Höhe des Teils vor der Drehung' : undefined} />
            {!single && <NumberField label="Drehen um" unit="°" value={0} step={15} digits={1} onCommit={(v) => { if (v) st.rotateSelectionBy(v) }} />}
            {single && <NumberField label="Drehung" unit="°" value={single.rotation} step={1} digits={1} onCommit={(v) => st.setSelectedRotation(v)} />}
            {single && lock && <NumberField label="Maßstab" unit="%" value={Math.round(sc.x * 1000) / 10} min={1} max={5000} step={5} digits={1} onCommit={(v) => st.setSelectedScalePct(v)} />}
            {single && !lock && <NumberField label="Skala B" unit="%" value={Math.round(sc.x * 1000) / 10} min={1} max={5000} step={5} digits={1} onCommit={(v) => st.setSelectedScaleAxisPct('x', v)} title="Maßstab der Breite" />}
            {single && !lock && <NumberField label="Skala H" unit="%" value={Math.round(sc.y * 1000) / 10} min={1} max={5000} step={5} digits={1} onCommit={(v) => st.setSelectedScaleAxisPct('y', v)} title="Maßstab der Höhe" />}
          </div>
          <div className="row">
            <button
              className={'btn lock-btn' + (lock ? '' : ' on')} onClick={() => st.setLockAspect(!lock)} aria-pressed={lock} data-testid="lock-aspect"
              title={lock ? 'Seitenverhältnis gesperrt: Größe ändert sich proportional. Klicken zum Entsperren (freies Skalieren von Breite und Höhe).' : 'Seitenverhältnis entsperrt: Breite und Höhe lassen sich unabhängig ändern. Klicken zum Sperren.'}
            >{lock ? <Lock size={14} /> : <LockOpen size={14} />} {lock ? 'Seitenverhältnis gesperrt' : 'Seitenverhältnis frei'}</button>
          </div>
          {isGroup && <p className="hint"><Group size={14} />Gruppe aus {sel.length} Teilen – wird als Einheit bewegt, skaliert, gedreht und angeordnet. Doppelklick wählt ein einzelnes Teil der Gruppe.</p>}
          {single?.groupId && <p className="hint"><Group size={14} />Einzelteil einer Gruppe – Klick außerhalb wählt wieder die ganze Gruppe.</p>}
          {single
            ? <p className="hint subtle">{lock ? 'Die Größe wird proportional geändert. Mit Alt beim Ziehen an einer Kante lässt sich frei skalieren.' : 'Breite und Höhe sind unabhängig; Ecken-Griffe skalieren weiter proportional (mit Alt frei).'}{single.rotation !== 0 ? ' Ungleiches Skalieren wirkt vor der Drehung (keine Scherung).' : ''}</p>
            : <p className="hint subtle">Gruppen und Mehrfachauswahl werden immer proportional skaliert.</p>}
          {out && <p className="hint danger"><Info size={14} />Ragt über die Arbeitsfläche hinaus.</p>}
          <div className="row">
            <button className="btn" onClick={() => st.flipSelection('h')} title="Horizontal spiegeln (links/rechts, Umschalt+H) – bei Gruppen um die Gruppenmitte, die Anordnung spiegelt mit" data-testid="sel-flip-h"><FlipHorizontal2 size={14} /> Horizontal spiegeln</button>
            <button className="btn" onClick={() => st.flipSelection('v')} title="Vertikal spiegeln (oben/unten, Umschalt+V)" data-testid="sel-flip-v"><FlipVertical2 size={14} /> Vertikal spiegeln</button>
          </div>
          {looseSiblings && <p className="hint"><Group size={14} />Diese Teile stammen aus derselben Datei. Mit „Gruppieren“ (Strg+G) bleiben sie beim Verschieben und Anordnen zusammen.</p>}
          <div className="row">
            <button className="btn" onClick={st.duplicateSelected} title="Duplizieren (Strg+D)"><Copy size={14} /> Duplizieren</button>
            <button className="btn danger-ghost" onClick={st.deleteSelected} title="Löschen (Entf)"><Trash2 size={14} /> Löschen</button>
          </div>
          <div className="row">
            <button className={'btn' + (looseSiblings ? ' primary' : '')} disabled={!canGroup} onClick={st.groupSelected} data-testid="group-btn" title={canGroup ? 'Auswahl zu einer Gruppe zusammenfassen (Strg+G)' : 'Mindestens zwei nicht gruppierte Teile wählen'}><Group size={14} /> Gruppieren</button>
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
  const device = useStore((s) => s.devices.find((d) => d.id === s.connectedId))
  const openTestCut = useStore((s) => s.openTestCut)
  const testBlocker = useTestCutBlocker()
  const autoBlade = device?.autoBlade
  const profiles = useStore((s) => s.settings.materialProfiles) ?? []
  const saveProfile = useStore((s) => s.saveMaterialProfile)
  const renameProfile = useStore((s) => s.renameMaterialProfile)
  const deleteProfile = useStore((s) => s.deleteMaterialProfile)
  const match = findMatchingProfile(cut, profiles)
  const activeCustom = match && !match.builtin ? match.profile : null
  const active = match?.profile ?? null
  return (
    <Card id="cut" title="Schnitteinstellungen" icon={<Scissors size={15} />}>
      <div className="chips">
        {BUILTIN_MATERIALS.map((m) => (
          <button key={m.name} className={'chip' + (active === m ? ' on' : '')} onClick={() => setCut(m.cut)} title={`Richtwerte für ${m.name} setzen – bitte mit einem Probeschnitt prüfen`}>{m.name}</button>
        ))}
        {profiles.map((m) => (
          <button key={'p:' + m.name} className={'chip custom' + (active === m ? ' on' : '')} onClick={() => setCut(m.cut)} data-testid="profile-chip" title={`Eigenes Profil „${m.name}“: Klinge ${m.cut.blade}, Druck ${m.cut.force}, Tempo ${m.cut.speed}, ${m.cut.passes} Durchgang/-gänge, Überschnitt ${m.cut.overcut} mm`}>{m.name}</button>
        ))}
        {!active && <span className="chip static on" title="Eigene Werte: einfach unten anpassen – mit „Als Profil speichern“ dauerhaft sichern">Eigene Werte</span>}
      </div>
      <div className="row profile-row">
        <button className="btn small grow2" onClick={() => void saveProfile()} data-testid="save-profile" title="Die aktuellen Werte (Klinge, Druck, Tempo, Durchgänge, Überschnitt) als eigenes Materialprofil speichern"><Plus size={13} /> Als Profil speichern</button>
        {activeCustom && <>
          <button className="icon-btn boxed" onClick={() => void renameProfile(activeCustom.name)} title={`Profil „${activeCustom.name}“ umbenennen`}><Pencil size={14} /></button>
          <button className="icon-btn boxed" onClick={() => void deleteProfile(activeCustom.name)} title={`Profil „${activeCustom.name}“ löschen`}><Trash2 size={14} /></button>
        </>}
      </div>
      <SliderField
        label={autoBlade === true ? 'Klingentiefe' : 'Klinge'} value={cut.blade} min={1} max={10} onChange={(v) => setCut({ blade: v })}
        title={autoBlade === true ? 'Der Cameo stellt die Klinge selbst ein' : autoBlade === false ? 'Bitte am Messer von Hand einstellen (wird nicht an den Plotter gesendet)' : 'Klingentiefe (1–10): bei Modellen mit AutoBlade automatisch, sonst am Messer von Hand einstellen'}
      />
      {autoBlade === true && (
        <p className="hint subtle blade-note" data-testid="blade-note" title="Der Cameo stellt die Klinge selbst ein"><Info size={12} />Klingentiefe (automatisch eingestellt)</p>
      )}
      {autoBlade === false && (
        <p className="hint subtle blade-note" data-testid="blade-note"><Info size={12} />Klinge – bitte am Messer manuell einstellen auf Stufe {cut.blade}</p>
      )}
      <SliderField label="Druck" value={cut.force} min={1} max={33} onChange={(v) => setCut({ force: v })} title="Anpressdruck (1–33)" />
      <SliderField label="Tempo" value={cut.speed} min={1} max={10} onChange={(v) => setCut({ speed: v })} title="Geschwindigkeit (1–10)" />
      <SliderField label="Durchgänge" value={cut.passes} min={1} max={5} onChange={(v) => setCut({ passes: v })} title="Wie oft jeder Pfad geschnitten wird (1–5)" />
      <SliderField label="Überschnitt" value={cut.overcut} min={0} max={5} step={0.1} digits={1} unit="mm" onChange={(v) => setCut({ overcut: Math.round(v * 10) / 10 })} title="Geschlossene Pfade werden um diese Strecke überschnitten (0 = aus)" />
      <button className="btn small test-cut" disabled={!!testBlocker} onClick={openTestCut} title={testBlocker ?? 'Schneidet ein kleines Muster (Quadrat, Dreieck, Kreis) mit diesen Einstellungen, um Druck und Klinge zu prüfen – ohne dein Projekt'}>
        <FlaskConical size={13} /> Testschnitt
      </button>
    </Card>
  )
}

/** Testschnitt braucht nur ein bereites Gerät, keine Bauteile. */
export function useTestCutBlocker(): string | null {
  const connectedId = useStore((s) => s.connectedId)
  const status = useStore((s) => s.deviceStatus)
  if (!connectedId || status === 'disconnected') return 'Verbinde zuerst einen Plotter (oder den Simulator) im Panel „Plotter“.'
  if (status === 'busy') return 'Der Plotter ist gerade beschäftigt.'
  if (status === 'no-media') return 'Im Plotter ist kein Material eingelegt.'
  if (status === 'error') return 'Der Plotter meldet einen Fehler.'
  return null
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
        <CutPanel />
      </div>
      <CutButton />
    </aside>
  )
}
