import { addBorderToParts, DEFAULT_STICKER, STICKER_MAX_MM, type StickerOptions } from '../core'
import { useStore } from '../store'
import { t } from '@shared/i18n'

const LS_KEY = 'pn.sticker'
const num = (v: unknown, def: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 100) / 100)) : def

export function sanitizeSticker(raw: unknown): StickerOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<StickerOptions>
  return {
    offsetMm: num(r.offsetMm, DEFAULT_STICKER.offsetMm, 0.1, STICKER_MAX_MM),
    gapMm: num(r.gapMm, DEFAULT_STICKER.gapMm, 0, 20),
    smoothMm: num(r.smoothMm, DEFAULT_STICKER.smoothMm, 0, 20)
  }
}
export function loadSticker(): StickerOptions {
  try { return sanitizeSticker(JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')) } catch { return { ...DEFAULT_STICKER } }
}
export function saveSticker(s: StickerOptions): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch { /* ignorieren */ }
}

/** Aufkleberkontur um die Auswahl (Kontur-Offset der Außenform, Lücken überbrückt) als Rand-Teil in der Gruppe; ein Undo-Schritt. */
export function addStickerContour(opts: StickerOptions): void {
  const st = useStore.getState()
  if (!st.selection.length) { st.toast('info', t('sticker.toast.selectFirst')); return }
  let r: ReturnType<typeof addBorderToParts>
  try {
    r = addBorderToParts(st.parts, st.selection, { mode: 'offset', offsetMm: opts.offsetMm, gapMm: opts.gapMm, smoothMm: opts.smoothMm })
  } catch (e) {
    st.toast('error', t('sticker.toast.failed', { reason: String((e as Error)?.message ?? e) })); return
  }
  if (!r) { st.toast('info', t('sticker.toast.selectFirst')); return }
  if (r.fellBack) { st.toast('warn', t('sticker.toast.fellBack')) }
  st.snapshot()
  const parts = r.parts.map((p) => (p.id === r!.borderId ? { ...p, name: t('part.contourName', { name: r!.parts.find((q) => q.groupId === p.groupId && q.role !== 'border')?.name ?? t('part.defaultName') }) } : p))
  useStore.setState({ parts, selection: r.selection, memberGroup: null })
  st.toast('success', t(r.grouped ? (r.replaced ? 'sticker.toast.replacedGrouped' : 'sticker.toast.addedGrouped') : (r.replaced ? 'sticker.toast.replaced' : 'sticker.toast.added'), { mm: opts.offsetMm }))
}
