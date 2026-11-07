import { describe, expect, it } from 'vitest'
import type { CutSettings, Part, Point, Polyline } from '@shared/types'
import { DEFAULT_BORDER } from '@shared/types'
import {
  addBorderToParts, buildBorder, buildJob, duplicateParts, flipParts, groupBounds, groupParts, hasBorder, importSvg, makeBorder, normalizeGroups,
  outOfBoundsUnits, parseProject, partBounds, partPaths, removeBorderFromParts, rotateGroup, sanitizeBorder, scaleGroup, serializeProject,
  splitPart, translateParts, ungroupParts, weldPart
} from './index'
import { pathsBox } from './geom'
import { letteringSvg } from './sampleSvgs'

let seq = 0
const sq = (x: number, y: number, w: number, h: number): Polyline => ({ closed: true, points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] })
function mk(x: number, y: number, w: number, h: number, paths: Polyline[] = [sq(0, 0, w, h)], extra: Partial<Part> = {}): Part {
  return { id: `b${seq++}`, name: 'Teil', sourcePath: 'a.svg', paths, width: w, height: h, x, y, rotation: 0, scale: 1, ...extra }
}
const tri = (x: number, y: number, extra: Partial<Part> = {}): Part =>
  mk(x, y, 20, 10, [{ closed: true, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 10 }] }], extra)
const circle = (cx: number, cy: number, r: number, n = 96): Polyline => ({
  closed: true, points: Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((i / n) * Math.PI * 2), y: cy + r * Math.sin((i / n) * Math.PI * 2) }))
})
const worldBox = (p: Part) => pathsBox(partPaths(p))!
const border = (parts: Part[]): Part[] => parts.filter((p) => p.role === 'border')
const RECT = { mode: 'rect' as const, offsetMm: 3 }

describe('Schnittrand: Rechteck', () => {
  it('liegt 3 mm um die Außenkanten, ist ein geschlossener, ungefüllter Pfad und hat role border', () => {
    const b = makeBorder([mk(10, 20, 30, 40)], RECT)
    expect(b.role).toBe('border')
    expect(b.paths).toHaveLength(1)
    expect(b.paths[0].closed).toBe(true)
    expect(b.paths[0].filled).toBe(false)
    const w = worldBox(b)
    expect(w.x).toBeCloseTo(7); expect(w.y).toBeCloseTo(17); expect(w.width).toBeCloseTo(36); expect(w.height).toBeCloseTo(46)
    expect(b.name).toBe('Teil – Rand')
    expect(b.paths[0].points.every((q) => q.x >= -1e-9 && q.y >= -1e-9)).toBe(true)
  })

  it('nimmt die enge Außenform der gedrehten Pfade, nicht die lose Part-Box', () => {
    const p = tri(30, 30, { rotation: 30 })
    const tight = pathsBox(partPaths(p))!
    const loose = partBounds(p)
    expect(tight.width * tight.height).toBeLessThan(loose.width * loose.height - 5)
    const w = worldBox(makeBorder([p], RECT))
    expect(w.x).toBeCloseTo(tight.x - 3, 4); expect(w.y).toBeCloseTo(tight.y - 3, 4)
    expect(w.width).toBeCloseTo(tight.width + 6, 4); expect(w.height).toBeCloseTo(tight.height + 6, 4)
  })

  it('berücksichtigt Skalierung (auch ungleich) und Spiegelung', () => {
    const p = { ...tri(5, 5), scaleX: 2, scaleY: 0.5, scale: 1 }
    const [f] = flipParts([p], 'h')
    for (const q of [p, f]) {
      const t = pathsBox(partPaths(q))!
      const w = worldBox(makeBorder([q], RECT))
      expect(w.x).toBeCloseTo(t.x - 3, 4); expect(w.width).toBeCloseTo(t.width + 6, 4); expect(w.height).toBeCloseTo(t.height + 6, 4)
    }
  })

  it('umschließt mehrere Einheiten mit einem gemeinsamen Rechteck', () => {
    const w = worldBox(makeBorder([mk(0, 0, 10, 10), mk(50, 30, 10, 10)], RECT))
    expect(w.x).toBeCloseTo(-3); expect(w.width).toBeCloseTo(66); expect(w.height).toBeCloseTo(46)
  })

  it('rundet Ecken ab (Polylinie mit Bogenzerlegung), Radius 0 bleibt eckig', () => {
    const sharp = makeBorder([mk(0, 0, 20, 20)], { ...RECT, cornerRadiusMm: 0 })
    expect(sharp.paths[0].points).toHaveLength(4)
    const round = makeBorder([mk(0, 0, 20, 20)], { ...RECT, cornerRadiusMm: 3 })
    expect(round.paths[0].points.length).toBeGreaterThan(20)
    const w = worldBox(round)
    expect(w.width).toBeCloseTo(26, 4)
    // Ecke (-3,-3) ist abgeschnitten
    expect(round.paths[0].points.every((q) => Math.hypot(q.x, q.y) > 1)).toBe(true)
    // zu großer Radius wird begrenzt (kein Überlappen)
    const huge = makeBorder([mk(0, 0, 4, 4)], { ...RECT, cornerRadiusMm: 99 })
    expect(worldBox(huge).width).toBeCloseTo(10, 4)
  })

  it('ignoriert vorhandene Rand-Teile als Basisform', () => {
    const src = mk(0, 0, 10, 10)
    const first = makeBorder([src], RECT)
    const again = makeBorder([src, first], RECT)
    expect(worldBox(again).width).toBeCloseTo(worldBox(first).width, 6)
    expect(() => buildBorder([first], RECT)).toThrow()
  })
})

