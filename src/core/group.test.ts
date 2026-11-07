import { describe, expect, it } from 'vitest'
import type { CutSettings, Part, Point, WorkArea } from '@shared/types'
import {
  alignParts, autoArrange, buildJob, countUnits, distributeParts, duplicateParts, expandToGroups, findFreeSpot, groupBounds,
  groupParts, importSvg, moveGroupTo, normalizeGroups, outOfBoundsUnits, partBounds, partPaths, rotateGroup, scaleGroup,
  splitPart, transformGroup, ungroupParts
} from './index'
import { letteringSvg } from './sampleSvgs'

const wa: WorkArea = { name: 't', width: 300, height: 200 }
let seq = 0

function mk(x: number, y: number, w: number, h: number, extra: Partial<Part> = {}): Part {
  return {
    id: `p${seq++}`, name: 'p', sourcePath: '', width: w, height: h, x, y, rotation: 0, scale: 1,
    paths: [{ closed: true, points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w * 0.6, y: h }, { x: 0, y: h }] }],
    ...extra
  }
}

function worldPoints(parts: Part[]): Point[] {
  return parts.flatMap((p) => partPaths(p).flatMap((pl) => pl.points))
}
function expectPointsClose(a: Point[], b: Point[]): void {
  expect(a.length).toBe(b.length)
  a.forEach((p, i) => { expect(p.x).toBeCloseTo(b[i].x, 6); expect(p.y).toBeCloseTo(b[i].y, 6) })
}
/** Abstand jedes Teil-Anfangspunkts zum ersten Teil: invariant gegen reine Verschiebung. */
function relativeLayout(parts: Part[]): Point[] {
  const pts = parts.map((p) => partPaths(p)[0].points[0])
  return pts.map((q) => ({ x: q.x - pts[0].x, y: q.y - pts[0].y }))
}

const three = (): Part[] => [
  mk(10, 10, 20, 10, { groupId: 'g' }),
  mk(40, 25, 15, 30, { groupId: 'g', rotation: 30, scale: 1.5 }),
  mk(70, 5, 10, 10, { groupId: 'g', rotation: -75 })
]

describe('Gruppen: Auswahl und Verwaltung', () => {
  it('groupBounds ist die Vereinigung der Teil-Bounds', () => {
    const g = three()
    const b = groupBounds(g)!
    const boxes = g.map(partBounds)
    expect(b.x).toBeCloseTo(Math.min(...boxes.map((q) => q.x)))
    expect(b.y).toBeCloseTo(Math.min(...boxes.map((q) => q.y)))
    expect(b.x + b.width).toBeCloseTo(Math.max(...boxes.map((q) => q.x + q.width)))
    expect(b.y + b.height).toBeCloseTo(Math.max(...boxes.map((q) => q.y + q.height)))
    expect(groupBounds([])).toBeNull()
  })

  it('expandToGroups wählt komplette Gruppen', () => {
    const a = mk(0, 0, 5, 5, { groupId: 'g' }), b = mk(10, 0, 5, 5, { groupId: 'g' }), c = mk(20, 0, 5, 5)
    expect(expandToGroups([a, b, c], [a.id])).toEqual([a.id, b.id])
    expect(expandToGroups([a, b, c], [c.id])).toEqual([c.id])
  })

  it('groupParts / ungroupParts', () => {
    const ps = [mk(0, 0, 5, 5), mk(10, 0, 5, 5), mk(20, 0, 5, 5)]
    const g = groupParts(ps, [ps[0].id, ps[1].id], 'neu')
    expect(g.map((p) => p.groupId)).toEqual(['neu', 'neu', undefined])
    expect(ps[0].groupId).toBeUndefined() // Eingabe unverändert
    expect(groupParts(ps, [ps[0].id])).toEqual(ps) // 1 Teil: keine Gruppe
    const u = ungroupParts(g, [g[0].id])
    expect(u.every((p) => p.groupId === undefined)).toBe(true)
    expect('groupId' in u[0]).toBe(false)
  })

  it('Gruppieren einer Gruppe mit weiterem Teil vereint zu einer Gruppe', () => {
    const ps = [mk(0, 0, 5, 5, { groupId: 'a' }), mk(10, 0, 5, 5, { groupId: 'a' }), mk(20, 0, 5, 5)]
    const g = groupParts(ps, [ps[0].id, ps[2].id], 'neu')
    expect(g.map((p) => p.groupId)).toEqual(['neu', 'neu', 'neu'])
  })

  it('normalizeGroups entfernt Gruppen mit nur einem Mitglied', () => {
    const ps = [mk(0, 0, 5, 5, { groupId: 'a' }), mk(10, 0, 5, 5, { groupId: 'b' }), mk(20, 0, 5, 5, { groupId: 'b' })]
    const n = normalizeGroups(ps)
    expect(n.map((p) => p.groupId)).toEqual([undefined, 'b', 'b'])
  })

  it('duplicateParts: neue ids und neue groupId je Gruppe', () => {
    const g = three()
    const c = duplicateParts(g, 8, 8)
    expect(c.map((p) => p.id)).not.toContain(g[0].id)
    const gid = c[0].groupId
    expect(gid).toBeTruthy()
    expect(gid).not.toBe('g')
    expect(c.every((p) => p.groupId === gid)).toBe(true)
    expect(c[0].x).toBe(g[0].x + 8)
    expect(c[0].paths).toBe(g[0].paths)
    // zwei Gruppen -> zwei verschiedene neue ids
    const two = duplicateParts([...g, mk(0, 0, 5, 5, { groupId: 'h' }), mk(9, 0, 5, 5, { groupId: 'h' })])
    expect(new Set(two.map((p) => p.groupId)).size).toBe(2)
    // Einzelnes Mitglied: Kopie ist keine Gruppe
    expect(duplicateParts([g[0]])[0].groupId).toBeUndefined()
  })

  it('countUnits', () => {
    expect(countUnits([...three(), mk(0, 0, 1, 1)])).toBe(2)
  })
})

