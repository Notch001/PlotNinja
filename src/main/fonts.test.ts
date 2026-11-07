import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { fontDirs, fontDisplayName, listFontFiles } from './fonts'

const root = mkdtempSync(join(tmpdir(), 'pn-fonts-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('Schriftsuche', () => {
  it('Windows-Ordner: System und Benutzer', () => {
    const d = fontDirs({ WINDIR: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }, 'win32')
    expect(d[0]).toMatch(/Windows.*Fonts$/)
    expect(d[1]).toMatch(/Microsoft.*Windows.*Fonts$/)
    expect(fontDirs({}, 'win32')).toHaveLength(1)
  })
  it('findet .ttf/.otf, ignoriert .ttc/.woff/Sonstiges, sortiert und ignoriert fehlende Ordner', async () => {
    mkdirSync(join(root, 'sub'))
    for (const f of ['b.ttf', 'A.OTF', 'x.ttc', 'y.woff', 'z.txt', 'sub/Open_Sans-Bold.ttf']) writeFileSync(join(root, f), 'x')
    const list = await listFontFiles([root, join(root, 'gibtsnicht')])
    expect(list.map((f) => f.name)).toEqual(['A', 'B', 'Open Sans Bold'])
    expect(list[0].path).toBe(join(root, 'A.OTF'))
  })
  it('Anzeigename aus Dateiname', () => {
    expect(fontDisplayName('arialbd.ttf')).toBe('Arialbd')
  })
})