describe('Schnittrand: Kontur-Offset', () => {
  it('folgt einem Kreis im Abstand von 3 mm (runde Ecken)', () => {
    const p = mk(0, 0, 20, 20, [circle(10, 10, 10)])
    const r = buildBorder([p], { mode: 'offset', offsetMm: 3 })
    expect(r.mode).toBe('offset')
    expect(r.fellBack).toBe(false)
    expect(r.part.paths).toHaveLength(1)
    const c = partPaths({ ...r.part })[0].points
    const ctr = { x: 10, y: 10 }
    for (const q of c) expect(Math.hypot(q.x - ctr.x, q.y - ctr.y)).toBeGreaterThan(12.9)
    for (const q of c) expect(Math.hypot(q.x - ctr.x, q.y - ctr.y)).toBeLessThan(13.1)
  })

  it('verschiebt eine Raute ohne Spitzen abzuschneiden (rund) und bleibt ungefüllt/geschlossen', () => {
    const p = mk(0, 0, 20, 20, [{ closed: true, points: [{ x: 10, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 10 }] }])
    const b = makeBorder([p], { mode: 'offset', offsetMm: 3 })
    const w = worldBox(b)
    expect(w.width).toBeCloseTo(26, 1)
    expect(b.paths.every((pl) => pl.closed && pl.filled === false)).toBe(true)
  })

  it('verwirft Löcher: Teil mit Loch bekommt nur eine äußere Kontur', () => {
    const ring: Polyline[] = [
      { ...sq(0, 0, 30, 30), src: 0, evenOdd: true },
      { ...sq(10, 10, 10, 10), src: 0, evenOdd: true }
    ]
    const b = makeBorder([mk(0, 0, 30, 30, ring)], { mode: 'offset', offsetMm: 3 })
    expect(b.paths).toHaveLength(1)
    expect(worldBox(b).width).toBeCloseTo(36, 1)
    // Insel im Loch (anderes Teil) bekommt keine eigene Kontur
    const island = mk(12, 12, 6, 6)
    const b2 = makeBorder([mk(0, 0, 30, 30, ring), island], { mode: 'offset', offsetMm: 1 })
    expect(b2.paths).toHaveLength(1)
  })

  it('getrennte Flächen: eine Kontur je zusammenhängender Fläche, nahe Flächen verschmelzen', () => {
    const far = makeBorder([mk(0, 0, 10, 10), mk(40, 0, 10, 10)], { mode: 'offset', offsetMm: 3 })
    expect(far.paths).toHaveLength(2)
    const near = makeBorder([mk(0, 0, 10, 10), mk(12, 0, 10, 10)], { mode: 'offset', offsetMm: 3 })
    expect(near.paths).toHaveLength(1)
  })

  it('überlappende Teile mit gleicher src-Nummer verschmelzen korrekt (keine Even-Odd-Auslöschung)', () => {
    const a = mk(0, 0, 20, 20, [{ ...sq(0, 0, 20, 20), src: 0 }])
    const c = mk(10, 10, 20, 20, [{ ...sq(0, 0, 20, 20), src: 0 }])
    const b = makeBorder([a, c], { mode: 'offset', offsetMm: 2 })
    expect(b.paths).toHaveLength(1)
    expect(worldBox(b).width).toBeCloseTo(34, 1)
  })

  it('reine Linienkunst fällt auf das Rechteck zurück', () => {
    const line = mk(0, 0, 20, 10, [{ closed: false, points: [{ x: 0, y: 0 }, { x: 20, y: 10 }] }, { ...sq(0, 0, 20, 10), filled: false }])
    const r = buildBorder([line], { mode: 'offset', offsetMm: 3 })
    expect(r.fellBack).toBe(true)
    expect(r.mode).toBe('rect')
    expect(worldBox(r.part).width).toBeCloseTo(26, 4)
  })

  it('offene Linien neben gefüllten Flächen werden mit umschlossen', () => {
    const p = mk(0, 0, 40, 10, [sq(0, 0, 10, 10), { closed: false, points: [{ x: 15, y: 5 }, { x: 40, y: 5 }] }])
    const b = makeBorder([p], { mode: 'offset', offsetMm: 3 })
    expect(worldBox(b).width).toBeCloseTo(46, 1)
  })

  it('Text (Schriftzug) liefert eine Kontur je Buchstabengruppe, ohne Innenlöcher', () => {
    const [whole] = importSvg(letteringSvg(), 'schriftzug.svg', 'schriftzug.svg', { split: false, weld: true })
    const b = makeBorder([whole], { mode: 'offset', offsetMm: 3 })
    expect(b.paths.length).toBeGreaterThanOrEqual(1)
    expect(b.paths.length).toBeLessThanOrEqual(whole.paths.length)
    const tb = pathsBox(partPaths(whole))!
    const bb = worldBox(b)
    expect(bb.x).toBeLessThan(tb.x - 2.9); expect(bb.x + bb.width).toBeGreaterThan(tb.x + tb.width + 2.9)
    const r = makeBorder([whole], RECT)
    expect(worldBox(r).width).toBeCloseTo(tb.width + 6, 4)
  })
})

