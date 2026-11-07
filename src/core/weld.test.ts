import { describe, expect, it } from 'vitest'
import type { Part, Polyline } from '@shared/types'
import { importSvg, splitPart } from './svg'
import { weldPart } from './weld'
import { polygonArea, pointInPolygon, pointsBox, polylinesCross } from './geom'
import { LETTERING_CONTOURS, LETTERING_ORDER, letteringSvg } from './sampleSvgs'

const wrap = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">${body}</svg>`

const imp = (body: string, weld = true): Part => importSvg(wrap(body), 't.svg', 't', { weld })[0]
const area = (pl: Polyline): number => polygonArea(pl.points)

/** Anzahl Konturen, die innerhalb einer anderen Kontur liegen (= Löcher bzw. Inseln). */
function innerCount(paths: Polyline[]): number {
  let n = 0
  for (const a of paths) {
    const probe = a.points[0]
    if (paths.some((b) => b !== a && area(b) > area(a) && pointInPolygon(probe, b.points))) n++
  }
  return n
}

describe('Weld (Konturen vereinen)', () => {
  it('"3"-artige Form aus zwei überlappenden Rechtecken -> eine Außenkontur', () => {
    const p = imp('<rect x="0" y="0" width="20" height="20"/><rect x="10" y="10" width="20" height="20"/>')
    expect(p.paths).toHaveLength(1)
    expect(p.paths[0].closed).toBe(true)
    expect(area(p.paths[0])).toBeCloseTo(400 + 400 - 100, 0) // viewBox 100 = 100 mm -> mm²
  })

  it('Fläche der Vereinigung stimmt (mm²) und zwei überlappende Kreise ergeben eine Kontur', () => {
    const p = imp('<rect x="0" y="0" width="20" height="20"/><rect x="10" y="10" width="20" height="20"/>')
    expect(p.width).toBeCloseTo(30, 1)
    const c = imp('<circle cx="20" cy="20" r="10"/><circle cx="30" cy="20" r="10"/>')
    expect(c.paths).toHaveLength(1)
    expect(c.width).toBeCloseTo(30, 1)
  })

  it('ohne weld bleiben beide Konturen', () => {
    expect(imp('<rect width="20" height="20"/><rect x="10" y="10" width="20" height="20"/>', false).paths).toHaveLength(2)
  })

  it('"0"/"P" mit Loch (Gegenwindung, nonzero): Außenkontur + 1 Loch bleiben', () => {
    const p = imp('<path d="M10 10H50V60H10Z M20 20V50H40V20Z"/>')
    expect(p.paths).toHaveLength(2)
    expect(innerCount(p.paths)).toBe(1)
  })

  it('P: Schaft überlappt Bauch mit Loch -> Außenkontur + 1 Loch', () => {
    const p = imp('<path d="M10 10H20V60H10Z"/><path d="M10 10H40V35H10Z M20 15V30H35V15Z"/>')
    expect(p.paths).toHaveLength(2)
    expect(innerCount(p.paths)).toBe(1)
  })

  it('gleiche Windungsrichtung + fill-rule nonzero: Innenkontur ist kein Loch (wie gerendert)', () => {
    const p = imp('<path d="M10 10H50V60H10Z M20 20H40V50H20Z"/>')
    expect(p.paths).toHaveLength(1)
  })

  it('evenodd (Attribut): Loch bleibt auch bei gleicher Windungsrichtung', () => {
    const p = imp('<path fill-rule="evenodd" d="M10 10H50V60H10Z M20 20H40V50H20Z"/>')
    expect(p.paths).toHaveLength(2)
    expect(innerCount(p.paths)).toBe(1)
  })

  it('evenodd per style und per geerbtem g-Attribut', () => {
    const a = imp('<path style="fill-rule:evenodd" d="M10 10H50V60H10Z M20 20H40V50H20Z"/>')
    expect(a.paths).toHaveLength(2)
    const b = imp('<g fill-rule="evenodd"><path d="M10 10H50V60H10Z M20 20H40V50H20Z"/></g>')
    expect(b.paths).toHaveLength(2)
  })

  it('Pfade mit unterschiedlicher Füllregel werden je Element aufgelöst', () => {
    // evenodd-Ring links, nonzero-Block (gleiche Winding, ohne Loch) rechts, beide überlappen nicht
    const p = imp('<path fill-rule="evenodd" d="M0 0H30V30H0Z M10 10H20V20H10Z"/><path d="M50 0H80V30H50Z M60 10H70V20H60Z"/>')
    expect(p.paths).toHaveLength(3) // Ring (2) + gefüllter Block (1)
  })

  it('fill="none"-Pfade bleiben unverändert (auch wenn sie überlappen)', () => {
    const body = '<rect width="20" height="20" fill="none" stroke="#000"/><rect x="10" y="10" width="20" height="20" fill="none"/>'
    const p = imp(body)
    expect(p.paths).toHaveLength(2)
    expect(p.paths.every((pl) => pl.filled === false)).toBe(true)
    const q = imp('<style>.l{fill:none}</style><rect class="l" width="20" height="20"/><rect class="l" x="10" y="10" width="20" height="20"/>')
    expect(q.paths).toHaveLength(2)
    const r = imp('<g fill="none"><rect width="20" height="20"/><rect x="10" y="10" width="20" height="20" style="fill:none"/></g>')
    expect(r.paths).toHaveLength(2)
  })

  it('gefüllte und ungefüllte Konturen: nur die gefüllten werden vereint', () => {
    const p = imp('<rect width="20" height="20"/><rect x="10" y="10" width="20" height="20"/><rect x="5" y="5" width="30" height="30" fill="none"/>')
    expect(p.paths).toHaveLength(2)
    expect(p.paths.filter((pl) => pl.filled === false)).toHaveLength(1)
  })

  it('offene Pfade bleiben unverändert', () => {
    const p = imp('<rect width="20" height="20"/><path d="M5 5L50 50" fill="none"/><path d="M0 40L30 40"/>')
    expect(p.paths.filter((pl) => !pl.closed)).toHaveLength(2)
    expect(p.paths).toHaveLength(3)
  })

  it('zwei getrennte Formen bleiben getrennt (auch beim Zerlegen)', () => {
    const svg = wrap('<rect width="20" height="20"/><rect x="40" y="40" width="20" height="20"/>')
    const [one] = importSvg(svg, 'a.svg', 'a')
    expect(one.paths).toHaveLength(2)
    expect(importSvg(svg, 'a.svg', 'a', { split: true })).toHaveLength(2)
  })

  it('aneinanderstoßende Formen verschmelzen (gemeinsame Kante)', () => {
    expect(imp('<rect width="20" height="20"/><rect x="20" width="20" height="20"/>').paths).toHaveLength(1)
  })

  it('Weld vor dem Zerlegen: überlappende Konturen werden ein Teil mit einer Kontur', () => {
    const parts = importSvg(wrap('<rect width="20" height="20"/><rect x="10" y="10" width="20" height="20"/><rect x="60" width="10" height="10"/>'), 'a.svg', 'a', { split: true })
    expect(parts).toHaveLength(2)
    expect(parts[0].paths).toHaveLength(1)
  })

  it('hat keine Kollinear-/Duplikat-Punkte: Rechteckvereinigung hat 8 Ecken', () => {
    const p = imp('<rect width="20" height="20"/><rect x="10" y="10" width="20" height="20"/>')
    expect(p.paths[0].points).toHaveLength(8)
  })

  describe('weldPart', () => {
    it('vereint ein bestehendes Teil und rechnet Skalierung/Drehung ein', () => {
      const [whole] = importSvg(wrap('<rect width="20" height="20"/><rect x="10" y="10" width="20" height="20"/>'), 'a.svg', 'a', { weld: false })
      expect(whole.paths).toHaveLength(2)
      const placed: Part = { ...whole, x: 50, y: 30, scale: 2, rotation: 90 }
      const w = weldPart(placed)
      expect(w.id).toBe(placed.id)
      expect(w.paths).toHaveLength(1)
      expect(w.scale).toBe(1)
      expect(w.rotation).toBe(0)
      // Lage auf der Arbeitsfläche bleibt (Bounding-Box identisch zum gedrehten/skalierten Original)
      const b = pointsBox(splitPartWorld(placed))!
      expect(w.x).toBeCloseTo(b.x, 3)
      expect(w.y).toBeCloseTo(b.y, 3)
      expect(w.width).toBeCloseTo(b.width, 3)
      expect(w.height).toBeCloseTo(b.height, 3)
      // idempotent
      expect(weldPart(w).paths).toHaveLength(1)
    })

    it('Teil ohne Herkunftsinfo (Altbestand): Even-Odd-Annahme, Loch bleibt', () => {
      const ring: Part = {
        id: 'x', name: 'ring', sourcePath: '', width: 30, height: 30, x: 0, y: 0, rotation: 0, scale: 1,
        paths: [
          { closed: true, points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }] },
          { closed: true, points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }] }
        ]
      }
      expect(weldPart(ring).paths).toHaveLength(2)
    })
  })

  describe('Schriftzug', () => {
    const svg = letteringSvg()

    it('nach dem Import: je Glyphe Außenkontur + echte Löcher, keine überlappenden Kanten', () => {
      const parts = importSvg(svg, 'schriftzug.svg', 's', { split: true })
      expect(parts).toHaveLength(LETTERING_ORDER.length)
      const byX = [...parts].sort((a, b) => a.x - b.x)
      byX.forEach((p, i) => {
        const g = LETTERING_ORDER[i]
        expect(p.paths, `Glyphe ${g}`).toHaveLength(LETTERING_CONTOURS[g])
        // Löcher = Konturen innerhalb einer anderen; Anzahl = Konturen - 1
        expect(innerCount(p.paths), `Löcher ${g}`).toBe(LETTERING_CONTOURS[g] - 1)
        for (let a = 0; a < p.paths.length; a++) for (let b = a + 1; b < p.paths.length; b++) {
          expect(polylinesCross(p.paths[a].points, true, p.paths[b].points, true), `Kreuzung in ${g}`).toBe(false)
        }
      })
    })

    it('als ein Teil importiert ist es ebenfalls bereinigt; ohne weld bleiben Überlappungen', () => {
      const total = LETTERING_ORDER.reduce((s, g) => s + LETTERING_CONTOURS[g], 0)
      expect(importSvg(svg, 's.svg', 's')[0].paths).toHaveLength(total)
      expect(importSvg(svg, 's.svg', 's', { weld: false })[0].paths.length).toBeGreaterThan(total)
    })

    it('splitPart nach manuellem Weld liefert dieselben Glyphen', () => {
      const [raw] = importSvg(svg, 's.svg', 's', { weld: false })
      const pieces = splitPart(weldPart(raw))
      expect(pieces).toHaveLength(LETTERING_ORDER.length)
    })
  })
})

function splitPartWorld(p: Part): { x: number; y: number }[] {
  // Ecken der gedrehten/skalierten Box (wie layout.partBounds)
  const w = p.width * p.scale, h = p.height * p.scale
  const a = (p.rotation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return p.paths.flatMap((pl) => pl.points).map((q) => {
    const dx = q.x * p.scale - w / 2, dy = q.y * p.scale - h / 2
    return { x: p.x + w / 2 + dx * c - dy * s, y: p.y + h / 2 + dx * s + dy * c }
  })
}