describe('Gruppen: starre Transformationen', () => {
  it('moveGroupTo verschiebt die Box exakt, Anordnung bleibt', () => {
    const g = three()
    const m = moveGroupTo(g, 100, 50)
    const b = groupBounds(m)!
    expect(b.x).toBeCloseTo(100)
    expect(b.y).toBeCloseTo(50)
    expect(moveGroupTo(g, undefined, 7).map((p) => p.x)).toEqual(g.map((p) => p.x))
  })

  it('scaleGroup um die Mitte: alle Punkte skalieren exakt um die Gruppenmitte', () => {
    const g = three()
    const b = groupBounds(g)!
    const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    const f = 1.7
    const s = scaleGroup(g, f)
    const expected = worldPoints(g).map((p) => ({ x: c.x + (p.x - c.x) * f, y: c.y + (p.y - c.y) * f }))
    expectPointsClose(worldPoints(s), expected)
    const nb = groupBounds(s)!
    expect(nb.x + nb.width / 2).toBeCloseTo(c.x)
    expect(nb.width).toBeCloseTo(b.width * f)
    s.forEach((p, i) => expect(p.rotation).toBe(g[i].rotation))
  })

  it('scaleGroup mit Anker oben links', () => {
    const g = three()
    const b = groupBounds(g)!
    const s = scaleGroup(g, 0.5, { x: b.x, y: b.y })
    const nb = groupBounds(s)!
    expect(nb.x).toBeCloseTo(b.x)
    expect(nb.y).toBeCloseTo(b.y)
    expect(nb.width).toBeCloseTo(b.width / 2)
  })

  for (const deg of [90, 37, -120, 180]) {
    it(`rotateGroup ${deg}°: alle Punkte drehen exakt um die Gruppenmitte`, () => {
      const g = three()
      const b = groupBounds(g)!
      const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
      const a = (deg * Math.PI) / 180
      const r = rotateGroup(g, deg)
      const expected = worldPoints(g).map((p) => ({
        x: c.x + (p.x - c.x) * Math.cos(a) - (p.y - c.y) * Math.sin(a),
        y: c.y + (p.x - c.x) * Math.sin(a) + (p.y - c.y) * Math.cos(a)
      }))
      expectPointsClose(worldPoints(r), expected)
    })
  }

  it('90°-Schritte: Einzelteil und Gruppe, viermal drehen = Ausgangslage', () => {
    const single = mk(13.3, 7.7, 40, 25, { rotation: 30, scale: 1.7 })
    const grp = three()
    for (const set of [[single], grp]) {
      for (const dir of [90, -90]) {
        const b = groupBounds(set)!
        const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
        let cur = set
        const once = rotateGroup(cur, dir)
        expect(once[0].rotation).toBeCloseTo(((set[0].rotation + dir + 540) % 360) - 180, 9)
        const cb = groupBounds(once)!
        expect(cb.x + cb.width / 2).toBeCloseTo(c.x, 6) // Mitte bleibt
        expect(cb.y + cb.height / 2).toBeCloseTo(c.y, 6)
        for (let i = 0; i < 4; i++) cur = rotateGroup(cur, dir)
        expectPointsClose(worldPoints(cur), worldPoints(set))
        cur.forEach((p, i) => { expect(p.rotation).toBeCloseTo(set[i].rotation, 9) })
      }
    }
  })

  it('transformGroup kombiniert Skalieren, Drehen und Verschieben', () => {
    const g = three()
    const t = transformGroup(g, { scale: 2, rotate: 90, dx: 10, dy: -5 })
    const manual = rotateGroup(scaleGroup(g, 2), 90).map((p) => ({ ...p, x: p.x + 10, y: p.y - 5 }))
    expectPointsClose(worldPoints(t), worldPoints(manual))
  })

  it('Hin- und Rückdrehen stellt die Anordnung wieder her', () => {
    const g = three()
    const b = groupBounds(g)!
    const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    expectPointsClose(worldPoints(rotateGroup(rotateGroup(g, 33, c), -33, c)), worldPoints(g))
  })
})

