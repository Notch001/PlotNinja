import { Copy, Grid3x3, Group, Magnet, Maximize, Merge, Redo2, Scissors, Split, Trash2, Undo2, Ungroup, XOctagon } from 'lucide-react'
import { useMemo } from 'react'
import { selectedParts, useStore } from '../store'

export function Header(): JSX.Element {
  const s = useStore()
  const hasSel = s.selection.length > 0
  const sel = useMemo(() => selectedParts(s.parts, s.selection), [s.parts, s.selection])
  const canGroup = sel.length >= 2 && !(sel[0].groupId && sel.every((p) => p.groupId === sel[0].groupId))
  const hasGroup = sel.some((p) => p.groupId)
  const splitBlocked = sel.length === 1 && !!sel[0].groupId
  return (
    <header className="header">
      <div className="logo">
        <span className="logo-mark"><Scissors size={16} strokeWidth={2.4} /></span>
        <span className="logo-name">Plot<b>Ninja</b></span>
      </div>
      <div className="header-sep" />
      <div className="btn-group">
        <button className="icon-btn" onClick={s.undo} disabled={!s.past.length} title="Rückgängig (Strg+Z)"><Undo2 size={17} /></button>
        <button className="icon-btn" onClick={s.redo} disabled={!s.future.length} title="Wiederholen (Strg+Y)"><Redo2 size={17} /></button>
      </div>
      <div className="header-sep" />
      <div className="btn-group">
        <button className="icon-btn" onClick={s.duplicateSelected} disabled={!hasSel} title="Auswahl duplizieren (Strg+D)"><Copy size={17} /></button>
        <button className="icon-btn" onClick={s.splitSelected} disabled={s.selection.length !== 1 || splitBlocked} title={splitBlocked ? 'Das Teil gehört zu einer Gruppe – zuerst die Gruppierung aufheben (Strg+Umschalt+G)' : 'In Einzelteile zerlegen (genau ein Bauteil wählen)'}><Split size={17} /></button>
        <button className="icon-btn" onClick={s.groupSelected} disabled={!canGroup} title="Gruppieren (Strg+G): Auswahl wird zu einer Einheit"><Group size={17} /></button>
        <button className="icon-btn" onClick={s.ungroupSelected} disabled={!hasGroup} title="Gruppierung aufheben (Strg+Umschalt+G)"><Ungroup size={17} /></button>
        <button className="icon-btn" onClick={s.deleteSelected} disabled={!hasSel} title="Auswahl löschen (Entf)"><Trash2 size={17} /></button>
        <button
          className="icon-btn"
          disabled={!s.parts.length}
          title="Alle Bauteile löschen"
          onClick={async () => {
            if (await s.askConfirm('Alle Bauteile löschen?', `Alle ${s.parts.length} Bauteile werden von der Arbeitsfläche entfernt. Das kann mit Strg+Z rückgängig gemacht werden.`, 'Alle löschen', true)) s.clearAll()
          }}
        ><XOctagon size={17} /></button>
      </div>
      <div className="header-sep" />
      <button className="btn ghost" onClick={s.fit} title="Arbeitsfläche einpassen"><Maximize size={15} /> Einpassen</button>
      <div className="spacer" />
      <button
        className={'toggle' + (s.settings.weldOnImport !== false ? ' on' : '')}
        onClick={() => s.patchSettings({ weldOnImport: s.settings.weldOnImport === false })}
        aria-pressed={s.settings.weldOnImport !== false}
        title="Beim Import Überlappungen vereinen: Entfernt Linien innerhalb von Buchstaben, die durch überlappende Formen entstehen. Löcher wie im P bleiben."
      ><Merge size={15} /> Überlappungen vereinen</button>
      <button className={'toggle' + (s.showGrid ? ' on' : '')} onClick={s.toggleGrid} aria-pressed={s.showGrid} title="Raster ein-/ausblenden"><Grid3x3 size={15} /> Raster</button>
      <button className={'toggle' + (s.snapEnabled ? ' on' : '')} onClick={s.toggleSnap} aria-pressed={s.snapEnabled} title="Einrasten an Kanten und Mitten ein-/ausschalten (Alt beim Ziehen = vorübergehend aus)"><Magnet size={15} /> Einrasten</button>
    </header>
  )
}
