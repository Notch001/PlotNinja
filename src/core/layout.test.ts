import { describe, expect, it } from 'vitest'
import type { Part, WorkArea } from '@shared/types'
import {
  alignParts, autoArrange, distributeParts, findFreeSpot, isOutOfBounds, partBounds, partPaths
} from './index'

const wa: WorkArea = { name: 't', width: 100, height: 100 }

function mk(x: number, y: number, w: number, h: number, extra: Partial<Part> = {}): Part {
  return {
    id: `${x}-${y}-${w}-${h}`, name: 'p', sourcePath: '', width: w, height: h, x, y, rotation: 0, scale: 1,
    paths: [{ closed: true, points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] }],
    ...extra
  }
}

describe('Bounds und Pfade', () => {
  it('Skalierung und Rotation um die Mitte', () => {
    const p = mk(10, 10, 20, 10, { scale: 2, rotation: 90 })
    const b = partBounds(p)
    // skalierte Box 40x20, Mitte (30,20) -> rotiert 20x40
    expect(b.width).toBeCloseTo(20)
    expect(b.height).toBeCloseTo(40)
    expect(b.x).toBeCloseTo(20)
    expect(b.y).toBeCloseTo(0)
    const pts = partPaths(p)[0].points.flatMap((q) => [q.x, q.y])
    const xs = partPaths(p)[0].points.map((q) => q.x)
    const ys = partPaths(p)[0].points.map((q) => q.y)
    expect(pts.length).toBe(8)
    expect(Math.min(...xs)).toBeCloseTo(20)
    expect(Math.max(...xs)).toBeCloseTo(40)
    expect(Math.min(...ys)).toBeCloseTo(0)
    expect(Math.max(...ys)).toBeCloseTo(40)
  })

  it('Rotation im Uhrzeigersinn: Punkt rechts der Mitte landet unten', () => {
    const p = mk(0, 0, 20, 0, { rotation: 90, paths: [{ closed: false, points: [{ x: 20, y: 0 }, { x: 10, y: 0 }] }] })
    const [a] = partPaths(p)[0].points
    expect(a.x).toBeCloseTo(10)
    expect(a.y).toBeCloseTo(10)
  })
})

describe('Ausrichten', () => {
  const a = mk(10, 5, 20, 20)
  const b = mk(50, 40, 10, 10)
  it('links / rechts an Auswahl', () => {
    expect(alignParts([a, b], 'left', 'selection', wa).map((p) => p.x)).toEqual([10, 10])
    expect(alignParts([a, b], 'right', 'selection', wa).map((p) => p.x)).toEqual([40, 50])
  })
  it('mittig an Arbeitsfläche', () => {
    const r = alignParts([a, b], 'hcenter', 'workarea', wa)
    expect(r[0].x).toBeCloseTo(40)
    expect(r[1].x).toBeCloseTo(45)
    const v = alignParts([a, b], 'vcenter', 'workarea', wa)
    expect(v[0].y).toBeCloseTo(40)
  })
  it('oben / unten an Arbeitsfläche', () => {
    expect(alignParts([a, b], 'top', 'workarea', wa).map((p) => p.y)).toEqual([0, 0])
    expect(alignParts([a, b], 'bottom', 'workarea', wa).map((p) => p.y)).toEqual([80, 90])
  })
  it('berücksichtigt Rotation', () => {
    const r = mk(0, 0, 40, 10, { rotation: 90 }) // bounds: x 15..25, y -15..25
    const out = alignParts([r], 'left', 'workarea', wa)[0]
    expect(partBounds(out).x).toBeCloseTo(0)
  })
  it('verändert die Eingabe nicht', () => {
    alignParts([a, b], 'left', 'selection', wa)
    expect(a.x).toBe(10)
  })
})

describe('Verteilen / Anordnen', () => {
  it('gleichmäßige Abstände horizontal', () => {
    const ps = [mk(0, 0, 10, 10), mk(15, 0, 10, 10), mk(90, 0, 10, 10)]
    const r = distributeParts(ps, 'h')
    expect(r[0].x).toBe(0)
    expect(r[1].x).toBeCloseTo(45)
    expect(r[2].x).toBeCloseTo(90)
  })
  it('weniger als 3 Teile bleiben unverändert', () => {
    const ps = [mk(0, 0, 10, 10), mk(15, 0, 10, 10)]
    expect(distributeParts(ps, 'v').map((p) => p.y)).toEqual([0, 0])
  })
  it('autoArrange überlappt nicht und bleibt in der Fläche, wenn möglich', () => {
    const ps = [mk(0, 0, 40, 30), mk(0, 0, 40, 20), mk(0, 0, 40, 10), mk(0, 0, 40, 25)]
    const r = autoArrange(ps, wa, 3)
    for (let i = 0; i < r.length; i++) {
      expect(isOutOfBounds(r[i], wa)).toBe(false)
      for (let j = i + 1; j < r.length; j++) {
        const a = partBounds(r[i]), b = partBounds(r[j])
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
        expect(overlap).toBe(false)
      }
    }
  })
  it('autoArrange platziert nicht passende Teile trotzdem', () => {
    const r = autoArrange([mk(0, 0, 150, 20), mk(0, 0, 150, 20)], wa)
    expect(r).toHaveLength(2)
    expect(r[1].y).toBeGreaterThan(r[0].y)
  })
  it('findFreeSpot findet freie Position', () => {
    const existing = [mk(0, 0, 50, 50)]
    const s = findFreeSpot(mk(0, 0, 20, 20), existing, wa)
    const cand = mk(s.x, s.y, 20, 20)
    const a = partBounds(cand), b = partBounds(existing[0])
    expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false)
    expect(isOutOfBounds(cand, wa)).toBe(false)
  })
  it('findFreeSpot Fallback oben links', () => {
    expect(findFreeSpot(mk(7, 7, 200, 200), [], wa)).toEqual({ x: 0, y: 0 })
  })
  it('isOutOfBounds', () => {
    expect(isOutOfBounds(mk(90, 0, 20, 10), wa)).toBe(true)
    expect(isOutOfBounds(mk(80, 0, 20, 10), wa)).toBe(false)
  })
})
