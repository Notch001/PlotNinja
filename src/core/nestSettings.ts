import { DEFAULT_NEST, NEST_MAX_COUNT, NEST_MAX_MM, type NestSettings } from '@shared/types'

const num = (v: unknown, def: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def

/** Prüft/ergänzt gespeicherte Nesting-Voreinstellungen; Unbrauchbares fällt auf die Standardwerte zurück. */
export function sanitizeNest(raw: unknown): NestSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<NestSettings>
  return {
    mode: r.mode === 'fill' ? 'fill' : 'count',
    count: Math.round(num(r.count, DEFAULT_NEST.count, 1, NEST_MAX_COUNT)),
    gapMm: Math.round(num(r.gapMm, DEFAULT_NEST.gapMm, 0, NEST_MAX_MM) * 10) / 10,
    marginMm: Math.round(num(r.marginMm, DEFAULT_NEST.marginMm, 0, NEST_MAX_MM) * 10) / 10,
    rotate: r.rotate === 'off' || r.rotate === 'free' || r.rotate === '90' ? r.rotate : DEFAULT_NEST.rotate,
    holes: r.holes === true,
    includeOriginal: r.includeOriginal !== false
  }
}