describe('Layout: Gruppen sind eine Einheit', () => {
  const grp = (): Part[] => [mk(0, 0, 30, 10, { groupId: 'g' }), mk(50, 40, 20, 20, { groupId: 'g', rotation: 20 })]

  it('alignParts richtet die Gruppen-Box aus und behält die Anordnung', () => {
    const g = grp(), solo = mk(100, 100, 10, 10)
    const r = alignParts([...g, solo], 'left', 'selection', wa)
    expect(groupBounds(r.slice(0, 2))!.x).toBeCloseTo(partBounds(r[2]).x)
    expectPointsClose(relativeLayout(r.slice(0, 2)), relativeLayout(g))
  })

  it('alignParts an Arbeitsfläche zentriert die Gruppe als Ganzes', () => {
    const g = grp()
    const r = alignParts(g, 'hcenter', 'workarea', wa)
    const b = groupBounds(r)!
    expect(b.x + b.width / 2).toBeCloseTo(wa.width / 2)
    expectPointsClose(relativeLayout(r), relativeLayout(g))
  })

  it('distributeParts zählt eine Gruppe als eine Einheit (mit nur 2 Einheiten passiert nichts)', () => {
    const g = grp()
    const two = distributeParts([...g, mk(200, 0, 5, 5)], 'h')
    expect(two.map((p) => p.x)).toEqual([...g, { x: 200 }].map((p) => p.x))
    const mid = mk(120, 0, 10, 10)
    const r = distributeParts([...g, mid, mk(250, 0, 10, 10)], 'h')
    expectPointsClose(relativeLayout(r.slice(0, 2)), relativeLayout(g))
    const gb = groupBounds(r.slice(0, 2))!, mb = partBounds(r[2]), lb = partBounds(r[3])
    expect(mb.x - (gb.x + gb.width)).toBeCloseTo(lb.x - (mb.x + mb.width))
  })

  it('outOfBoundsUnits: Gruppe ragt hinaus, auch wenn einzelne Mitglieder innen liegen', () => {
    const ps = [mk(10, 10, 20, 20, { groupId: 'g' }), mk(290, 10, 20, 20, { groupId: 'g' }), mk(50, 50, 10, 10)]
    const u = outOfBoundsUnits(ps, wa)
    expect(u).toHaveLength(1)
    expect(u[0]).toHaveLength(2)
  })

  it('findFreeSpot weicht einer Gruppe als Ganzes aus', () => {
    const g = [mk(0, 0, 10, 10, { groupId: 'g' }), mk(100, 0, 10, 10, { groupId: 'g' })] // Box 0..110 breit
    const s = findFreeSpot(mk(0, 0, 20, 20), g, wa)
    const cand = { x: s.x, y: s.y, width: 20, height: 20 }
    const gb = groupBounds(g)!
    expect(cand.x < gb.x + gb.width && gb.x < cand.x + 20 && cand.y < gb.y + gb.height && gb.y < cand.y + 20).toBe(false)
  })
})

