import { BORDER_MAX_MM, BORDER_MIN_MM, DEFAULT_BORDER, type BorderSettings } from '@shared/types'

const clampMm = (v: unknown, def: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(BORDER_MAX_MM, Math.max(BORDER_MIN_MM, Math.round(v * 100) / 100)) : def

/** Prüft/ergänzt gespeicherte Schnittrand-Voreinstellungen; Unbrauchbares fällt auf die Standardwerte zurück. */
export function sanitizeBorder(raw: unknown): BorderSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<BorderSettings>
  return {
    mode: r.mode === 'offset' ? 'offset' : 'rect',
    offsetMm: clampMm(r.offsetMm, DEFAULT_BORDER.offsetMm),
    rounded: r.rounded === true,
    cornerRadiusMm: clampMm(r.cornerRadiusMm, DEFAULT_BORDER.cornerRadiusMm)
  }
}
