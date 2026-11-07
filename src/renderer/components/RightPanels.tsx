import { useMemo } from 'react'
import {
  Copy, CopyPlus, Cpu, FlipHorizontal2, FlipVertical2, Group, Lock, LockOpen, Pencil, Plus, Split, Move, Plug, PlugZap,
  Merge, RefreshCw, SquareDashed, ArrowDownToLine, Ruler, Save, Scissors, Trash2, Ungroup, Info, Usb, FlaskConical, Undo2
} from 'lucide-react'
import type { DeviceStatus } from '@shared/types'
import { BORDER_MAX_MM, BORDER_MIN_MM, DEFAULT_AFTER_CUT, MAX_EJECT_MM } from '@shared/types'
import { BUILTIN_MATERIALS, hasBorder, sanitizeBorder, outOfBoundsUnits, resolveActiveProfile, partScale, partSize, materialLabel, workAreaLabel } from '../core'
import type { MessageKey } from '@shared/i18n'
import { useT } from '../lib/useT'
import { useStore, selectedParts } from '../store'
import { Card } from './Card'
import { NumberField } from './NumberField'
import { StickerSection } from './StickerSection'
import { unionBounds } from '../lib/transform'

const STATUS_KEY: Record<DeviceStatus, MessageKey> = {
  disconnected: 'rightPanel.plotter.status.disconnected', ready: 'rightPanel.plotter.status.ready', busy: 'rightPanel.plotter.status.busy',
  'no-media': 'rightPanel.plotter.status.noMedia', error: 'rightPanel.plotter.status.error'
}

export function PlotterPanel(): JSX.Element {
  const t = useT()
  const { devices, devicesLoading, selectedDeviceId, connectedId, deviceStatus } = useStore()
  const refresh = useStore((s) => s.refreshDevices)
  const selectDevice = useStore((s) => s.selectDevice)
  const connect = useStore((s) => s.connect)
  const disconnect = useStore((s) => s.disconnect)
  const connected = connectedId !== null && deviceStatus !== 'disconnected'
  const ejecting = useStore((s) => s.ejecting)
  const ejectMedia = useStore((s) => s.ejectMedia)
  const ejectMm = useStore((s) => (s.settings.afterCut ?? DEFAULT_AFTER_CUT).ejectExtraMm)
  const doEject = (): void => {
    if (window.confirm(t('rightPanel.plotter.ejectConfirm', { mm: ejectMm }))) void ejectMedia()
  }
  const hasUsb = devices.some((d) => d.kind === 'usb')
  return (
    <Card
      id="plotter" title={t('rightPanel.plotter.title')} icon={<Cpu size={15} />}
      right={<span className={'pill ' + deviceStatus}><i />{t(STATUS_KEY[deviceStatus])}</span>}
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
            {connectedId === d.id && <span className="device-tag">{t('rightPanel.plotter.connectedTag')}</span>}
          </button>
        ))}
        {!devices.length && <div className="empty-mini">{devicesLoading ? t('rightPanel.plotter.searching') : t('rightPanel.plotter.noDevices')}</div>}
      </div>
      {!hasUsb && !devicesLoading && (
        <p className="hint"><Info size={14} />{withBold(t('rightPanel.plotter.noPlotterHint', { simulator: BOLD_MARK }), t('rightPanel.plotter.simulatorWord'))}</p>
      )}
      <div className="row">
        <button className="btn" onClick={() => void refresh()} disabled={devicesLoading || connected} title={t('rightPanel.plotter.refreshTooltip')}>
          <RefreshCw size={14} className={devicesLoading ? 'spin' : ''} /> {t('rightPanel.plotter.refresh')}
        </button>
        {connected ? (
          <button className="btn" onClick={() => void disconnect()} disabled={deviceStatus === 'busy'} title={t('rightPanel.plotter.disconnectTooltip')}><Plug size={14} /> {t('rightPanel.plotter.disconnect')}</button>
        ) : (
          <button className="btn primary" onClick={() => void connect()} disabled={!selectedDeviceId} title={selectedDeviceId ? t('rightPanel.plotter.connectTooltip') : t('rightPanel.plotter.connectTooltipNone')}><PlugZap size={14} /> {t('rightPanel.plotter.connect')}</button>
        )}
      </div>
      {deviceStatus === 'no-media' && <p className="hint warn"><Info size={14} />{t('rightPanel.plotter.noMediaHint')}</p>}
      {connected && (
        <div className="eject-box" data-testid="eject-box">
          <EjectDistance />
          <button
            className="btn" onClick={doEject} disabled={deviceStatus !== 'ready' || ejecting} data-testid="eject-btn"
            title={deviceStatus === 'ready' ? t('rightPanel.plotter.ejectTooltip') : t('rightPanel.plotter.ejectTooltipNotReady')}
          ><ArrowDownToLine size={14} /> {ejecting ? t('rightPanel.plotter.ejecting') : t('rightPanel.plotter.eject')}</button>
          <p className="hint subtle"><Info size={12} />{t('rightPanel.plotter.ejectNote')}</p>
        </div>
      )}
    </Card>
  )
}