describe('autoArrange: Garantien', () => {
  const messy = (): Part[] => [
    mk(5, 5, 40, 20, { groupId: 'a' }), mk(80, 70, 25, 30, { groupId: 'a', rotation: 15, scale: 0.8 }), mk(30, 120, 12, 12, { groupId: 'a', rotation: 90 }),
    mk(200, 10, 60, 25, { groupId: 'b' }), mk(150, 90, 20, 50, { groupId: 'b', scale: 2 }),
    mk(10, 150, 35, 35, { rotation: 45 }), mk(250, 150, 22, 18), mk(100, 180, 15, 15, { scale: 1.3, rotation: -30 })
  ]

  it('ändert nie Pfade, scale, rotation, Anzahl, Reihenfolge, ids – nur x/y', () => {
    const ps = messy()
    const before = structuredClone(ps)
    const r = autoArrange(ps, wa)
    expect(ps).toEqual(before) // Eingabe unberührt
    expect(r).toHaveLength(ps.length)
    r.forEach((p, i) => {
      expect(p.id).toBe(ps[i].id)
      expect(p.groupId).toBe(ps[i].groupId)
      expect(p.paths).toBe(ps[i].paths)
      expect(p.scale).toBe(ps[i].scale)
      expect(p.rotation).toBe(ps[i].rotation)
      expect(p.width).toBe(ps[i].width)
      expect(p.height).toBe(ps[i].height)
    })
  })

  it('Gruppen bleiben starr: relative Lage der Mitglieder exakt gleich', () => {
    const ps = messy()
    const r = autoArrange(ps, wa)
    for (const gid of ['a', 'b']) {
      const idx = ps.map((p, i) => (p.groupId === gid ? i : -1)).filter((i) => i >= 0)
      expectPointsClose(relativeLayout(idx.map((i) => r[i])), relativeLayout(idx.map((i) => ps[i])))
      const dx = partBounds(r[idx[1]]).x - partBounds(ps[idx[1]]).x
      const dy = partBounds(r[idx[1]]).y - partBounds(ps[idx[1]]).y
      for (const i of idx) {
        expect(partBounds(r[i]).x - partBounds(ps[i]).x).toBeCloseTo(dx)
        expect(partBounds(r[i]).y - partBounds(ps[i]).y).toBeCloseTo(dy)
      }
    }
  })

  it('keine Überlappung zwischen Einheiten, Abstand >= gap, innerhalb Rand', () => {
    const gap = 3, margin = 5
    const big: WorkArea = { name: 'g', width: 400, height: 300 }
    const r = autoArrange(messy(), big, gap, margin)
    const boxes = [groupBounds(r.filter((p) => p.groupId === 'a'))!, groupBounds(r.filter((p) => p.groupId === 'b'))!, ...r.filter((p) => !p.groupId).map(partBounds)]
    boxes.forEach((b, i) => {
      expect(b.x).toBeGreaterThanOrEqual(margin - 1e-6)
      expect(b.y).toBeGreaterThanOrEqual(margin - 1e-6)
      expect(b.x + b.width).toBeLessThanOrEqual(big.width - margin + 1e-6)
      expect(b.y + b.height).toBeLessThanOrEqual(big.height - margin + 1e-6)
      boxes.slice(i + 1).forEach((o) => {
        const sepX = o.x >= b.x + b.width + gap - 1e-6 || b.x >= o.x + o.width + gap - 1e-6
        const sepY = o.y >= b.y + b.height + gap - 1e-6 || b.y >= o.y + o.height + gap - 1e-6
        expect(sepX || sepY).toBe(true)
      })
    })
  })

  it('zu breite Gruppe wird nicht verändert, nur platziert', () => {
    const wide = [mk(0, 0, 200, 20, { groupId: 'w' }), mk(250, 30, 100, 20, { groupId: 'w' })] // Box 350 breit > 300
    const solo = mk(0, 0, 30, 30)
    const r = autoArrange([...wide, solo], wa)
    expectPointsClose(relativeLayout(r.slice(0, 2)), relativeLayout(wide))
    expect(r[0].scale).toBe(1)
    expect(r[1].paths).toBe(wide[1].paths)
    expect(groupBounds(r.slice(0, 2))!.x).toBeCloseTo(0)
    // das einzelne Teil überlappt die Gruppe nicht
    const gb = groupBounds(r.slice(0, 2))!, sb = partBounds(r[2])
    expect(sb.y >= gb.y + gb.height || sb.y + sb.height <= gb.y).toBe(true)
  })

  it('Szenario des Berichts: importieren, zerlegen, gruppieren, anordnen -> Teile liegen identisch zusammen', () => {
    const [whole] = importSvg(letteringSvg(), 'schriftzug.svg', 'schriftzug.svg', { split: false, weld: true })
    const placed = { ...whole, x: 140, y: 120 }
    const pieces = splitPart(placed)
    expect(pieces.length).toBeGreaterThan(5)
    // Ohne Gruppe werden Teile einzeln gepackt (Ursache des Berichts)
    const scattered = autoArrange(pieces, wa)
    const gapsBefore = relativeLayout(pieces), gapsAfter = relativeLayout(scattered)
    expect(gapsAfter.some((p, i) => Math.abs(p.x - gapsBefore[i].x) > 1 || Math.abs(p.y - gapsBefore[i].y) > 1)).toBe(true)
    // Mit Gruppe bleibt alles zusammen – auch nach Skalieren/Drehen der Gruppe
    const grouped = groupParts(pieces, pieces.map((p) => p.id))
    expect(new Set(grouped.map((p) => p.groupId)).size).toBe(1)
    const reshaped = rotateGroup(scaleGroup(grouped, 0.7), 25)
    const other = mk(10, 10, 40, 40)
    const arranged = autoArrange([other, ...reshaped], wa)
    const members = arranged.slice(1)
    expect(members.length).toBe(pieces.length)
    expectPointsClose(relativeLayout(members), relativeLayout(reshaped))
    members.forEach((m, i) => { expect(m.paths).toBe(pieces[i].paths); expect(m.scale).toBeCloseTo(pieces[i].scale * 0.7) })
    // Umriss der Gruppe als Ganzes bleibt: gleiche Größe
    const b0 = groupBounds(reshaped)!, b1 = groupBounds(members)!
    expect(b1.width).toBeCloseTo(b0.width)
    expect(b1.height).toBeCloseTo(b0.height)
  })
})

