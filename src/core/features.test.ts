import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import opentype from 'opentype.js'
import type { CutSettings, Part, Point, Polyline, WorkArea } from '@shared/types'
import { DEFAULT_CUT } from '@shared/types'
import {
  BUILTIN_MATERIALS, assertImportSize, buildJob, deleteProfile, douglasPeucker, findMatchingProfile, flipParts, groupBounds, groupParts,
  importSvg, limitPoints, mirrorJobPaths, normalizeGroups, parseProject, partBounds, partPaths, partScale, partSize, renameProfile,
  rotateGroup, sanitizeProfiles, scaleGroup, serializeProject, splitPart, textToParts, upsertProfile, weldPart, withScale,
  capHeightUnits, type TextFont
} from './index'
import { pointInPolygon, pathsBox } from './geom'

const wa: WorkArea = { name: 't', width: 200, height: 100 }
const cut: CutSettings = { ...DEFAULT_CUT }
let seq = 0
function mk(x: number, y: number, w: number, h: number, extra: Partial<Part> = {}): Part {
  return {
    id: `f${seq++}`, name: 'p', sourcePath: '', width: w, height: h, x, y, rotation: 0, scale: 1,
    paths: [{ closed: true, points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w * 0.6, y: h }, { x: 0, y: h }] }],
    ...extra
  }
}
const world = (parts: Part[]): Point[] => parts.flatMap((p) => partPaths(p).flatMap((pl) => pl.points))
function close(a: Point[], b: Point[]): void {
  expect(a.length).toBe(b.length)
  a.forEach((p, i) => { expect(p.x).toBeCloseTo(b[i].x, 6); expect(p.y).toBeCloseTo(b[i].y, 6) })
}

describe('Spiegeln', () => {
  const variants: Partial<Part>[] = [{}, { rotation: 30 }, { rotation: -75, scale: 1.5 }, { rotation: 40, ...{ scaleX: 2, scaleY: 0.5 } }]
  for (const extra of variants) {
    it(`horizontal/vertikal an der Mitte, ${JSON.stringify(extra)}`, () => {
      const p = mk(30, 20, 20, 10, extra)
      const b = groupBounds([p])!
      const cx = b.x + b.width / 2, cy = b.y + b.height / 2
      close(world(flipParts([p], 'h')), world([p]).map((q) => ({ x: 2 * cx - q.x, y: q.y })))
      close(world(flipParts([p], 'v')), world([p]).map((q) => ({ x: q.x, y: 2 * cy - q.y })))
    })
  }

  it('Bounding-Box bleibt unverändert, zweimal spiegeln ergibt das Original', () => {
    const p = mk(30, 20, 20, 10, { rotation: 33, scaleX: 1.7, scaleY: 0.8, scale: 1.1 })
    const f = flipParts([p], 'h')
    const b0 = partBounds(p), b1 = partBounds(f[0])
    expect(b1.x).toBeCloseTo(b0.x, 6); expect(b1.width).toBeCloseTo(b0.width, 6)
    close(world(flipParts(f, 'h')), world([p]))
  })

  it('Gruppe: Anordnung spiegelt um die Gruppenmitte mit', () => {
    const g = [mk(10, 10, 20, 10, { groupId: 'g' }), mk(60, 30, 15, 30, { groupId: 'g', rotation: 30 })]
    const b = groupBounds(g)!
    const cx = b.x + b.width / 2
    const flipped = flipParts(g, 'h')
    close(world(flipped), world(g).map((q) => ({ x: 2 * cx - q.x, y: q.y })))
    const fb = groupBounds(flipped)!
    expect(fb.x).toBeCloseTo(b.x, 6)
    expect(fb.width).toBeCloseTo(b.width, 6)
    expect(flipped.every((p) => p.groupId === 'g')).toBe(true)
  })

  it('Spiegelung bleibt bei Weld, Zerlegen und Schnittauftrag erhalten', () => {
    const p = mk(30, 20, 20, 10, { rotation: 20, scaleX: 2, scaleY: 1 })
    const [f] = flipParts([p], 'h')
    const before = pathsBox(partPaths(f))!
    const welded = weldPart(f)
    const wb = pathsBox(partPaths(welded))!
    expect(wb.x).toBeCloseTo(before.x, 2); expect(wb.width).toBeCloseTo(before.width, 2)
    expect(welded.scaleX).toBeUndefined()
    const job = buildJob([f], wa, cut)
    const jb = pathsBox(job.paths)!
    expect(jb.x).toBeCloseTo(before.x, 2)
    expect(splitPart(f).length).toBeGreaterThanOrEqual(1)
  })
})

