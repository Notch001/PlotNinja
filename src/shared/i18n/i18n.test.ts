import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { de } from './de'
import { en } from './en'
import { format, getLanguage, onLanguageChange, resolveLanguage, sanitizeLanguagePref, setLanguage, t, tIn, type MessageKey } from './index'

const keys = Object.keys(de) as MessageKey[]

/** Namen aller Platzhalter einer Meldung, auch innerhalb von Plural-Zweigen (Texte in Zweigen sind kein Platzhalter). */
function placeholders(msg: string, out = new Set<string>()): string[] {
  let i = 0
  while (i < msg.length) {
    const open = msg.indexOf('{', i)
    if (open < 0) break
    let depth = 0, close = -1
    for (let k = open; k < msg.length; k++) {
      if (msg[k] === '{') depth++
      else if (msg[k] === '}' && --depth === 0) { close = k; break }
    }
    if (close < 0) break
    const m = /^\s*([A-Za-z_]\w*)\s*(?:,\s*plural\s*,([\s\S]*))?$/.exec(msg.slice(open + 1, close))
    if (m) {
      out.add(m[1])
      if (m[2]) {
        // Zweige "one {…} other {…}": nur deren Inneres weiter untersuchen
        const body = m[2]
        let j = 0
        while (j < body.length) {
          const o = body.indexOf('{', j)
          if (o < 0) break
          let d = 0, c = -1
          for (let k = o; k < body.length; k++) {
            if (body[k] === '{') d++
            else if (body[k] === '}' && --d === 0) { c = k; break }
          }
          if (c < 0) break
          placeholders(body.slice(o + 1, c), out)
          j = c + 1
        }
      }
    }
    i = close + 1
  }
  return Array.from(out).sort()
}

describe('Kataloge', () => {
  it('en enthält alle de-Schlüssel und sonst nichts', () => {
    expect(Object.keys(en).sort()).toEqual([...keys].sort())
  })

  it('keine leeren Texte (außer ausdrücklich leeren Plural-Zweigen), Schlüssel folgen der Namenskonvention', () => {
    for (const k of keys) {
      expect(k, k).toMatch(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/)
      expect(de[k].trim().length, 'de ' + k).toBeGreaterThan(0)
      expect(en[k].trim().length, 'en ' + k).toBeGreaterThan(0)
    }
  })

  it('Platzhalter sind in beiden Sprachen identisch', () => {
    for (const k of keys) expect(placeholders(en[k]), k).toEqual(placeholders(de[k]))
  })

  it('geschweifte Klammern sind ausgeglichen', () => {
    for (const k of keys) for (const cat of [de, en]) {
      let depth = 0
      for (const ch of cat[k]) { if (ch === '{') depth++; if (ch === '}') depth--; expect(depth, k).toBeGreaterThanOrEqual(0) }
      expect(depth, k).toBe(0)
    }
  })
})

/** Alle Quelldateien unter src/ (ohne die Kataloge selbst). */
function sourceFiles(dir = resolve(__dirname, '../..')): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { if (name !== 'assets') out.push(...sourceFiles(full)); continue }
    if (/\.(ts|tsx)$/.test(name) && !/\/i18n\/(de|en)\.ts$/.test(full.replace(/\\/g, '/'))) out.push(full)
  }
  return out
}

