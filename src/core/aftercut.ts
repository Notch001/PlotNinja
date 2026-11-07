import { DEFAULT_AFTER_CUT, MAX_EJECT_MM, type AfterCutSettings } from '@shared/types'

/** Prüft/ergänzt gespeicherte „Nach dem Schneiden“-Optionen; Unbrauchbares fällt auf die Standardwerte zurück. */
export function sanitizeAfterCut(raw: unknown): AfterCutSettings {
  const r = (raw ?? {}) as Partial<AfterCutSettings>
  const mm = typeof r.ejectExtraMm === 'number' && isFinite(r.ejectExtraMm) ? Math.min(MAX_EJECT_MM, Math.max(0, Math.round(r.ejectExtraMm))) : DEFAULT_AFTER_CUT.ejectExtraMm
  return { eject: r.eject === true, ejectExtraMm: mm }
}