describe('addBorderToParts / removeBorderFromParts', () => {
  it('Einzelteil: Rand + Teil werden zu einer Gruppe', () => {
    const a = mk(10, 10, 20, 20)
    const r = addBorderToParts([a], [a.id], RECT)!
    expect(r.parts).toHaveLength(2)
    const [bd] = border(r.parts)
    const src = r.parts.find((p) => p.id === a.id)!
    expect(bd.groupId).toBeTruthy()
    expect(src.groupId).toBe(bd.groupId)
    expect(r.selection.sort()).toEqual([a.id, bd.id].sort())
    expect(r.replaced).toBe(false)
    expect(r.grouped).toBe(false)
  })

  it('Gruppe: Rand kommt in dieselbe Gruppe', () => {
    const base = groupParts([mk(0, 0, 10, 10), mk(20, 0, 10, 10)], [])
    const parts = [mk(0, 0, 10, 10), mk(20, 0, 10, 10)]
    const g = groupParts(parts, parts.map((p) => p.id), 'G1')
    expect(base).toHaveLength(2)
    const r = addBorderToParts(g, [g[0].id], RECT)!
    expect(r.parts).toHaveLength(3)
    expect(r.parts.every((p) => p.groupId === 'G1')).toBe(true)
    expect(worldBox(border(r.parts)[0]).width).toBeCloseTo(36, 4)
    expect(r.grouped).toBe(false)
  })

  it('Mehrfachauswahl loser Teile: ein gemeinsamer Rand, alle zu einer Gruppe verbunden', () => {
    const a = mk(0, 0, 10, 10), b = mk(30, 0, 10, 10), c = mk(100, 100, 5, 5)
    const r = addBorderToParts([a, b, c], [a.id, b.id], RECT)!
    const bd = border(r.parts)
    expect(bd).toHaveLength(1)
    expect(r.grouped).toBe(true)
    const gid = bd[0].groupId
    expect(r.parts.filter((p) => p.groupId === gid)).toHaveLength(3)
    expect(r.parts.find((p) => p.id === c.id)!.groupId).toBeUndefined()
  })

  it('vorhandener Rand wird ersetzt (kein Rand um den Rand)', () => {
    const a = mk(10, 10, 20, 20)
    const r1 = addBorderToParts([a], [a.id], RECT)!
    expect(hasBorder(r1.parts, [a.id])).toBe(true)
    const r2 = addBorderToParts(r1.parts, [a.id], { mode: 'rect', offsetMm: 6 })!
    expect(r2.replaced).toBe(true)
    expect(border(r2.parts)).toHaveLength(1)
    expect(r2.parts).toHaveLength(2)
    expect(worldBox(border(r2.parts)[0]).width).toBeCloseTo(32, 4)
    expect(border(r2.parts)[0].groupId).toBe(r2.parts.find((p) => p.id === a.id)!.groupId)
  })

  it('nur den Rand gewählt: Auswahl wird auf die Gruppe erweitert und der Rand ersetzt', () => {
    const a = mk(0, 0, 10, 10)
    const r1 = addBorderToParts([a], [a.id], RECT)!
    const r2 = addBorderToParts(r1.parts, [r1.borderId], { mode: 'rect', offsetMm: 5 })!
    expect(border(r2.parts)).toHaveLength(1)
    expect(worldBox(border(r2.parts)[0]).width).toBeCloseTo(20, 4)
  })

  it('nur ein Rand ohne Basis: null', () => {
    const lone = { ...makeBorder([mk(0, 0, 5, 5)], RECT) }
    expect(addBorderToParts([lone], [lone.id], RECT)).toBeNull()
  })

  it('Rand entfernen stellt den Einzelteil-Zustand wieder her (ohne Gruppe)', () => {
    const a = mk(0, 0, 10, 10)
    const r = addBorderToParts([a], [a.id], RECT)!
    const rm = removeBorderFromParts(r.parts, [a.id])
    expect(rm.removed).toBe(1)
    expect(rm.parts).toHaveLength(1)
    expect(rm.parts[0].groupId).toBeUndefined()
    expect(rm.selection).toEqual([a.id])
    expect(removeBorderFromParts(rm.parts, [a.id]).removed).toBe(0)
  })

  it('Gruppe aufheben: Rand wird ein normales Teil (ohne Rolle); alleiniger Rand verliert die Rolle', () => {
    const a = mk(0, 0, 10, 10)
    const r = addBorderToParts([a], [a.id], RECT)!
    const un = ungroupParts(r.parts, [a.id])
    expect(un.every((p) => !p.groupId && !p.role)).toBe(true)
    const onlyBorder = normalizeGroups(r.parts.filter((p) => p.role === 'border'))
    expect(onlyBorder[0].role).toBeUndefined()
    expect(onlyBorder[0].groupId).toBeUndefined()
  })

  it('Duplizieren erhält Rolle und bildet eine neue Gruppe', () => {
    const a = mk(0, 0, 10, 10)
    const r = addBorderToParts([a], [a.id], RECT)!
    const copies = duplicateParts(r.parts, 8, 8)
    expect(border(copies)).toHaveLength(1)
    expect(copies[0].groupId).toBe(copies[1].groupId)
    expect(copies[0].groupId).not.toBe(r.parts[0].groupId)
  })
})

