import { useState } from 'react'
import { Info, Stamp } from 'lucide-react'
import { STICKER_MAX_MM } from '../core'
import { useStore } from '../store'
import { addStickerContour, loadSticker, saveSticker } from '../lib/sticker'
import { NumberField } from './NumberField'

/** Abschnitt „Aufkleberkontur“ in der Karte „Auswahl“: Kontur um die Außenform mit Lückenschluss und Glättung. */
export function StickerSection(): JSX.Element {
  const [s, setS] = useState(loadSticker)
  const hasSel = useStore((st) => st.selection.length > 0)
  const patch = (p: Partial<typeof s>): void => { const n = { ...s, ...p }; setS(n); saveSticker(n) }
  return (
    <div className="border-box" data-testid="sticker-section">
      <div className="sub-head"><Stamp size={14} /> Aufkleberkontur</div>
      <NumberField label="Abstand" unit="mm" value={s.offsetMm} min={0.1} max={STICKER_MAX_MM} step={0.5} digits={1} onCommit={(v) => patch({ offsetMm: v })} title="Abstand der Kontur zur Außenform" />
      <NumberField label="Lücken schließen" unit="mm" value={s.gapMm} min={0} max={20} step={0.5} digits={1} onCommit={(v) => patch({ gapMm: v })} title="Lücken bis zu dieser Breite zwischen Teilen (z. B. Buchstaben) werden überbrückt, damit die Kontur zusammenhängt. 0 = aus" />
      <NumberField label="Glättung" unit="mm" value={s.smoothMm} min={0} max={20} step={0.5} digits={1} onCommit={(v) => patch({ smoothMm: v })} title="Rundet auch einspringende Ecken der Kontur ab. 0 = aus" />
      <div className="row">
        <button className="btn primary" disabled={!hasSel} onClick={() => addStickerContour(s)} data-testid="sticker-add" title="Kontur um die Außenform der Auswahl legen (Löcher geschlossen); ersetzt einen vorhandenen Rand"><Stamp size={14} /> Aufkleberkontur</button>
      </div>
      <p className="hint subtle"><Info size={12} />Ein Rand-Teil um die Außenform, wird zuletzt geschnitten. Ersetzt einen vorhandenen Schnittrand der Auswahl.</p>
    </div>
  )
}
