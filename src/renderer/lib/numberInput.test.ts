import { afterEach, describe, expect, it } from 'vitest'
import { getLanguage, setLanguage } from '@shared/i18n'
import { formatInput, parseNum } from './numberInput'
import { fmt } from './transform'

const start = getLanguage()
afterEach(() => setLanguage(start))

describe('parseNum', () => {
  it('akzeptiert Komma und Punkt als Dezimalzeichen', () => {
    for (const lang of ['de', 'en'] as const) {
      expect(parseNum('12,5', lang)).toBe(12.5)
      expect(parseNum('12.5', lang)).toBe(12.5)
      expect(parseNum(' -3,25 ', lang)).toBe(-3.25)
      expect(parseNum('0.125', lang)).toBe(0.125)
      expect(parseNum('0,125', lang)).toBe(0.125)
      expect(parseNum('.5', lang)).toBe(0.5)
      expect(parseNum('7', lang)).toBe(7)
    }
  })
  it('ignoriert Tausendertrennzeichen', () => {
    expect(parseNum('1.234,5', 'de')).toBe(1234.5)
    expect(parseNum('1,234.5', 'en')).toBe(1234.5)
    expect(parseNum('1.234.567', 'de')).toBe(1234567)
    expect(parseNum('1,234,567', 'en')).toBe(1234567)
    expect(parseNum('1 234,5', 'de')).toBe(1234.5)
    expect(parseNum('1.234', 'de')).toBe(1234)
    expect(parseNum('1,234', 'en')).toBe(1234)
    expect(parseNum('1,234', 'de')).toBe(1.234)
    expect(parseNum('1.234', 'en')).toBe(1.234)
  })
  it('lehnt Ungültiges ab', () => {
    for (const s of ['', '  ', 'abc', '1,2,x', '--1', '1e5x', ',', '.']) expect(parseNum(s, 'de')).toBeNull()
  })
})

describe('Formatierung', () => {
  it('Eingabefeld folgt der Sprache, ohne Tausendertrennzeichen', () => {
    setLanguage('de'); expect(formatInput(1234.56, 1)).toBe('1234,6'); expect(formatInput(151.3, 1)).toBe('151,3')
    setLanguage('en'); expect(formatInput(1234.56, 1)).toBe('1234.6'); expect(formatInput(151.3, 1)).toBe('151.3')
    expect(formatInput(null, 1)).toBe('')
  })
  it('Rundlauf Anzeige -> Eingabe', () => {
    for (const lang of ['de', 'en'] as const) {
      setLanguage(lang)
      expect(parseNum(formatInput(151.3, 1), lang)).toBe(151.3)
      expect(parseNum(formatInput(1234.5, 1), lang)).toBe(1234.5)
    }
  })
  it('fmt (Anzeige mit Gruppierung)', () => {
    setLanguage('de'); expect(fmt(1234.56)).toBe('1.234,6')
    setLanguage('en'); expect(fmt(1234.56)).toBe('1,234.6'); expect(fmt(5)).toBe('5')
  })
})