describe('Schnittrand folgt der Gruppe', () => {
  const margins = (parts: Part[]): { l: number; t: number; r: number; b: number } => {
    const bd = border(parts)[0]
    const src = parts.filter((p) => p.role !== 'border')
    const bb = worldBox(bd)
    const sb = pathsBox(src.flatMap((p) => partPaths(p)))!
    return { l: sb.x - bb.x, t: sb.y - bb.y, r: bb.x + bb.width - (sb.x + sb.width), b: bb.y + bb.height - (sb.y + sb.height) }
  }
  const setup = (): Part[] => {
    const a = mk(10, 10, 20, 10), b = tri(50, 40)
    return addBorderToParts([a, b], [a.id, b.id], RECT)!.parts
  }

  it('Verschieben, Drehen (90°), Skalieren und Spiegeln halten den Abstand (Skalierung proportional)', () => {
    const base = setup()
    const m0 = margins(base)
    expect(m0.l).toBeCloseTo(3, 4)
    expect(margins(translateParts(base, 17, -4)).r).toBeCloseTo(3, 4)
    const rot = margins(rotateGroup(base, 90))
    for (const v of Object.values(rot)) expect(v).toBeCloseTo(3, 3)
    const sc = margins(scaleGroup(base, 2))
    for (const v of Object.values(sc)) expect(v).toBeCloseTo(6, 3)
    const fl = margins(flipParts(base, 'h'))
    for (const v of Object.values(fl)) expect(v).toBeCloseTo(3, 3)
  })

  it('Außerhalb-Prüfung berücksichtigt den Rand (Teil innen, Rand ragt über die Matte)', () => {
    const a = mk(1, 50, 20, 20)
    const parts = addBorderToParts([a], [a.id], RECT)!.parts
    const wa = { name: 't', width: 200, height: 200 }
    expect(a.x).toBeGreaterThanOrEqual(0)
    expect(outOfBoundsUnits([a], wa)).toHaveLength(0)
    expect(outOfBoundsUnits(parts, wa)).toHaveLength(1)
    expect(groupBounds(parts)!.x).toBeCloseTo(-2, 4)
  })
})

