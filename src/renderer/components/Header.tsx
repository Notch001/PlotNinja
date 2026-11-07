import { Copy, CopyPlus, FlipHorizontal2, FlipVertical2, Grid3x3, Group, Magnet, Maximize, Merge, Redo2, Scissors, Split, SquareDashed, Trash2, Type, Undo2, Ungroup, XOctagon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AlignTools, RotateButtons } from './HeaderTools'
import { UpdateChip } from './UpdateChip'
import { FileMenu } from './FileMenu'
import { sanitizeBorder } from '../core'
import { selectedParts, useStore } from '../store'

/** Platzmangel: Ausrichten-Block wird zum Popover (Schwelle in px Fensterbreite). */
const COMPACT_BELOW = 1700

function useCompact(): boolean {
  const [c, setC] = useState(() => window.innerWidth < COMPACT_BELOW)
  useEffect(() => {
    const on = (): void => setC(window.innerWidth < COMPACT_BELOW)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return c
}

export function Header(): JSX.Element {
  const s = useStore()
  const compact = useCompact()
  const hasSel = s.selection.length > 0
  const sel = useMemo(() => selectedParts(s.parts, s.selection), [s.parts, s.selection])
  const canGroup = sel.length >= 2 && !(sel[0].groupId && sel.every((p) => p.groupId === sel[0].groupId))
  const bd = sanitizeBorder(s.settings.borderDefaults)
  const hasGroup = sel.some((p) => p.groupId)
  const splitBlocked = sel.length === 1 && !!sel[0].groupId
  return (
    <header className="header">
      <div className="logo">
        <span className="logo-mark"><Scissors size={16} strokeWidth={2.4} /></span>
        <span className="logo-name">Plot<b>Ninja</b></span>
      </div>
      <div className="header-sep" />
      <div className="hblock" title="Datei"><FileMenu /></div>
      <div className="header-sep" />
      <div className="btn-group hblock" role="group" aria-label="Bearbeiten" title="Bearbeiten">
        <button className="icon-btn" onClick={s.undo} disabled={!s.past.length} title="Rückgängig (Strg+Z)"><Undo2 size={17} /></button>
        <button className="icon-btn" onClick={s.redo} disabled={!s.future.length} title="Wiederholen (Strg+Y)"><Redo2 size={17} /></button>
        <button className="icon-btn" onClick={s.duplicateSelected} disabled={!hasSel} title="Auswahl duplizieren (Strg+D)"><Copy size={17} /></button>
        <button className="icon-btn" onClick={() => s.setNestOpen('multi')} disabled={!hasSel} data-testid="multi-btn" title={hasSel ? 'Mehrfach platzieren (Strg+M): die Auswahl mehrfach kopieren und platzsparend auf der Matte verteilen' : 'Mehrfach platzieren – zuerst ein Bauteil auswählen'}><CopyPlus size={17} /></button>
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
      <div className="btn-group hblock" role="group" aria-label="Drehen und Spiegeln" title="Drehen & Spiegeln">
        <RotateButtons />
        <button className="icon-btn" onClick={() => s.flipSelection('h')} disabled={!hasSel} title="Horizontal spiegeln (links/rechts), z. B. für Folie von der Rückseite (Umschalt+H)" data-testid="flip-h"><FlipHorizontal2 size={17} /></button>
        <button className="icon-btn" onClick={() => s.flipSelection('v')} disabled={!hasSel} title="Vertikal spiegeln (oben/unten) (Umschalt+V)" data-testid="flip-v"><FlipVertical2 size={17} /></button>
      </div>
      <div className="header-sep" />
      <div className="hblock" title="Ausrichten"><AlignTools compact={compact} /></div>
      <div className="header-sep" />
      <div className="hblock hview" role="group" aria-label="Ansicht" title="Ansicht">
        <button className="btn ghost" onClick={s.fit} title="Arbeitsfläche einpassen"><Maximize size={15} /><span className="lbl"> Einpassen</span></button>
        <button className={'toggle' + (s.showGrid ? ' on' : '')} onClick={s.toggleGrid} aria-pressed={s.showGrid} title="Raster ein-/ausblenden"><Grid3x3 size={15} /><span className="lbl"> Raster</span></button>
        <button className={'toggle' + (s.snapEnabled ? ' on' : '')} onClick={s.toggleSnap} aria-pressed={s.snapEnabled} title="Einrasten an Kanten und Mitten ein-/ausschalten (Alt beim Ziehen = vorübergehend aus)"><Magnet size={15} /><span className="lbl"> Einrasten</span></button>
      </div>
      <div className="header-sep" />
      <div className="btn-group hblock" role="group" aria-label="Text und Gruppieren" title="Text & Gruppieren">
        <button className="btn ghost" onClick={() => s.setTextOpen(true)} title="Text einfügen: Schrift wählen, Größe in mm, Buchstaben werden zu Schnittpfaden"><Type size={15} /><span className="lbl"> Text</span></button>
        <button className="btn ghost" onClick={s.addBorder} disabled={!hasSel} data-testid="border-btn" title={`Schnittrand um die Auswahl legen bzw. ersetzen (Strg+B): ${bd.mode === 'offset' ? 'Kontur' : bd.rounded ? 'abgerundetes Rechteck' : 'Rechteck'} mit ${bd.offsetMm} mm Abstand – erleichtert das Entgittern. Einstellungen im Auswahl-Panel.`}><SquareDashed size={15} /><span className="lbl"> Schnittrand</span></button>
        <button className="icon-btn" onClick={s.splitSelected} disabled={s.selection.length !== 1 || splitBlocked} title={splitBlocked ? 'Das Teil gehört zu einer Gruppe – zuerst die Gruppierung aufheben (Strg+Umschalt+G)' : 'In Einzelteile zerlegen (genau ein Bauteil wählen)'}><Split size={17} /></button>
        <button className="icon-btn" onClick={s.groupSelected} disabled={!canGroup} title="Gruppieren (Strg+G): Auswahl wird zu einer Einheit"><Group size={17} /></button>
        <button className="icon-btn" onClick={s.ungroupSelected} disabled={!hasGroup} title="Gruppierung aufheben (Strg+Umschalt+G)"><Ungroup size={17} /></button>
      </div>
      <div className="spacer" />
      <button
        className={'toggle' + (s.settings.weldOnImport !== false ? ' on' : '')}
        onClick={() => s.patchSettings({ weldOnImport: s.settings.weldOnImport === false })}
        aria-pressed={s.settings.weldOnImport !== false}
        title="Beim Import Überlappungen vereinen: Entfernt Linien innerhalb von Buchstaben, die durch überlappende Formen entstehen. Löcher wie im P bleiben."
      ><Merge size={15} /><span className="lbl"> Überlappungen vereinen</span></button>
      <div className="header-sep" />
      <UpdateChip />
    </header>
  )
}