describe('buildJob mit Gruppen', () => {
  const settings: CutSettings = { blade: 3, force: 10, speed: 5, passes: 1, overcut: 0 }
  const big: WorkArea = { name: 'x', width: 1000, height: 1000 }
  it('Mitglieder einer Gruppe werden zusammenhängend geschnitten', () => {
    // A1 (nah am Start) und A2 (weit weg) in Gruppe; B liegt zwischen den beiden
    const a1 = mk(0, 0, 10, 10, { groupId: 'A', name: 'a1' }), a2 = mk(500, 0, 10, 10, { groupId: 'A', name: 'a2' })
    const b = mk(100, 0, 10, 10, { name: 'b' })
    const job = buildJob([a1, b, a2], big, settings)
    expect(job.paths).toHaveLength(3)
    const xs = job.paths.map((pl) => Math.min(...pl.points.map((p) => p.x)))
    // a1 und a2 direkt hintereinander, b davor oder danach
    const iA1 = xs.indexOf(0), iA2 = xs.indexOf(500), iB = xs.indexOf(100)
    expect(Math.abs(iA1 - iA2)).toBe(1)
    expect(iB).toBe(2)
  })
  it('Gruppenzugehörigkeit ändert die Pfadanzahl nicht', () => {
    const ps = [mk(0, 0, 10, 10, { groupId: 'A' }), mk(30, 0, 10, 10, { groupId: 'A' })]
    expect(buildJob(ps, big, settings).paths).toHaveLength(2)
  })
})
