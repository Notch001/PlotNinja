/**
 * Zweisprachigkeit (Deutsch/Englisch) ohne Bibliothek. Läuft in core, main und renderer (jeweils eigene Modulinstanz).
 *
 *   t('toast.group.done', { n: 3 })     // Text in der aktuellen Sprache, Platzhalter {name}, Plural per ICU-light
 *   setLanguage('en') / getLanguage()    // globale Sprache des Prozesses (Standard 'de')
 *   onLanguageChange((lang) => …)        // Abo, gibt die Abmelde-Funktion zurück
 *
 * Katalog: de.ts (Quellsprache) und en.ts (muss alle Schlüssel haben, sonst Compile-Fehler). Details: README „Sprachen / Übersetzen“.
 */
import { de, type MessageKey } from './de'
import { en } from './en'

export type { MessageKey } from './de'

export type Language = 'de' | 'en'
/** Wahl des Benutzers: 'auto' = Sprache des Betriebssystems. */
export type LanguagePref = 'auto' | Language
export type MessageParams = Record<string, string | number>

export const LANGUAGES: readonly Language[] = ['de', 'en']
export const DEFAULT_LANGUAGE: Language = 'de'

const catalogs: Record<Language, Partial<Record<MessageKey, string>>> = { de, en }

let current: Language = DEFAULT_LANGUAGE
const listeners = new Set<(lang: Language) => void>()

export function getLanguage(): Language { return current }

export function setLanguage(lang: Language): void {
  if (lang !== 'de' && lang !== 'en') return
  if (lang === current) return
  current = lang
  for (const cb of [...listeners]) cb(lang)
}

/** Meldet `cb` bei jedem Sprachwechsel; Rückgabe = Abmelden. */
export function onLanguageChange(cb: (lang: Language) => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** Prüft unbekannte Daten (Einstellungsdatei): gültige Wahl oder 'auto'. */
export function sanitizeLanguagePref(v: unknown): LanguagePref {
  return v === 'de' || v === 'en' || v === 'auto' ? v : 'auto'
}

/** 'auto' löst anhand der Systemsprache (z. B. "de-DE", "en-US") auf: beginnt mit "de" -> Deutsch, sonst Englisch. */
export function resolveLanguage(pref: LanguagePref | undefined, systemLocale: string | undefined): Language {
  if (pref === 'de' || pref === 'en') return pref
  return /^de(\b|[-_])/i.test(systemLocale ?? '') ? 'de' : 'en'
}

/** Locale-Kennung für Zahlen- und Datumsformate der aktuellen Sprache. */
export function localeTag(lang: Language = current): string { return lang === 'de' ? 'de-DE' : 'en-US' }

/** Zahl nach der aktuellen Sprache formatiert (de: 1.234,5 / en: 1,234.5). */
export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(localeTag(), opts)
}

/** Sortiervergleich nach der aktuellen Sprache (ohne Groß-/Kleinschreibung, Zahlen numerisch). */
export function compareText(a: string, b: string): number {
  return a.localeCompare(b, localeTag(), { sensitivity: 'base', numeric: true })
}

/** Plural-Kategorie für de/en: genau 1 = 'one', sonst 'other'. */
function pluralCategory(n: number): 'one' | 'other' { return n === 1 ? 'one' : 'other' }

/** Index der schließenden Klammer zu der Klammer an `open` (-1 = fehlt). */
function matchBrace(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}' && --depth === 0) return i
  }
  return -1
}

/** Zerlegt "one {…} other {…} =0 {…}" in Zweige. */
function parseBranches(body: string): Map<string, string> {
  const out = new Map<string, string>()
  let i = 0
  while (i < body.length) {
    const open = body.indexOf('{', i)
    if (open < 0) break
    const sel = body.slice(i, open).trim()
    const close = matchBrace(body, open)
    if (close < 0) break
    out.set(sel, body.slice(open + 1, close))
    i = close + 1
  }
  return out
}

/** Ersetzt {name} und {n, plural, one {…} other {…}} (in Zweigen steht # für die Zahl). */
export function format(template: string, params: MessageParams = {}): string {
  let out = ''
  let i = 0
  while (i < template.length) {
    const open = template.indexOf('{', i)
    if (open < 0) { out += template.slice(i); break }
    out += template.slice(i, open)
    const close = matchBrace(template, open)
    if (close < 0) { out += template.slice(open); break }
    const inner = template.slice(open + 1, close)
    const m = /^\s*([A-Za-z_]\w*)\s*(?:,\s*plural\s*,([\s\S]*))?$/.exec(inner)
    if (!m) { out += template.slice(open, close + 1) } // kein Platzhalter: unverändert lassen
    else if (m[2] === undefined) {
      out += m[1] in params ? String(params[m[1]]) : template.slice(open, close + 1)
    } else {
      const n = Number(params[m[1]] ?? 0)
      const br = parseBranches(m[2])
      const chosen = br.get(`=${n}`) ?? br.get(pluralCategory(n)) ?? br.get('other') ?? ''
      out += format(chosen.replace(/#/g, formatNumber(n)), params)
    }
    i = close + 1
  }
  return out
}

/** Text zum Schlüssel in der aktuellen Sprache; fehlt er dort, gilt Deutsch. */
export function t(key: MessageKey, params?: MessageParams): string {
  const raw = catalogs[current][key] ?? catalogs.de[key] ?? key
  return params || raw.includes('{') ? format(raw, params) : raw
}

/** Wie `t`, aber in einer bestimmten Sprache (z. B. für Tests). */
export function tIn(lang: Language, key: MessageKey, params?: MessageParams): string {
  const raw = catalogs[lang][key] ?? catalogs.de[key] ?? key
  return format(raw, params)
}