describe('Freies Skalieren (scaleX/scaleY)', () => {
  it('fehlendes scaleX/scaleY = scale; Größe und Bounds berücksichtigen beide Achsen', () => {
    const p = mk(0, 0, 10, 20, { scale: 2 })
    expect(partScale(p)).toEqual({ x: 2, y: 2 })
    const q = withScale(p, 3, 1)
    expect(partSize(q)).toEqual({ w: 30, h: 20 })
    expect(partBounds(q).width).toBeCloseTo(30, 9)
    expect(withScale(p, 2.5, 2.5).scaleX).toBeUndefined()
  })

  it('ungleiche Skalierung wirkt vor der Drehung (keine Scherung)', () => {
    const p = withScale(mk(0, 0, 10, 10, { paths: [{ closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }] }), 3, 1)
    const r = { ...p, rotation: 90 }
    const pts = partPaths(r)[0].points
    // Rechteck 30 x 10 um 90° gedreht: Kanten bleiben rechtwinklig
    const e1 = { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y }
    const e2 = { x: pts[2].x - pts[1].x, y: pts[2].y - pts[1].y }
    expect(e1.x * e2.x + e1.y * e2.y).toBeCloseTo(0, 6)
    expect(Math.hypot(e1.x, e1.y)).toBeCloseTo(30, 6)
    expect(Math.hypot(e2.x, e2.y)).toBeCloseTo(10, 6)
    const b = partBounds(r)
    expect(b.width).toBeCloseTo(10, 6); expect(b.height).toBeCloseTo(30, 6)
  })

  it('Gruppen skalieren weiterhin proportional (auch Teile mit ungleichem Maßstab)', () => {
    const g = [mk(10, 10, 20, 10, { groupId: 'g', scaleX: 2, scaleY: 1, scale: 1.4 }), mk(50, 20, 10, 10, { groupId: 'g' })]
    const s = scaleGroup(g, 2)
    expect(partScale(s[0])).toEqual({ x: 4, y: 2 })
    expect(groupBounds(s)!.width).toBeCloseTo(groupBounds(g)!.width * 2, 6)
    const r = rotateGroup(s, 45)
    expect(partScale(r[0])).toEqual({ x: 4, y: 2 })
  })

  it('Projektformat: optional, abwärtskompatibel, Roundtrip', () => {
    const data = { parts: [withScale(mk(5, 5, 10, 10), 2, 0.5), mk(40, 5, 10, 10)], workArea: wa, cut, weldOnImport: true }
    const back = parseProject(serializeProject(data))
    expect(partScale(back.parts[0])).toEqual({ x: 2, y: 0.5 })
    expect(back.parts[1].scaleX).toBeUndefined()
    const json = JSON.parse(serializeProject(data))
    expect('scaleX' in json.parts[1]).toBe(false) // alte Dateien/Teile ohne neue Felder
    // Alte Datei ohne scaleX/scaleY lädt weiter
    json.parts[0].scaleX = -3; json.parts[0].scaleY = 'x'
    const old = parseProject(JSON.stringify(json))
    expect(old.parts[0].scaleX).toBeUndefined()
    expect(old.parts[0].scaleY).toBeUndefined()
    expect(partScale(old.parts[0]).x).toBe(old.parts[0].scale)
  })
})