describe('Weld und Zerlegen lassen den Rand unverändert', () => {
  it('weldPart / splitPart geben role=border unverändert zurück', () => {
    const b = makeBorder([mk(0, 0, 10, 10), mk(40, 0, 10, 10)], { mode: 'offset', offsetMm: 3 })
    expect(weldPart(b)).toBe(b)
    expect(splitPart(b)).toEqual([b])
  })
})

describe('Schnittreihenfolge', () => {
  const settings: CutSettings = { blade: 3, force: 10, speed: 5, passes: 1, overcut: 0 }
  const wa = { name: 't', width: 300, height: 300 }
  const isBorderPath = (pl: Polyline, bd: Part): boolean => {
    const w = worldBox(bd)
    const b = pathsBox([pl])!
    return Math.abs(b.width - w.width) < 1e-6 && Math.abs(b.x - w.x) < 1e-6
  }

  for (const optimize of [true, false]) {
    it(`Rand wird innerhalb seiner Gruppe zuletzt geschnitten (optimize=${optimize})`, () => {
      const a = mk(10, 10, 20, 20), b = mk(40, 10, 20, 20)
      const r = addBorderToParts([a, b], [a.id, b.id], RECT)!
      const bd = border(r.parts)[0]
      // Rand steht in der Liste VOR den Teilen – muss trotzdem zuletzt kommen
      const list = [bd, ...r.parts.filter((p) => p.role !== 'border')]
      const job = buildJob(list, wa, settings, { optimize })
      expect(job.paths).toHaveLength(3)
      expect(isBorderPath(job.paths[2], bd)).toBe(true)
      expect(isBorderPath(job.paths[0], bd)).toBe(false)
    })
  }

  it('zwei Einheiten bleiben zusammenhängend, jede mit Rand zuletzt', () => {
    const a = mk(10, 10, 20, 20), c = mk(150, 10, 20, 20)
    const r1 = addBorderToParts([a, c], [a.id], RECT)!
    const r2 = addBorderToParts(r1.parts, [c.id], RECT)!
    const job = buildJob(r2.parts, wa, settings)
    expect(job.paths).toHaveLength(4)
    const widths = job.paths.map((p) => Math.round(pathsBox([p])!.width))
    expect(widths).toEqual([20, 26, 20, 26])
  })
})

