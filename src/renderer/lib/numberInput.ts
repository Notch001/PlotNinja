import { formatNumber, type Language } from '@shared/i18n'

/**
 * Zahleneingabe aus einem Textfeld lesen. Akzeptiert Komma und Punkt als Dezimaltrennzeichen,
 * ignoriert Leerzeichen/Apostroph sowie Tausendertrennzeichen:
 *  - "1.234,5" / "1,234.5" -> 1234.5 (das letzte Zeichen von beiden ist das Dezimalzeichen)
 *  - "1.234.567" / "1,234,567" -> Tausendertrennzeichen (mehrfach)
 *  - "12,5" / "12.5" -> 12.5
 *  - "1.234" -> in de 1234 (Punkt = Tausender), in en 1.234; "1,234" umgekehrt.
 */
export function parseNum(input: string, lang?: Language): number | null {
  let s = input.trim().replace(/[\s  ']/g, '').replace(/−/g, '-')
  if (s === '') return null
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ','
    const grp = dec === '.' ? ',' : '.'
    s = s.split(grp).join('').replace(dec, '.')
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ','
    const count = s.split(sep).length - 1
    const tail = s.length - s.lastIndexOf(sep) - 1
    const groupSep = lang === 'de' ? '.' : lang === 'en' ? ',' : null
    if (count > 1) s = s.split(sep).join('') // mehrfach = Tausendertrennzeichen
    else if (sep === groupSep && tail === 3 && /^-?[1-9]\d{0,2}[.,]\d{3}$/.test(s)) s = s.replace(sep, '') // "1.234" in de
    else s = s.replace(sep, '.')
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null
  const n = Number(s)
  return isFinite(n) ? n : null
}

/** Zahl fürs Eingabefeld: sprachabhängiges Dezimalzeichen, ohne Tausendertrennzeichen. */
export function formatInput(v: number | null, digits: number): string {
  return v === null ? '' : formatNumber(v, { maximumFractionDigits: digits, useGrouping: false })
}