export function WorkAreaPanel(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const setWorkArea = useStore((s) => s.setWorkArea)
  const askText = useStore((s) => s.askText)
  const save = useStore((s) => s.saveWorkAreaPreset)
  const del = useStore((s) => s.deleteWorkAreaPreset)
  const wa = settings.activeWorkArea
  const preset = settings.workAreas.find((w) => w.name === wa.name && w.width === wa.width && w.height === wa.height)
  return (
    <Card id="workarea" title={t('rightPanel.workArea.title')} icon={<Ruler size={15} />}>
      <label className="field stacked">
        <span className="field-label">{t('rightPanel.workArea.template')}</span>
        <select
          className="select"
          value={preset ? preset.name : '__custom'}
          onChange={(e) => {
            const w = settings.workAreas.find((x) => x.name === e.target.value)
            if (w) setWorkArea(w)
          }}
        >
          {!preset && <option value="__custom">{t('rightPanel.workArea.custom')}</option>}
          {settings.workAreas.map((w) => <option key={w.name} value={w.name}>{workAreaLabel(w)} ({w.width} × {w.height})</option>)}
        </select>
      </label>
      <div className="grid2">
        <NumberField label={t('rightPanel.workArea.width')} unit="mm" value={wa.width} min={20} max={2000} digits={0} onCommit={(v) => setWorkArea({ ...wa, name: 'Benutzerdefiniert', width: v })} />
        <NumberField label={t('rightPanel.workArea.height')} unit="mm" value={wa.height} min={20} max={5000} digits={0} onCommit={(v) => setWorkArea({ ...wa, name: 'Benutzerdefiniert', height: v })} />
      </div>
      <div className="row">
        <button
          className="btn grow2"
          title={t('rightPanel.workArea.saveTooltip')}
          onClick={async () => {
            const name = await askText(t('rightPanel.workArea.savePromptTitle'), t('rightPanel.workArea.savePromptLabel'), `${wa.width} × ${wa.height} mm`)
            if (name) save(name)
          }}
        ><Save size={14} /> {t('rightPanel.workArea.save')}</button>
        <button className="btn" disabled={!preset} onClick={() => preset && del(preset.name)} title={preset ? t('rightPanel.workArea.deleteTooltip') : t('rightPanel.workArea.deleteTooltipNone')}><Trash2 size={14} /> {t('rightPanel.workArea.delete')}</button>
      </div>
    </Card>
  )
}

