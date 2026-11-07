import { resolveLanguage, sanitizeLanguagePref, setLanguage, type Language, type LanguagePref } from '@shared/i18n'

/* Sprachwahl im Renderer: 'auto' (Betriebssystem) | 'de' | 'en'. Die Wahl liegt in den Einstellungen (settings.language);
 * zusätzlich merkt sich der Browser sie (localStorage), damit beim Start nichts kurz in der falschen Sprache aufblitzt. */

const LS_KEY = 'pn.language'

function systemLocale(): string {
  try { return navigator.language || '' } catch { return '' }
}

/** Zuletzt benutzte Wahl (nur als Startwert bis die Einstellungen geladen sind). */
export function cachedLanguagePref(): LanguagePref {
  try { return sanitizeLanguagePref(localStorage.getItem(LS_KEY)) } catch { return 'auto' }
}

/**
 * Wendet die Wahl an: löst 'auto' über navigator.language auf, setzt die Sprache im Renderer (alle `useT()`-Komponenten
 * rendern neu), setzt `<html lang>` und meldet sie dem Hauptprozess (Dialoge, Updater, Fehlermeldungen).
 */
export function applyLanguagePref(pref: LanguagePref): Language {
  const lang = resolveLanguage(pref, systemLocale())
  setLanguage(lang)
  try { document.documentElement.lang = lang } catch { /* kein DOM */ }
  try { localStorage.setItem(LS_KEY, pref) } catch { /* ignorieren */ }
  try { void window.api?.setLanguage(lang)?.catch(() => undefined) } catch { /* ignorieren */ }
  return lang
}

/** Beim Start vor dem ersten Rendern aufrufen. */
export function initLanguage(): void {
  applyLanguagePref(cachedLanguagePref())
}
