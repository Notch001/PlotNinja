import { useMemo, useSyncExternalStore } from 'react'
import { getLanguage, onLanguageChange, t, type Language, type MessageKey, type MessageParams } from '@shared/i18n'

export type TFunction = (key: MessageKey, params?: MessageParams) => string

/** Aktuelle Sprache; die Komponente rendert bei einem Sprachwechsel neu. */
export function useLanguage(): Language {
  return useSyncExternalStore((cb) => onLanguageChange(() => cb()), getLanguage)
}

/**
 * Übersetzungsfunktion für Komponenten: `const t = useT()` und dann `t('header.undo.tooltip')`.
 * Die Komponente rendert bei einem Sprachwechsel automatisch neu (die Funktion ändert dann ihre Identität,
 * auch in Abhängigkeitslisten von useMemo/useEffect verwendbar).
 */
export function useT(): TFunction {
  const lang = useLanguage()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo<TFunction>(() => (key, params) => t(key, params), [lang])
}