export function SelectionPanel(): JSX.Element {
  const t = useT()
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
    <Card id="selection" title={t('rightPanel.selection.title')} icon={<Move size={15} />} right={sel.length ? <span className="muted">{single ? single.name : isGroup ? t('rightPanel.selection.badgeGroup', { n: sel.length }) : t('rightPanel.selection.badgeParts', { n: sel.length })}</span> : null}>
      {!b ? (
        <div className="empty-mini">{t('rightPanel.selection.empty')}</div>
      ) : (
        <>
          <div className="grid2">
            <NumberField label="X" unit="mm" value={round(b.x)} step={1} onCommit={(v) => st.moveSelectionTo(v, undefined)} />
            <NumberField label="Y" unit="mm" value={round(b.y)} step={1} onCommit={(v) => st.moveSelectionTo(undefined, v)} />
            <NumberField label={t('rightPanel.selection.width')} unit="mm" value={round(dims.w)} min={0.5} step={1} onCommit={(v) => st.resizeSelection('width', v)} title={single && single.rotation !== 0 ? t('rightPanel.selection.widthTooltip') : undefined} />
            <NumberField label={t('rightPanel.selection.height')} unit="mm" value={round(dims.h)} min={0.5} step={1} onCommit={(v) => st.resizeSelection('height', v)} title={single && single.rotation !== 0 ? t('rightPanel.selection.heightTooltip') : undefined} />
            {!single && <NumberField label={t('rightPanel.selection.rotateBy')} unit="°" value={0} step={15} digits={1} onCommit={(v) => { if (v) st.rotateSelectionBy(v) }} />}
            {single && <NumberField label={t('rightPanel.selection.rotation')} unit="°" value={single.rotation} step={1} digits={1} onCommit={(v) => st.setSelectedRotation(v)} />}
            {single && lock && <NumberField label={t('rightPanel.selection.scale')} unit="%" value={Math.round(sc.x * 1000) / 10} min={1} max={5000} step={5} digits={1} onCommit={(v) => st.setSelectedScalePct(v)} />}
            {single && !lock && <NumberField label={t('rightPanel.selection.scaleW')} unit="%" value={Math.round(sc.x * 1000) / 10} min={1} max={5000} step={5} digits={1} onCommit={(v) => st.setSelectedScaleAxisPct('x', v)} title={t('rightPanel.selection.scaleWTooltip')} />}
            {single && !lock && <NumberField label={t('rightPanel.selection.scaleH')} unit="%" value={Math.round(sc.y * 1000) / 10} min={1} max={5000} step={5} digits={1} onCommit={(v) => st.setSelectedScaleAxisPct('y', v)} title={t('rightPanel.selection.scaleHTooltip')} />}
          </div>
          <div className="row">
            <button
              className={'btn lock-btn' + (lock ? '' : ' on')} onClick={() => st.setLockAspect(!lock)} aria-pressed={lock} data-testid="lock-aspect"
              title={lock ? t('rightPanel.selection.lockTooltipLocked') : t('rightPanel.selection.lockTooltipFree')}
            >{lock ? <Lock size={14} /> : <LockOpen size={14} />} {lock ? t('rightPanel.selection.lockLocked') : t('rightPanel.selection.lockFree')}</button>
          </div>
          {isGroup && <p className="hint"><Group size={14} />{t('rightPanel.selection.hintGroup', { n: sel.length })}</p>}
          {single?.groupId && <p className="hint"><Group size={14} />{t('rightPanel.selection.hintGroupMember')}</p>}
          {single
            ? <p className="hint subtle">{lock ? t('rightPanel.selection.hintScaleLocked') : t('rightPanel.selection.hintScaleFree')}{single.rotation !== 0 ? ' ' + t('rightPanel.selection.hintRotated') : ''}</p>
            : <p className="hint subtle">{t('rightPanel.selection.hintMulti')}</p>}
          {out && <p className="hint danger"><Info size={14} />{t('rightPanel.selection.hintOutOfBounds')}</p>}
          <div className="row">
            <button className="btn" onClick={() => st.flipSelection('h')} title={t('rightPanel.selection.flipHTooltip')} data-testid="sel-flip-h"><FlipHorizontal2 size={14} /> {t('rightPanel.selection.flipH')}</button>
            <button className="btn" onClick={() => st.flipSelection('v')} title={t('rightPanel.selection.flipVTooltip')} data-testid="sel-flip-v"><FlipVertical2 size={14} /> {t('rightPanel.selection.flipV')}</button>
          </div>
          {looseSiblings && <p className="hint"><Group size={14} />{t('rightPanel.selection.hintLooseSiblings')}</p>}
          <div className="row">
            <button className="btn" onClick={st.duplicateSelected} title={t('rightPanel.selection.duplicateTooltip')}><Copy size={14} /> {t('rightPanel.selection.duplicate')}</button>
            <button className="btn" onClick={() => st.setNestOpen('multi')} data-testid="sel-multi" title={t('rightPanel.selection.multiTooltip')}><CopyPlus size={14} /> {t('rightPanel.selection.multi')}</button>
            <button className="btn danger-ghost" onClick={st.deleteSelected} title={t('rightPanel.selection.deleteTooltip')}><Trash2 size={14} /> {t('rightPanel.selection.delete')}</button>
          </div>
          <div className="row">
            <button className={'btn' + (looseSiblings ? ' primary' : '')} disabled={!canGroup} onClick={st.groupSelected} data-testid="group-btn" title={canGroup ? t('rightPanel.selection.groupTooltip') : t('rightPanel.selection.groupTooltipNeed')}><Group size={14} /> {t('rightPanel.selection.group')}</button>
            <button className="btn" disabled={!hasGroup} onClick={st.ungroupSelected} title={hasGroup ? t('rightPanel.selection.ungroupTooltip') : t('rightPanel.selection.ungroupTooltipNone')}><Ungroup size={14} /> {t('rightPanel.selection.ungroup')}</button>
          </div>
          <div className="row">
            <button
              className="btn"
              disabled={!single || splitBlocked}
              onClick={st.splitSelected}
              title={splitBlocked ? t('rightPanel.selection.splitTooltipBlocked') : single ? t('rightPanel.selection.splitTooltip') : t('rightPanel.selection.needSingle')}
            ><Split size={14} /> {t('rightPanel.selection.split')}</button>
          </div>
          <div className="row">
            <button
              className="btn"
              disabled={!single}
              onClick={st.weldSelected}
              title={single ? t('rightPanel.selection.weldTooltip') : t('rightPanel.selection.needSingle')}
            ><Merge size={14} /> {t('rightPanel.selection.weld')}</button>
          </div>
          <BorderSection />
          <StickerSection />
        </>
      )}
    </Card>
  )
}
const BOLD_MARK = '\u0000'
/** Setzt `bold` an die Stelle des Platzhalters (BOLD_MARK) im übersetzten Satz fett ein. */
function withBold(text: string, bold: string): JSX.Element {
  const [a, b = ''] = text.split(BOLD_MARK)
  return <>{a}<b>{bold}</b>{b}</>
}
const round = (n: number): number => Math.round(n * 100) / 100