describe('Projektdatei', () => {
  const data = (parts: Part[]) => ({ parts, workArea: { name: 'x', width: 200, height: 200 }, cut: { blade: 3, force: 10, speed: 5, passes: 1, overcut: 0 }, weldOnImport: true })

  it('Roundtrip erhält role=border', () => {
    const a = mk(0, 0, 10, 10)
    const parts = addBorderToParts([a], [a.id], RECT)!.parts
    const back = parseProject(serializeProject(data(parts))).parts
    expect(border(back)).toHaveLength(1)
    expect(back.find((p) => p.role === 'border')!.paths[0].filled).toBe(false)
    expect(back.find((p) => p.role === 'border')!.groupId).toBe(back.find((p) => p.id === a.id)!.groupId)
  })

  it('alte Dateien ohne role laden unverändert; ohne role schreibt die Datei kein Feld', () => {
    const a = mk(0, 0, 10, 10)
    const json = serializeProject(data([a]))
    expect(json).not.toContain('role')
    const back = parseProject(json).parts
    expect(back[0].role).toBeUndefined()
  })

  it('role=border ohne Gruppe (kaputt/gelöschte Quelle) wird zum normalen Teil', () => {
    const b = { ...makeBorder([mk(0, 0, 10, 10)], RECT) }
    const back = parseProject(serializeProject(data([b]))).parts
    expect(back[0].role).toBeUndefined()
    const raw = JSON.parse(serializeProject(data([b]))) as { parts: Record<string, unknown>[] }
    raw.parts[0].role = 'quatsch'
    expect(parseProject(JSON.stringify(raw)).parts[0].role).toBeUndefined()
  })
})

describe('Einstellungen', () => {
  it('sanitizeBorder füllt Standardwerte und begrenzt', () => {
    expect(sanitizeBorder(undefined)).toEqual(DEFAULT_BORDER)
    expect(sanitizeBorder({ mode: 'offset', offsetMm: 999, rounded: true, cornerRadiusMm: -2 })).toEqual({ mode: 'offset', offsetMm: 50, rounded: true, cornerRadiusMm: 0.5 })
    expect(sanitizeBorder({ mode: 'x', offsetMm: 'a' })).toEqual(DEFAULT_BORDER)
  })
})

describe('Punkte', () => {
  it('roundedRect liefert keine doppelten Punkte', () => {
    const pts: Point[] = makeBorder([mk(0, 0, 4, 4)], { ...RECT, cornerRadiusMm: 99 }).paths[0].points
    for (let i = 0; i < pts.length; i++) {
      const q = pts[(i + 1) % pts.length]
      expect(Math.hypot(pts[i].x - q.x, pts[i].y - q.y)).toBeGreaterThan(1e-9)
    }
  })
})