describe('Verwendung der Schlüssel im Quelltext', () => {
  // Kommentare zählen nicht als Verwendung (und dürfen Beispiel-Schlüssel enthalten)
  const strip = (src: string): string => src.replace(/(^|[\s;{(,])\/\*[\s\S]*?\*\//g, '$1').replace(/^\s*\/\/.*$/gm, '')
  const files = sourceFiles().map((f) => ({ f, text: strip(readFileSync(f, 'utf8')) }))
  const known = new Set<string>(keys)

  it('jeder t(\'…\')-Literal-Schlüssel existiert', () => {
    const bad: string[] = []
    const re = /(?<![\w.])t\(\s*(['"`])([^'"`$]+)\1/g
    for (const { f, text } of files) {
      if (f.endsWith('i18n.test.ts')) continue
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) if (!known.has(m[2])) bad.push(`${f.replace(/.*\/src\//, 'src/')}: ${m[2]}`)
    }
    expect(bad).toEqual([])
  })

  it('t() wird nie mit Template-Strings oder Verkettungen aufgerufen (Schlüssel müssen als Literal im Code stehen)', () => {
    const bad: string[] = []
    const re = /(?<![\w.])t\(\s*(`[^`]*\$\{|['"][^'"]*['"]\s*\+)/g
    for (const { f, text } of files) {
      if (f.endsWith('i18n.test.ts')) continue
      if (re.test(text)) bad.push(f.replace(/.*\/src\//, 'src/'))
      re.lastIndex = 0
    }
    expect(bad).toEqual([])
  })

  it('jeder Schlüssel wird irgendwo als Literal verwendet', () => {
    const used = new Set<string>()
    for (const { f, text } of files) {
      if (f.endsWith('i18n.test.ts')) continue
      for (const m of text.matchAll(/['"`]([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)['"`]/g)) used.add(m[1])
    }
    expect(keys.filter((k) => !used.has(k))).toEqual([])
  })
})

describe('t / format', () => {
  it('Standard ist Deutsch; Platzhalter werden ersetzt', () => {
    expect(getLanguage()).toBe('de')
    expect(t('toast.profile.saved', { name: 'X' })).toBe('Profil „X“ gespeichert')
    setLanguage('en')
    expect(t('toast.profile.saved', { name: 'X' })).toBe('Profile “X” saved')
  })

  it('fehlende Parameter bleiben sichtbar', () => {
    expect(format('Hallo {name}')).toBe('Hallo {name}')
  })

  it('Plural (ICU-light): one/other, #, =0, mehrere Variablen', () => {
    const tpl = '{n, plural, one {# Bauteil} other {# Bauteile}}'
    expect(format(tpl, { n: 1 })).toBe('1 Bauteil')
    expect(format(tpl, { n: 0 })).toBe('0 Bauteile')
    expect(format(tpl, { n: 5 })).toBe('5 Bauteile')
    expect(format('{n, plural, =0 {nichts} one {eins} other {viele: {n}}}', { n: 0 })).toBe('nichts')
    expect(format('{n, plural, =0 {nichts} one {eins} other {viele: {n}}}', { n: 7 })).toBe('viele: 7')
    expect(t('import.toast.addedFiles', { files: 1, n: 3 })).toBe('1 Datei → 3 Bauteile hinzugefügt')
    expect(t('import.toast.oversized', { n: 2 })).toBe('2 Bauteile waren größer als die Arbeitsfläche und wurden verkleinert')
    expect(t('import.toast.oversized', { n: 1 })).toBe('1 Bauteil war größer als die Arbeitsfläche und wurde verkleinert')
    expect(tIn('en', 'import.toast.oversized', { n: 1 })).toBe('1 part was larger than the work area and was scaled down')
    expect(tIn('en', 'import.toast.bigImage', { name: 'a.png', more: 0 })).toBe('a.png: very large image file (over 50 MB) – loading may take a while')
    expect(tIn('en', 'import.toast.bigImage', { name: 'a.png', more: 2 })).toContain('a.png and 2 more:')
  })

  it('Sprachwechsel meldet sich an Abonnenten, Abmelden funktioniert', () => {
    const seen: string[] = []
    const off = onLanguageChange((l) => seen.push(l))
    setLanguage('en')
    setLanguage('en') // unverändert: kein Ereignis
    setLanguage('de')
    off()
    setLanguage('en')
    expect(seen).toEqual(['en', 'de'])
  })

  it('Sprache „auto“ richtet sich nach der Systemsprache', () => {
    expect(resolveLanguage('auto', 'de-DE')).toBe('de')
    expect(resolveLanguage('auto', 'de')).toBe('de')
    expect(resolveLanguage('auto', 'DE_AT')).toBe('de')
    expect(resolveLanguage('auto', 'en-US')).toBe('en')
    expect(resolveLanguage('auto', 'fr-FR')).toBe('en')
    expect(resolveLanguage('auto', undefined)).toBe('en')
    expect(resolveLanguage('de', 'en-US')).toBe('de')
    expect(resolveLanguage('en', 'de-DE')).toBe('en')
    expect(sanitizeLanguagePref('xx')).toBe('auto')
    expect(sanitizeLanguagePref('en')).toBe('en')
  })
})