/** Abschnitt „Schnittrand“ in der Karte „Auswahl“: Einstellungen (persistiert) und Hinzufügen/Ersetzen/Entfernen. */
function BorderSection(): JSX.Element {
  const t = useT()
  const parts = useStore((s) => s.parts)
  const selection = useStore((s) => s.selection)
  const raw = useStore((s) => s.settings.borderDefaults)
  const set = useStore((s) => s.setBorderDefaults)
  const add = useStore((s) => s.addBorder)
  const remove = useStore((s) => s.removeBorder)
  const bd = sanitizeBorder(raw)
  const has = useMemo(() => hasBorder(parts, selection), [parts, selection])
  return (
    <div className="border-box" data-testid="border-section">
      <div className="sub-head"><SquareDashed size={14} /> {t('rightPanel.border.title')}</div>
      <div className="seg" role="group" aria-label={t('rightPanel.border.kindAria')}>
        <button className={bd.mode === 'rect' ? 'on' : ''} aria-pressed={bd.mode === 'rect'} onClick={() => set({ mode: 'rect' })} data-testid="border-rect" title={t('rightPanel.border.rectTooltip')}>{t('rightPanel.border.rect')}</button>
        <button className={bd.mode === 'offset' ? 'on' : ''} aria-pressed={bd.mode === 'offset'} onClick={() => set({ mode: 'offset' })} data-testid="border-offset" title={t('rightPanel.border.offsetTooltip')}>{t('rightPanel.border.offset')}</button>
      </div>
      <NumberField label={t('rightPanel.border.distance')} unit="mm" value={bd.offsetMm} min={BORDER_MIN_MM} max={BORDER_MAX_MM} step={0.5} digits={1} onCommit={(v) => set({ offsetMm: v })} title={t('rightPanel.border.distanceTooltip')} />
      {bd.mode === 'rect' && (
        <div className="border-round">
          <label className="check" title={t('rightPanel.border.roundedTooltip')}>
            <input type="checkbox" checked={bd.rounded} onChange={(e) => set({ rounded: e.target.checked })} data-testid="border-rounded" /> {t('rightPanel.border.rounded')}
          </label>
          {bd.rounded && <NumberField label={t('rightPanel.border.radius')} unit="mm" value={bd.cornerRadiusMm} min={BORDER_MIN_MM} max={BORDER_MAX_MM} step={0.5} digits={1} onCommit={(v) => set({ cornerRadiusMm: v })} />}
        </div>
      )}
      <div className="row">
        <button className="btn primary" onClick={add} data-testid="border-add" title={has ? t('rightPanel.border.replaceTooltip') : t('rightPanel.border.addTooltip')}><SquareDashed size={14} /> {has ? t('rightPanel.border.replace') : t('rightPanel.border.add')}</button>
        <button className="btn" onClick={remove} disabled={!has} data-testid="border-remove" title={has ? t('rightPanel.border.removeTooltip') : t('rightPanel.border.removeTooltipNone')}><Trash2 size={14} /> {t('rightPanel.border.remove')}</button>
      </div>
      <p className="hint subtle"><Info size={12} />{t('rightPanel.border.note')}</p>
    </div>
  )
}