describe('buildJob: Optionen', () => {
  const a = mk(150, 5, 10, 10), b = mk(5, 5, 10, 10), c = mk(80, 5, 10, 10)
  it('ohne Optimierung bleibt die Reihenfolge der Teile', () => {
    const job = buildJob([a, b, c], wa, cut, { optimize: false })
    expect(job.paths.map((p) => Math.min(...p.points.map((q) => q.x)))).toEqual([150, 5, 80])
  })
  it('mit Optimierung (Standard) wird nach Nähe sortiert', () => {
    const job = buildJob([a, b, c], wa, cut)
    expect(job.paths.map((p) => Math.min(...p.points.map((q) => q.x)))).toEqual([5, 80, 150])
  })
  it('nicht optimiert: innere Konturen trotzdem vor äußeren', () => {
    const p = mk(0, 0, 50, 50, { paths: [
      { closed: true, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }] },
      { closed: true, points: [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 20, y: 30 }] }] })
    const job = buildJob([p], wa, cut, { optimize: false })
    expect(Math.max(...job.paths[0].points.map((q) => q.x))).toBe(30)
  })
  it('Spiegeln: nur im Auftrag, an der Mattenmitte; Dokument bleibt', () => {
    const p = mk(10, 20, 30, 40)
    const orig = JSON.stringify(p)
    const job = buildJob([p], wa, cut, { mirror: true })
    const xs = job.paths[0].points.map((q) => q.x)
    expect(Math.min(...xs)).toBeCloseTo(wa.width - 40, 9)
    expect(Math.max(...xs)).toBeCloseTo(wa.width - 10, 9)
    expect(JSON.stringify(p)).toBe(orig)
    const plain = buildJob([p], wa, cut)
    expect(mirrorJobPaths(plain.paths, wa)[0].points.map((q) => q.x)).toEqual(xs)
    expect(job.paths[0].points.map((q) => q.y)).toEqual(plain.paths[0].points.map((q) => q.y))
  })
  it('Auswahl: nur übergebene Teile', () => {
    expect(buildJob([a], wa, cut).paths).toHaveLength(1)
  })
})

describe('Materialprofile', () => {
  const c1: CutSettings = { blade: 2, force: 12, speed: 4, passes: 2, overcut: 0.3 }
  it('speichern, überschreiben, umbenennen, löschen', () => {
    let r = upsertProfile([], '  Mein   Vinyl ', c1)
    expect(r.list).toEqual([{ name: 'Mein Vinyl', cut: c1 }])
    r = upsertProfile(r.list, 'mein vinyl', { ...c1, force: 20 })
    expect(r.replaced).toBe(true)
    expect(r.list).toHaveLength(1)
    expect(r.list[0].cut.force).toBe(20)
    const r2 = upsertProfile(r.list, 'Folie', c1)
    const ren = renameProfile(r2.list, 'Folie', 'Glitzer')
    expect(ren.list.map((p) => p.name)).toEqual(['Mein Vinyl', 'Glitzer'])
    expect(renameProfile(r2.list, 'Folie', 'mein vinyl').error).toMatch(/gibt es bereits/)
    expect(deleteProfile(ren.list, 'glitzer').map((p) => p.name)).toEqual(['Mein Vinyl'])
  })
  it('lehnt leere Namen und Namen eingebauter Materialien ab', () => {
    expect(upsertProfile([], '   ', c1).error).toBeTruthy()
    expect(upsertProfile([], 'vinyl', c1).error).toMatch(/eingebauten/)
    expect(renameProfile([{ name: 'A', cut: c1 }], 'A', 'Karton').error).toMatch(/eingebauten/)
  })
  it('sanitizeProfiles: ungültige Einträge, Duplikate und Bereichsgrenzen', () => {
    const out = sanitizeProfiles([
      { name: 'Ok', cut: { ...c1, force: 99 } }, { name: 'ok', cut: c1 }, { name: 'Karton', cut: c1 },
      { name: 5, cut: c1 }, { name: 'Kaputt', cut: { blade: 'x' } }, null, 'x'
    ])
    expect(out).toHaveLength(1)
    expect(out[0].cut.force).toBe(33)
    expect(sanitizeProfiles(undefined)).toEqual([])
  })
  it('findMatchingProfile bevorzugt eigene Profile', () => {
    const m = findMatchingProfile(BUILTIN_MATERIALS[0].cut, [])
    expect(m?.builtin).toBe(true)
    const custom = [{ name: 'X', cut: { ...BUILTIN_MATERIALS[0].cut } }]
    expect(findMatchingProfile(BUILTIN_MATERIALS[0].cut, custom)?.builtin).toBe(false)
    expect(findMatchingProfile({ ...c1, blade: 9 }, custom)).toBeNull()
  })
})

