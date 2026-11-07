import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Type, X } from 'lucide-react'
import type { Part } from '@shared/types'
import { findFreeSpot, partPaths, textToParts, translateParts, unionBox, type TextFont } from '../core'
import { useStore } from '../store'
import { BUNDLED_FONTS, listAllFonts, loadFont, type FontEntry } from '../lib/fonts'
import { fmt, pathD } from '../lib/transform'
import { NumberField } from './NumberField'

const LS_KEY = 'pn.text'
interface Saved { fontId?: string; size?: number; spacing?: number; asGroup?: boolean }
function lsLoad(): Saved {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Saved } catch { return {} }
}
function lsSave(v: Saved): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(v)) } catch { /* ignorieren */ }
}

export function TextDialog(): JSX.Element | null {
  const open = useStore((s) => s.textOpen)
  if (!open) return null
  return <TextDialogInner />
}

function TextDialogInner(): JSX.Element {
  const setOpen = useStore((s) => s.setTextOpen)
  const saved = useMemo(lsLoad, [])
  const [text, setText] = useState('')
  const [fonts, setFonts] = useState<FontEntry[]>(BUNDLED_FONTS)
  const [fontId, setFontId] = useState(saved.fontId ?? BUNDLED_FONTS[0]?.id ?? '')
  const [size, setSize] = useState(saved.size && saved.size > 0 ? saved.size : 30)
  const [spacing, setSpacing] = useState(typeof saved.spacing === 'number' ? saved.spacing : 0)
  const [asGroup, setAsGroup] = useState(saved.asGroup === true)
  const [font, setFont] = useState<TextFont | null>(null)
  const [fontError, setFontError] = useState('')
  const [loading, setLoading] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { void listAllFonts().then(setFonts) }, [])
  useEffect(() => { areaRef.current?.focus() }, [])
  useEffect(() => {
    const entry = fonts.find((f) => f.id === fontId) ?? fonts[0]
    if (!entry) return
    let alive = true
    setLoading(true)
    setFontError('')
    loadFont(entry).then((f) => { if (alive) { setFont(f); setLoading(false) } }).catch((e: Error) => { if (alive) { setFont(null); setFontError(e.message); setLoading(false) } })
    return () => { alive = false }
  }, [fontId, fonts])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !useStore.getState().dialog) setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  const result = useMemo(() => {
    if (!font || !text.trim()) return null
    try { return textToParts(font, text, { sizeMm: size, letterSpacingMm: spacing, asGroup }) } catch { return null }
  }, [font, text, size, spacing, asGroup])
  const parts = result?.parts ?? []
  const box = useMemo(() => unionBox(parts), [parts])
  const wa = useStore((s) => s.settings.activeWorkArea)
  const tooBig = !!box && (box.width > wa.width || box.height > wa.height)

  const d = useMemo(() => parts.map((p) => partPaths(p).map((pl) => pathD(pl.points, pl.closed)).join('')).join(''), [parts])
  const pad = Math.max(2, size * 0.15)

  const insert = (): void => {
    if (!parts.length || !box) return
    const st = useStore.getState()
    // Freien Platz für den ganzen Textblock suchen (Ersatzteil mit gleicher Bounding-Box)
    const probe: Part = { id: '_', name: '', sourcePath: '', paths: [], width: box.width, height: box.height, x: box.x, y: box.y, rotation: 0, scale: 1 }
    const spot = findFreeSpot(probe, st.parts, st.settings.activeWorkArea)
    const placed = translateParts(parts, spot.x - box.x, spot.y - box.y)
    st.addParts(placed, true) // ein Undo-Schritt
    lsSave({ fontId, size, spacing, asGroup })
    const n = placed.length
    st.toast('success', asGroup && n > 1 ? `Text eingefügt: ${n} Buchstaben als Gruppe` : 'Text eingefügt')
    if (result?.missing.length) st.toast('warn', `Nicht in der Schrift enthalten und ausgelassen: ${result.missing.join(' ')}`)
    setOpen(false)
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="modal text-dialog" role="dialog" aria-modal="true" aria-label="Text einfügen" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2><Type size={17} /> Text einfügen</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} title="Schließen"><X size={16} /></button>
        </div>
        <div className="modal-body text-body">
          <div className="text-form">
            <label className="field stacked">
              <span className="field-label">Text (mehrere Zeilen mit Enter)</span>
              <textarea
                ref={areaRef} className="text-input text-area" rows={4} value={text} placeholder="z. B. Alles Gute!"
                onChange={(e) => setText(e.target.value)} data-testid="text-input"
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); insert() } }}
              />
            </label>
            <label className="field stacked">
              <span className="field-label">Schriftart</span>
              <select className="text-input" value={fontId} onChange={(e) => setFontId(e.target.value)} data-testid="font-select">
                <optgroup label="Mitgelieferte Schriften">
                  {fonts.filter((f) => f.bundled).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </optgroup>
                {fonts.some((f) => !f.bundled) && (
                  <optgroup label="Installierte Schriften">
                    {fonts.filter((f) => !f.bundled).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
            <div className="grid2">
              <NumberField label="Größe" unit="mm" value={size} min={1} max={500} step={1} digits={1} onCommit={setSize} title="Schriftgröße: Höhe der Großbuchstaben in Millimetern" />
              <NumberField label="Abstand" unit="mm" value={spacing} min={-20} max={100} step={0.5} digits={1} onCommit={setSpacing} title="Zeichenabstand: zusätzlicher Abstand zwischen den Buchstaben in mm (negativ = enger)" />
            </div>
            <div className="seg" role="group" aria-label="Bauteile">
              <button className={!asGroup ? 'on' : ''} onClick={() => setAsGroup(false)} title="Der ganze Text wird ein einziges Bauteil (sich berührende Buchstaben verschmelzen)">Ein Bauteil</button>
              <button className={asGroup ? 'on' : ''} onClick={() => setAsGroup(true)} title="Jeder Buchstabe ist ein eigenes Bauteil; alle bilden eine Gruppe">Buchstaben als Gruppe</button>
            </div>
            <p className="hint subtle">Die Schriftgröße ist die Höhe der Großbuchstaben. Der Text wird als normale Bauteile eingefügt und lässt sich danach nicht mehr als Text bearbeiten.</p>
            {fontError && <p className="hint danger"><AlertTriangle size={14} />{fontError}</p>}
            {result && result.missing.length > 0 && <p className="hint warn"><AlertTriangle size={14} />Nicht in der Schrift enthalten: {result.missing.join(' ')}</p>}
            {tooBig && <p className="hint warn"><AlertTriangle size={14} />Der Text ist größer als die Arbeitsfläche ({wa.width} × {wa.height} mm).</p>}
          </div>
          <div className="text-preview" data-testid="text-preview">
            {loading && <span className="preview-busy"><Loader2 size={14} className="spin" /> Schrift wird geladen …</span>}
            {box ? (
              <svg viewBox={`${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`} preserveAspectRatio="xMidYMid meet">
                <path d={d} className="text-shape" fillRule="evenodd" />
              </svg>
            ) : (
              <p className="empty-mini">{text.trim() ? (loading ? '' : 'Mit dieser Schrift ist keine Vorschau möglich.') : 'Gib oben einen Text ein – die Vorschau erscheint hier.'}</p>
            )}
            {box && <span className="preview-size">{fmt(box.width)} × {fmt(box.height)} mm</span>}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => setOpen(false)}>Abbrechen</button>
          <button className="btn primary big" onClick={insert} disabled={!parts.length} data-testid="text-insert" title="Strg+Enter"><Type size={16} /> Einfügen</button>
        </div>
      </div>
    </div>
  )
}
