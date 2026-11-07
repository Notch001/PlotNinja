import { t, type MessageKey } from '@shared/i18n'
import type { WorkArea } from '@shared/types'

/** Anzeigename der mitgelieferten Arbeitsflächen (gespeichert wird der deutsche Name; eigene Namen bleiben unverändert). */
const DEFAULT_NAME_KEYS: Record<string, MessageKey> = {
  'Cameo – 12" × 12" Matte': 'workArea.cameo12x12',
  'Cameo – 12" × 24" Matte': 'workArea.cameo12x24',
  'Cameo – Rolle 305 mm': 'workArea.cameoRoll',
  'Portrait – 8" × 12" Matte': 'workArea.portrait8x12'
}

export function workAreaLabel(area: Pick<WorkArea, 'name'> | string): string {
  const name = typeof area === 'string' ? area : area.name
  const key = DEFAULT_NAME_KEYS[name]
  return key ? t(key) : name
}