describe('Text', () => {
  const dir = join(__dirname, '../renderer/assets/fonts')
  const load = (f: string): TextFont => {
    const b = readFileSync(join(dir, f))
    return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) as unknown as TextFont
  }
  const open = load('OpenSans-Bold.ttf')
  const closed = (paths: Polyline[]): Polyline[] => paths.filter((p) => p.closed)
  /** Anzahl der Konturen, die innerhalb einer anderen liegen (Löcher). */
  const holes = (paths: Polyline[]): number => closed(paths).filter((p, i) => closed(paths).some((o, j) => j !== i && pointInPolygon(p.points[0], o.points))).length

  it('„Ao“ als Buchstaben: Loch im A und im o', () => {
    const { parts, missing } = textToParts(open, 'Ao', { sizeMm: 40, asGroup: true })
    expect(missing).toEqual([])
    expect(parts).toHaveLength(2)
    expect(parts[0].groupId).toBeTruthy()
    expect(parts[0].groupId).toBe(parts[1].groupId)
    for (const p of parts) {
      expect(closed(p.paths)).toHaveLength(2)
      expect(holes(p.paths)).toBe(1)
    }
  })

  it('„Ao0“ als ein Bauteil: drei Löcher, Außenkonturen bleiben', () => {
    const { parts } = textToParts(open, 'Ao0', { sizeMm: 30 })
    expect(parts).toHaveLength(1)
    expect(closed(parts[0].paths)).toHaveLength(6)
    expect(holes(parts[0].paths)).toBe(3)
  })

  it('Schriftgröße = Höhe der Großbuchstaben', () => {
    for (const f of ['OpenSans-Bold.ttf', 'BebasNeue-Regular.ttf', 'Pacifico-Regular.ttf']) {
      const font = load(f)
      const { parts } = textToParts(font, 'H', { sizeMm: 25 })
      // Serifen-/Blockschriften exakt; die Schreibschrift hat am „H“ kleine Unterschwinger unter der Grundlinie
      expect(Math.abs(parts[0].height - 25)).toBeLessThan(f.startsWith('Pacifico') ? 1 : 0.05)
      expect(capHeightUnits(font)).toBeGreaterThan(0)
    }
    expect(textToParts(open, 'HH', { sizeMm: 10 }).parts[0].width).toBeLessThan(textToParts(open, 'HH', { sizeMm: 20 }).parts[0].width)
  })

  it('Zeichenabstand, mehrere Zeilen, fehlende Zeichen', () => {
    const w0 = textToParts(open, 'HH', { sizeMm: 20 }).parts[0].width
    const w1 = textToParts(open, 'HH', { sizeMm: 20, letterSpacingMm: 5 }).parts[0].width
    expect(w1 - w0).toBeCloseTo(5, 1)
    const one = textToParts(open, 'H', { sizeMm: 20 }).parts[0]
    const two = textToParts(open, 'H\nH', { sizeMm: 20 }).parts[0]
    expect(two.height).toBeGreaterThan(one.height * 1.8)
    const miss = textToParts(open, 'A\u{1F600}', { sizeMm: 20 })
    expect(miss.missing).toEqual(['\u{1F600}'])
    expect(miss.parts).toHaveLength(1)
    expect(textToParts(open, '   ', { sizeMm: 20 }).parts).toEqual([])
    expect(() => textToParts(open, 'A', { sizeMm: 0 })).toThrow(/Schriftgröße/)
  })

  it('Buchstaben als Gruppe liegen wie im Textblock (Reihenfolge links nach rechts)', () => {
    const { parts } = textToParts(open, 'AB', { sizeMm: 20, asGroup: true })
    expect(parts[1].x).toBeGreaterThan(parts[0].x + parts[0].width * 0.5)
    expect(groupParts(parts, parts.map((p) => p.id)).length).toBe(2)
    expect(normalizeGroups(parts)).toHaveLength(2)
  })
})

