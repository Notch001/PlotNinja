import { useState } from 'react'
import { Info, Stamp } from 'lucide-react'
import { STICKER_MAX_MM } from '../core'
import { useStore } from '../store'
import { addStickerContour, loadSticker, saveSticker } from '../lib/sticker'
import { useT } from '../lib/useT'
import { NumberField } from './NumberField'

/** Abschnitt „Aufkleberkontur“ in der Karte „Auswahl“: Kontur um die Außenform mit Lückenschluss und Glättung. */
export function StickerSection(): JSX.Element {
  const t = useT()
  const [s, setS] = useState(loadSticker)
  const hasSel = useStore((st) => st.selection.length > 0)
  const patch = (p: Partial<typeof s>): void => { const n = { ...s, ...p }; setS(n); saveSticker(n) }
  return (
    <div className="border-box" data-testid="sticker-section">
      <div className="sub-head"><Stamp size={14} /> {t('sticker.title')}</div>
      <NumberField label={t('sticker.offset.label')} unit="mm" value={s.offsetMm} min={0.1} max={STICKER_MAX_MM} step={0.5} digits={1} onCommit={(v) => patch({ offsetMm: v })} title={t('sticker.offset.tip')} />
      <NumberField label={t('sticker.gap.label')} unit="mm" value={s.gapMm} min={0} max={20} step={0.5} digits={1} onCommit={(v) => patch({ gapMm: v })} title={t('sticker.gap.tip')} />
      <NumberField label={t('sticker.smooth.label')} unit="mm" value={s.smoothMm} min={0} max={20} step={0.5} digits={1} onCommit={(v) => patch({ smoothMm: v })} title={t('sticker.smooth.tip')} />
      <div className="row">
        <button className="btn primary" disabled={!hasSel} onClick={() => addStickerContour(s)} data-testid="sticker-add" title={t('sticker.add.tip')}><Stamp size={14} /> {t('sticker.title')}</button>
      </div>
      <p className="hint subtle"><Info size={12} />{t('sticker.hint')}</p>
    </div>
  )
}
