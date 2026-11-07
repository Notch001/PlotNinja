import { Copy, Grid3x3, Magnet, Maximize, Redo2, Scissors, Trash2, Undo2, Ungroup, XOctagon } from 'lucide-react'
import { useStore } from '../store'

export function Header(): JSX.Element {
  const s = useStore()
  const hasSel = s.selection.length > 0
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
        <button className="icon-btn" onClick={s.splitSelected} disabled={s.selection.length !== 1} title="In Einzelteile zerlegen (genau ein Bauteil wählen)"><Ungroup size={17} /></button>
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
      <button className={'toggle' + (s.showGrid ? ' on' : '')} onClick={s.toggleGrid} aria-pressed={s.showGrid} title="Raster ein-/ausblenden"><Grid3x3 size={15} /> Raster</button>
      <button className={'toggle' + (s.snapEnabled ? ' on' : '')} onClick={s.toggleSnap} aria-pressed={s.snapEnabled} title="Einrasten an Kanten und Mitten ein-/ausschalten (Alt beim Ziehen = vorübergehend aus)"><Magnet size={15} /> Einrasten</button>
    </header>
  )
}