describe('Fehlertoleranz Import', () => {
  const svg = (inner: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`
  it('leere/kaputte Dateien: verständliche deutsche Meldung', () => {
    expect(() => importSvg('', 'a.svg', 'a.svg')).toThrow(/leer/)
    expect(() => importSvg('   \n', 'a.svg', 'a.svg')).toThrow(/leer/)
    expect(() => importSvg('<svg><path', 'a.svg', 'a.svg')).toThrow(/Die /)
    expect(() => importSvg('hallo', 'a.svg', 'a.svg')).toThrow(/keine gültige SVG/)
    expect(() => importSvg(svg(''), 'a.svg', 'a.svg')).toThrow(/keine schneidbaren Pfade/)
    expect(() => importSvg(svg('<text>Hi</text><image href="x.png"/>'), 'a.svg', 'a.svg')).toThrow(/keine schneidbaren Pfade/)
  })
  it('zu große Datei (> 20 MB) wird abgelehnt', () => {
    expect(() => assertImportSize(20 * 1024 * 1024 + 1, 'Die Datei')).toThrow(/zu groß \(maximal 20 MB\)/)
    expect(() => assertImportSize(1024)).not.toThrow()
    expect(() => importSvg(' '.repeat(21 * 1024 * 1024), 'a.svg', 'a.svg')).toThrow(/zu groß/)
  })
  it('Pfade mit NaN/Infinity werden verworfen, der Rest importiert', () => {
    const notices: string[] = []
    const parts = importSvg(svg('<path d="M 0 0 L 1e999 5 L 10 10 Z"/><rect x="10" y="10" width="20" height="20"/>'), 'a.svg', 'a.svg', { onNotice: (m) => notices.push(m) })
    expect(parts).toHaveLength(1)
    expect(parts[0].paths.every((p) => p.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)))).toBe(true)
    expect(() => importSvg(svg('<path d="M 0 0 L NaN NaN L 1e999 1e999 Z"/>'), 'a.svg', 'a.svg')).toThrow(/keine schneidbaren Pfade/)
    expect(() => importSvg(svg('<path d="M 0 0 L 1e30 5 L 10 10 Z"/>'), 'a.svg', 'a.svg')).not.toThrow(/Coordinate/)
  })
  it('absurd große Koordinaten lassen Clipper nicht abstürzen', () => {
    const notices: string[] = []
    const parts = importSvg(svg('<polygon points="0,0 1e12,0 1e12,1e12"/><rect x="1" y="1" width="9" height="9"/>'), 'a.svg', 'a.svg', { onNotice: (m) => notices.push(m) })
    expect(parts).toHaveLength(1)
    expect(notices.join(' ')).toMatch(/ungültig/)
  })
  it('Douglas-Peucker und Punktelimit', () => {
    const line: Point[] = Array.from({ length: 1000 }, (_, i) => ({ x: i * 0.1, y: Math.sin(i * 0.001) * 0.001 }))
    expect(douglasPeucker(line, 0.02)).toHaveLength(2)
    const circle: Polyline = { closed: true, points: Array.from({ length: 5000 }, (_, i) => ({ x: 50 * Math.cos(i / 5000 * 2 * Math.PI), y: 50 * Math.sin(i / 5000 * 2 * Math.PI) })) }
    const lim = limitPoints([circle], 1000)
    expect(lim.simplified).toBe(true)
    expect(lim.after).toBeLessThan(500)
    expect(lim.paths[0].points.length).toBeGreaterThanOrEqual(3)
    // Abweichung höchstens 0,02 mm + Sehnenfehler
    const r = lim.paths[0].points.map((q) => Math.hypot(q.x, q.y))
    expect(Math.min(...r)).toBeGreaterThan(49.97)
    expect(limitPoints([circle]).simplified).toBe(false)
  })
  it('viele Punkte (> 200k) werden beim SVG-Import vereinfacht', () => {
    const n = 210_000
    const pts: string[] = []
    for (let i = 0; i < n; i++) pts.push(`${(50 + 40 * Math.cos((i / n) * 2 * Math.PI)).toFixed(4)},${(50 + 40 * Math.sin((i / n) * 2 * Math.PI)).toFixed(4)}`)
    const notices: string[] = []
    const parts = importSvg(svg(`<polygon fill="none" points="${pts.join(' ')}"/>`), 'big.svg', 'big.svg', { onNotice: (m) => notices.push(m), weld: false })
    expect(parts).toHaveLength(1)
    expect(parts[0].paths[0].points.length).toBeLessThan(20_000)
    expect(notices.join(' ')).toMatch(/vereinfacht/)
  })
})