export function SliderField({ label, value, min, max, step = 1, unit, digits = 0, onChange, title }: {
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

/** Zusätzlicher Vorschub hinter dem Design (Einstellung `ejectExtraMm`) mit Slider, Zahlenfeld und Zurücksetzen. */
export function EjectDistance({ disabled }: { disabled?: boolean }): JSX.Element {
  const t = useT()
  const mm = useStore((s) => (s.settings.afterCut ?? DEFAULT_AFTER_CUT).ejectExtraMm)
  const setAfterCut = useStore((s) => s.setAfterCut)
  return (
    <div className={'eject-dist' + (disabled ? ' off' : '')} data-testid="eject-distance" style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
      <SliderField label={t('rightPanel.plotter.ejectDistance')} value={mm} min={0} max={MAX_EJECT_MM} step={1} unit="mm" onChange={(v) => setAfterCut({ ejectExtraMm: v })} title={t('rightPanel.plotter.ejectDistanceTooltip')} />
      <button className="btn small" onClick={() => setAfterCut({ ejectExtraMm: DEFAULT_AFTER_CUT.ejectExtraMm })} disabled={mm === DEFAULT_AFTER_CUT.ejectExtraMm} title={t('rightPanel.plotter.ejectResetTooltip', { mm: DEFAULT_AFTER_CUT.ejectExtraMm })}>{t('rightPanel.plotter.ejectReset')}</button>
    </div>
  )
}

export function CutPanel(): JSX.Element {
  const t = useT()
  const cut = useStore((s) => s.settings.cut)
  const setCut = useStore((s) => s.setCut)
  const device = useStore((s) => s.devices.find((d) => d.id === s.connectedId))
  const openTestCut = useStore((s) => s.openTestCut)
  const testBlocker = useTestCutBlocker()
  const autoBlade = device?.autoBlade
  const profiles = useStore((s) => s.settings.materialProfiles) ?? []
  const activeRef = useStore((s) => s.activeProfile)
  const selectProfile = useStore((s) => s.selectProfile)
  const saveProfile = useStore((s) => s.saveMaterialProfile)
  const renameProfile = useStore((s) => s.renameMaterialProfile)
  const deleteProfile = useStore((s) => s.deleteMaterialProfile)
  const updateProfile = useStore((s) => s.updateMaterialProfile)
  const revertChanges = useStore((s) => s.revertProfileChanges)
  const act = resolveActiveProfile(cut, profiles, activeRef)
  const active = act?.profile ?? null
  const modified = !!act?.modified
  const activeCustom = act && !act.builtin ? act.profile : null
  return (
    <Card id="cut" title={t('rightPanel.cut.title')} icon={<Scissors size={15} />}>
      <div className="chips">
        {BUILTIN_MATERIALS.map((m) => (
          <button key={m.name} className={'chip' + (active === m ? ' on' : '') + (active === m && modified ? ' modified' : '')} onClick={() => selectProfile({ name: m.name, builtin: true })} title={t('rightPanel.cut.builtinTooltip', { name: materialLabel(m) })}>{materialLabel(m)}{active === m && modified && <i className="mod-dot" aria-label={t('rightPanel.cut.modifiedAria')} />}</button>
        ))}
        {profiles.map((m) => (
          <button key={'p:' + m.name} className={'chip custom' + (active === m ? ' on' : '') + (active === m && modified ? ' modified' : '')} onClick={() => selectProfile({ name: m.name, builtin: false })} data-testid="profile-chip" title={t('rightPanel.cut.customTooltip', { name: m.name, blade: m.cut.blade, force: m.cut.force, speed: m.cut.speed, passes: m.cut.passes, overcut: m.cut.overcut })}>{m.name}{active === m && modified && <i className="mod-dot" aria-label={t('rightPanel.cut.modifiedAria')} />}</button>
        ))}
        {!active && <span className="chip static on" title={t('rightPanel.cut.ownValuesTooltip')}>{t('rightPanel.cut.ownValues')}</span>}
      </div>
      {active && modified && (
        <div className="profile-changed" data-testid="profile-changed" role="status">
          <span className="pc-text"><i className="mod-dot" />{act!.builtin ? t('rightPanel.cut.builtinChanged', { name: materialLabel(active) }) : t('rightPanel.cut.profileChanged', { name: active.name })}</span>
          <div className="pc-actions">
            {act!.builtin
              ? <button className="btn small" onClick={() => void saveProfile()} data-testid="profile-save-as-new" title={t('rightPanel.cut.saveAsNewTooltip')}><Plus size={13} /> {t('rightPanel.cut.saveAsNew')}</button>
              : <button className="btn small primary" onClick={() => void updateProfile(active.name)} data-testid="profile-update" title={t('rightPanel.cut.updateTooltip', { name: active.name })}><RefreshCw size={13} /> {t('rightPanel.cut.update')}</button>}
            <button className="btn small" onClick={revertChanges} data-testid="profile-revert" title={t('rightPanel.cut.revertTooltip', { name: materialLabel(active) })}><Undo2 size={13} /> {t('rightPanel.cut.revert')}</button>
          </div>
        </div>
      )}
      <div className="row profile-row">
        <button className="btn small grow2" onClick={() => void saveProfile()} data-testid="save-profile" title={t('rightPanel.cut.saveProfileTooltip')}><Plus size={13} /> {t('rightPanel.cut.saveProfile')}</button>
        {activeCustom && <>
          <button className="icon-btn boxed" onClick={() => void updateProfile(activeCustom.name, true)} data-testid="profile-overwrite" title={t('rightPanel.cut.overwriteTooltip', { name: activeCustom.name })}><RefreshCw size={14} /></button>
          <button className="icon-btn boxed" onClick={() => void renameProfile(activeCustom.name)} title={t('rightPanel.cut.renameTooltip', { name: activeCustom.name })}><Pencil size={14} /></button>
          <button className="icon-btn boxed" onClick={() => void deleteProfile(activeCustom.name)} title={t('rightPanel.cut.deleteTooltip', { name: activeCustom.name })}><Trash2 size={14} /></button>
        </>}
      </div>
      <SliderField
        label={autoBlade === true ? t('rightPanel.cut.bladeDepth') : t('rightPanel.cut.blade')} value={cut.blade} min={1} max={10} onChange={(v) => setCut({ blade: v })}
        title={autoBlade === true ? t('rightPanel.cut.bladeTooltipAuto') : autoBlade === false ? t('rightPanel.cut.bladeTooltipManual') : t('rightPanel.cut.bladeTooltip')}
      />
      {autoBlade === true && (
        <p className="hint subtle blade-note" data-testid="blade-note" title={t('rightPanel.cut.bladeTooltipAuto')}><Info size={12} />{t('rightPanel.cut.bladeNoteAuto')}</p>
      )}
      {autoBlade === false && (
        <p className="hint subtle blade-note" data-testid="blade-note"><Info size={12} />{t('rightPanel.cut.bladeNoteManual', { level: cut.blade })}</p>
      )}
      <SliderField label={t('rightPanel.cut.force')} value={cut.force} min={1} max={33} onChange={(v) => setCut({ force: v })} title={t('rightPanel.cut.forceTooltip')} />
      <SliderField label={t('rightPanel.cut.speed')} value={cut.speed} min={1} max={10} onChange={(v) => setCut({ speed: v })} title={t('rightPanel.cut.speedTooltip')} />
      <SliderField label={t('rightPanel.cut.passes')} value={cut.passes} min={1} max={5} onChange={(v) => setCut({ passes: v })} title={t('rightPanel.cut.passesTooltip')} />
      <SliderField label={t('rightPanel.cut.overcut')} value={cut.overcut} min={0} max={5} step={0.1} digits={1} unit="mm" onChange={(v) => setCut({ overcut: Math.round(v * 10) / 10 })} title={t('rightPanel.cut.overcutTooltip')} />
      <button className="btn small test-cut" disabled={!!testBlocker} onClick={openTestCut} title={testBlocker ?? t('rightPanel.cut.testCutTooltip')}>
        <FlaskConical size={13} /> {t('rightPanel.cut.testCut')}
      </button>
    </Card>
  )
}

/** Testschnitt braucht nur ein bereites Gerät, keine Bauteile. */
export function useTestCutBlocker(): string | null {
  const t = useT()
  const connectedId = useStore((s) => s.connectedId)
  const status = useStore((s) => s.deviceStatus)
  if (!connectedId || status === 'disconnected') return t('rightPanel.blocker.connectFirst')
  if (status === 'busy') return t('rightPanel.blocker.busy')
  if (status === 'no-media') return t('rightPanel.blocker.noMedia')
  if (status === 'error') return t('rightPanel.blocker.error')
  return null
}

export function useCutBlocker(): string | null {
  const t = useT()
  const parts = useStore((s) => s.parts)
  const wa = useStore((s) => s.settings.activeWorkArea)
  const connectedId = useStore((s) => s.connectedId)
  const status = useStore((s) => s.deviceStatus)
  return useMemo(() => {
    if (!parts.length) return t('rightPanel.blocker.noParts')
    if (!connectedId || status === 'disconnected') return t('rightPanel.blocker.connectFirst')
    if (status === 'busy') return t('rightPanel.blocker.busy')
    if (status === 'no-media') return t('rightPanel.blocker.noMedia')
    if (status === 'error') return t('rightPanel.blocker.error')
    const n = outOfBoundsUnits(parts, wa).length
    if (n) return t('rightPanel.blocker.outOfBounds', { n })
    return null
  }, [parts, wa, connectedId, status, t])
}

export function CutButton(): JSX.Element {
  const t = useT()
  const blocker = useCutBlocker()
  const setOpen = useStore((s) => s.setCutOpen)
  return (
    <div className="cut-bar">
      {blocker && <p className="cut-reason"><Info size={13} />{blocker}</p>}
      <button className="btn-cut" disabled={!!blocker} onClick={() => setOpen(true)} title={blocker ?? t('rightPanel.cutButton.tooltip')}>
        <Scissors size={20} /> {t('rightPanel.cutButton.label')}
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
