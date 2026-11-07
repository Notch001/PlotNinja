import { describe, expect, it } from 'vitest'
import type { Part, Point, WorkArea } from '@shared/types'
import { addBorderToParts, autoArrange, borderOptionsFrom, groupParts, partPaths } from './index'
import { pointInPolygon } from './geom'
import { buildShape, nest, nestArrange, nestMultiple, type MultiOptions, type NestOptions } from './nest'
import { sanitizeNest } from './nestSettings'

let seq = 0
function rect(x: number, y: number, w: number, h: number, extra: Partial<Part> = {}): Part {
  return {
    id: `n${seq++}`, name: 'r', sourcePath: '', width: w, height: h, x, y, rotation: 0, scale: 1,
    paths: [{ closed: true, points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] }],
    ...extra
  }
}
/** Rahmen mit Loch (Außen w×h, Loch mittig). */
function frame(x: number, y: number, w: number, h: number, t: number): Part {
  return rect(x, y, w, h, {
    paths: [
      { closed: true, points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] },
      { closed: true, points: [{ x: t, y: t }, { x: t, y: h - t }, { x: w - t, y: h - t }, { x: w - t, y: t }] }
    ]
  })
}
/** Kreis aus 48 Punkten. */
function disc(x: number, y: number, d: number): Part {
  const pts: Point[] = []
  for (let i = 0; i < 48; i++) pts.push({ x: d / 2 + (d / 2) * Math.cos((i / 48) * 2 * Math.PI), y: d / 2 + (d / 2) * Math.sin((i / 48) * 2 * Math.PI) })
  return rect(x, y, d, d, { paths: [{ closed: true, points: pts }] })
}

const wa: WorkArea = { name: 't', width: 305, height: 305 }
const base: NestOptions = { gap: 3, margin: 5, rotate: 'off', holes: false, timeLimitMs: 10_000 }
const multi = (o: Partial<MultiOptions> = {}): MultiOptions => ({ ...base, count: 10, includeOriginal: false, ...o })

function polys(parts: Part[]): Point[][] {
  return parts.flatMap((p) => partPaths(p).filter((pl) => pl.closed).map((pl) => pl.points))
}
function segInter(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  return o(a, b, c) * o(a, b, d) < -1e-9 && o(c, d, a) * o(c, d, b) < -1e-9
}
function polyOverlap(a: Point[], b: Point[]): boolean {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    if (segInter(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true
  }
  const inner = (p: Point, q: Point[]): boolean => pointInPolygon({ x: p.x + 1e-4, y: p.y + 1e-4 }, q) && pointInPolygon({ x: p.x - 1e-4, y: p.y - 1e-4 }, q)
  return inner(a[0], b) || inner(b[0], a)
}
/** Teilebene (ohne Löcher-Sonderfall): kein Paar von Hüllpolygonen überlappt. */
function anyOverlap(units: Part[][]): boolean {
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
    for (const a of polys(units[i])) for (const b of polys(units[j])) if (polyOverlap(a, b)) return true
  }
  return false
}
function bbox(parts: Part[]): { x0: number; y0: number; x1: number; y1: number } {
  const pts = parts.flatMap((p) => partPaths(p).flatMap((pl) => pl.points))
  return { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) }
}
function minDist(a: Part[], b: Part[]): number {
  let m = Infinity
  const pa = polys(a), pb = polys(b)
  const seg = (p: Point, q: Point, r: Point): number => {
    const dx = q.x - p.x, dy = q.y - p.y
    const t = dx || dy ? Math.max(0, Math.min(1, ((r.x - p.x) * dx + (r.y - p.y) * dy) / (dx * dx + dy * dy))) : 0
    return Math.hypot(p.x + t * dx - r.x, p.y + t * dy - r.y)
  }
  for (const A of pa) for (const B of pb) {
    for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
      m = Math.min(m, seg(B[j], B[(j + 1) % B.length], A[i]), seg(A[i], A[(i + 1) % A.length], B[j]))
    }
  }
  return m
}

describe('Nesting: Mehrfach platzieren', () => {
  it('50×50 füllen die 305-mm-Matte wie erwartet, ohne Überlappung und innerhalb der Ränder', () => {
    const t = rect(0, 0, 50, 50)
    const r = nestMultiple([t], [t], wa, multi({ count: 'fill', includeOriginal: true }))
    const all = [r.original!, ...r.units]
    // 295 mm nutzbar: 5 Stück je Reihe (5·50 + 4·3 = 262), 5 Reihen -> 25
    expect(all.length).toBe(25)
    expect(r.plan.copies.length).toBe(24)
    expect(anyOverlap(all)).toBe(false)
    for (const u of all) {
      const b = bbox(u)
      expect(b.x0).toBeGreaterThanOrEqual(5 - 1e-6); expect(b.y0).toBeGreaterThanOrEqual(5 - 1e-6)
      expect(b.x1).toBeLessThanOrEqual(300 + 1e-6); expect(b.y1).toBeLessThanOrEqual(300 + 1e-6)
    }
  })

  it('feste Anzahl: 10 Kopien, Mindestabstand eingehalten, neue ids', () => {
    const t = rect(10, 10, 50, 50)
    const r = nestMultiple([t], [t], wa, multi({ count: 10, includeOriginal: false }))
    expect(r.copies.length).toBe(10)
    expect(new Set(r.copies.map((c) => c.id)).size).toBe(10)
    expect(r.copies.every((c) => c.id !== t.id)).toBe(true)
    const units = [[t], ...r.units]
    expect(anyOverlap(units)).toBe(false)
    for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) expect(minDist(units[i], units[j])).toBeGreaterThanOrEqual(3 - 1e-6)
  })

  it('zu große Anzahl: nur so viele wie passen, Rest nicht platziert', () => {
    const t = rect(0, 0, 100, 100)
    const r = nestMultiple([t], [t], wa, multi({ count: 50, includeOriginal: false }))
    expect(r.copies.length).toBeLessThan(50)
    expect(r.copies.length).toBeGreaterThan(0)
  })

  it('Drehung um 90° bringt bei schmalen Teilen Gewinn', () => {
    const bar = rect(0, 0, 20, 200)
    const off = nestMultiple([bar], [bar], wa, multi({ count: 'fill', includeOriginal: true, rotate: 'off' }))
    const r90 = nestMultiple([bar], [bar], wa, multi({ count: 'fill', includeOriginal: true, rotate: '90' }))
    expect(r90.copies.length).toBeGreaterThan(off.copies.length)
    expect(anyOverlap([r90.original!, ...r90.units])).toBe(false)
    expect(r90.units.some((c) => Math.abs(c[0].rotation) === 90)).toBe(true)
  })

  it('freie Drehung: Dreiecke passen dichter als ohne Drehung und überlappen nicht', () => {
    const tri = rect(0, 0, 40, 40, { paths: [{ closed: true, points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 40 }] }] })
    const off = nestMultiple([tri], [tri], wa, multi({ count: 'fill', includeOriginal: true, rotate: 'off' }))
    const free = nestMultiple([tri], [tri], wa, multi({ count: 'fill', includeOriginal: true, rotate: 'free' }))
    expect(free.copies.length).toBeGreaterThanOrEqual(off.copies.length)
    expect(anyOverlap([free.original!, ...free.units])).toBe(false)
    for (const c of free.units) { const b = bbox(c); expect(b.x0).toBeGreaterThanOrEqual(5 - 1e-6); expect(b.x1).toBeLessThanOrEqual(300 + 1e-6); expect(b.y1).toBeLessThanOrEqual(300 + 1e-6) }
  })

  it('Hindernisse werden respektiert', () => {
    const ob = rect(100, 100, 100, 100)
    const t = rect(5, 5, 40, 40)
    const r = nestMultiple([ob, t], [t], wa, multi({ count: 'fill', includeOriginal: true }))
    const units = [r.original!, ...r.units]
    expect(units.length).toBeGreaterThan(10)
    expect(anyOverlap([[ob], ...units])).toBe(false)
    for (const u of units) expect(minDist([ob], u)).toBeGreaterThanOrEqual(3 - 1e-6)
  })

  it('Original bleibt stehen, wenn „Original mit einordnen“ aus ist', () => {
    const t = rect(120, 120, 40, 40)
    const r = nestMultiple([t], [t], wa, multi({ count: 5, includeOriginal: false }))
    expect(r.original).toBeNull()
    expect(r.copies.length).toBe(5)
    expect(anyOverlap([[t], ...r.units])).toBe(false)
  })

  it('Teil größer als die Matte: Hinweis statt Absturz', () => {
    const t = rect(0, 0, 400, 400)
    const r = nestMultiple([t], [t], wa, multi({ count: 3, includeOriginal: true }))
    expect(r.plan.tooBig).toBe(true)
    expect(r.copies.length).toBe(0)
    expect(r.original).toBeNull()
  })

  it('Gruppen bleiben starr und behalten neue groupIds; Schnittrand bleibt in der Gruppe', () => {
    const a = rect(10, 10, 30, 10), b = rect(15, 30, 8, 22, { rotation: 20 })
    let parts = groupParts([a, b], [a.id, b.id], 'G1')
    const withBorder = addBorderToParts(parts, parts.map((p) => p.id), borderOptionsFrom({ mode: 'rect', offsetMm: 3, rounded: false, cornerRadiusMm: 3 }))!
    parts = withBorder.parts
    expect(parts.some((p) => p.role === 'border')).toBe(true)
    const r = nestMultiple(parts, parts, wa, multi({ count: 4, includeOriginal: true, rotate: '90' }))
    const units = [r.original!, ...r.units]
    // Es gibt 1 Original + 4 Kopien; Kopien gruppiert mit eigenen neuen groupIds
    const copyGroups = new Set(r.units.map((c) => c[0].groupId))
    expect(copyGroups.size).toBe(4)
    expect(copyGroups.has('G1')).toBe(false)
    expect(r.copies.filter((c) => c.role === 'border').length).toBe(4)
    expect(anyOverlap(units.map((u) => u.filter((p) => p.role === 'border')))).toBe(false)
    // Starr: Abstände der Teilmittelpunkte und Drehungsdifferenzen bleiben gleich
    const orig = parts
    const dist = (u: Part[], i: number, j: number): number => {
      const c = (p: Part): Point => { const bb = bbox([p]); return { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 } }
      const ci = c(u[i]), cj = c(u[j]); return Math.hypot(ci.x - cj.x, ci.y - cj.y)
    }
    for (const u of units) {
      expect(u.length).toBe(orig.length)
      for (let i = 0; i < u.length; i++) {
        expect(u[i].paths).toEqual(orig[i].paths) // Geometrie unverändert
        expect(u[i].scale).toBe(orig[i].scale)
        expect(u[i].role).toBe(orig[i].role)
        for (let j = i + 1; j < u.length; j++) expect(dist(u, i, j)).toBeCloseTo(dist(orig, i, j), 5)
        const dr = (((u[i].rotation - orig[i].rotation) - (u[0].rotation - orig[0].rotation)) % 360 + 360) % 360
        expect(Math.min(dr, 360 - dr)).toBeLessThan(1e-6)
      }
      // Rand umschließt die übrigen Teile
      const bd = u.find((p) => p.role === 'border')!
      const bb = bbox([bd])
      for (const p of u.filter((q) => q !== bd)) { const pb = bbox([p]); expect(pb.x0).toBeGreaterThanOrEqual(bb.x0 - 1e-6); expect(pb.x1).toBeLessThanOrEqual(bb.x1 + 1e-6); expect(pb.y0).toBeGreaterThanOrEqual(bb.y0 - 1e-6); expect(pb.y1).toBeLessThanOrEqual(bb.y1 + 1e-6) }
    }
  })

  it('Löcher: ohne die Option bleibt die Außenhülle belegt, mit der Option passen kleine Teile hinein', () => {
    const fr = frame(0, 0, 100, 100, 5)
    const small = rect(0, 0, 20, 20)
    const area: WorkArea = { name: 'k', width: 110, height: 110 }
    const arr = (holes: boolean) => nestArrange([fr, small], area, { ...base, margin: 5, holes })
    const noHoles = arr(false)
    expect(noHoles.unplaced).toBe(1) // außerhalb der Matte abgelegt, passt nicht neben den Rahmen
    const withHoles = arr(true)
    expect(withHoles.unplaced).toBe(0)
    const f = bbox([withHoles.parts[0]]), s = bbox([withHoles.parts[1]])
    expect(s.x0).toBeGreaterThan(f.x0 + 5); expect(s.x1).toBeLessThan(f.x1 - 5)
    expect(s.y0).toBeGreaterThan(f.y0 + 5); expect(s.y1).toBeLessThan(f.y1 - 5)
  })

  it('So viele wie passen liefert mindestens die Regalpackung', () => {
    const shapes: [string, Part][] = [['rect 62×27', rect(0, 0, 62, 27)], ['rect 40×25', rect(0, 0, 40, 25)], ['disc 35', disc(0, 0, 35)]]
    for (const [, t] of shapes) {
      const copies = Array.from({ length: 150 }, (_, i) => ({ ...t, id: `s${i}` }))
      const shelf = autoArrange(copies, wa, 3, 5).filter((p) => { const b = bbox([p]); return b.y1 <= 300 + 1e-6 && b.x1 <= 300 + 1e-6 }).length
      const r = nestMultiple([t], [t], wa, multi({ count: 'fill', includeOriginal: true, rotate: '90' }))
      expect(r.copies.length + 1).toBeGreaterThanOrEqual(shelf)
    }
  })

  it('deterministisch: gleiche Eingabe, gleiches Ergebnis', () => {
    const t = disc(0, 0, 33)
    const a = nestMultiple([t], [t], wa, multi({ count: 20, includeOriginal: true, rotate: 'free' }))
    const b = nestMultiple([t], [t], wa, multi({ count: 20, includeOriginal: true, rotate: 'free' }))
    expect(a.plan.copies).toEqual(b.plan.copies)
  })

  it('Zeitbegrenzung greift und liefert den bisherigen Stand', () => {
    const t = rect(0, 0, 6, 6)
    let clock = 0
    const r = nestMultiple([t], [t], wa, multi({ count: 'fill', includeOriginal: true, rotate: 'free', timeLimitMs: 50 }), () => (clock += 10))
    expect(r.plan.timedOut).toBe(true)
    expect(r.copies.length).toBeGreaterThan(0)
    expect(anyOverlap([r.original!, ...r.units])).toBe(false)
  })

  it('Performance: 100 Teile auf 305×610 mit 90°-Drehung in Sekundenbruchteilen', () => {
    const t = rect(0, 0, 30, 20)
    const t0 = Date.now()
    const r = nestMultiple([t], [t], { name: 'x', width: 305, height: 610 }, multi({ count: 100, includeOriginal: true, rotate: '90' }))
    expect(r.copies.length).toBe(100)
    expect(Date.now() - t0).toBeLessThan(3000)
  })
})

describe('Nesting: Kompakt anordnen', () => {
  it('ordnet verschiedene Teile überlappungsfrei und innerhalb der Matte an', () => {
    const parts = [rect(200, 200, 80, 30), disc(10, 10, 45), rect(150, 10, 25, 90), frame(0, 0, 60, 60, 6), rect(90, 90, 10, 10), disc(0, 0, 20)]
    const r = nestArrange(parts, wa, { ...base, rotate: '90' })
    expect(r.unplaced).toBe(0)
    expect(anyOverlap(r.parts.map((p) => [p]))).toBe(false)
    for (const p of r.parts) { const b = bbox([p]); expect(b.x0).toBeGreaterThanOrEqual(5 - 1e-6); expect(b.y0).toBeGreaterThanOrEqual(5 - 1e-6); expect(b.x1).toBeLessThanOrEqual(300 + 1e-6); expect(b.y1).toBeLessThanOrEqual(300 + 1e-6) }
    r.parts.forEach((p, i) => { expect(p.id).toBe(parts[i].id); expect(p.paths).toEqual(parts[i].paths) })
  })

  it('nicht gewählte Teile bleiben liegen und sind Hindernisse', () => {
    const fixed = rect(100, 100, 100, 100), a = rect(0, 0, 40, 40), b = rect(0, 0, 40, 40)
    const r = nestArrange([fixed, a, b], wa, base, [a.id, b.id])
    expect(r.parts[0]).toEqual(fixed)
    expect(anyOverlap(r.parts.map((p) => [p]))).toBe(false)
  })

  it('zu große Einheit: wird unterhalb der Matte abgelegt statt zu verschwinden', () => {
    const big = rect(0, 0, 400, 50), a = rect(0, 0, 40, 40)
    const r = nestArrange([big, a], wa, base)
    expect(r.unplaced).toBe(1)
    expect(r.parts.length).toBe(2)
    expect(bbox([r.parts[0]]).y0).toBeGreaterThanOrEqual(305)
  })

  it('Gruppen bleiben starr', () => {
    const a = rect(10, 10, 30, 10), b = rect(60, 40, 8, 22)
    const parts = groupParts([a, b], [a.id, b.id], 'G')
    const lone = rect(0, 0, 50, 50)
    const r = nestArrange([...parts, lone], wa, { ...base, rotate: '90' })
    const g = r.parts.slice(0, 2)
    expect(g.every((p) => p.groupId === 'G')).toBe(true)
    const d0 = Math.hypot(a.x - b.x, a.y - b.y), d1 = Math.hypot(g[0].x - g[1].x, g[0].y - g[1].y)
    expect(d1).toBeCloseTo(d0, 5)
  })
})

describe('Nesting: Engine und Einstellungen', () => {
  it('Form: Rahmen mit Loch füllt nur den Ring, wenn Löcher erlaubt sind', () => {
    const f = frame(0, 0, 40, 40, 4)
    expect(buildShape([f], true).fills.length).toBe(1)
    expect(buildShape([f], true).fills[0].length).toBe(2)
    expect(buildShape([f], false).fills.length).toBe(2)
  })

  it('leerer Job und zu kleine Matte brechen nicht ab', () => {
    const empty = nest({ width: 100, height: 100, gap: 3, margin: 5, rotate: 'off', timeLimitMs: 100, obstacles: [], items: [] })
    expect(empty.placements.length).toBe(0)
    const tiny = nest({ width: 8, height: 8, gap: 3, margin: 5, rotate: 'off', timeLimitMs: 100, obstacles: [], items: [{ shape: buildShape([rect(0, 0, 5, 5)], false), copies: 1 }] })
    expect(tiny.tooBig[0]).toBe(true)
  })

  it('sanitizeNest begrenzt und füllt Standardwerte auf', () => {
    expect(sanitizeNest(undefined)).toEqual({ mode: 'count', count: 10, gapMm: 3, marginMm: 5, rotate: '90', holes: false, includeOriginal: true })
    const s = sanitizeNest({ mode: 'fill', count: 5000, gapMm: -4, marginMm: 99, rotate: 'x', holes: true, includeOriginal: false })
    expect(s).toEqual({ mode: 'fill', count: 999, gapMm: 0, marginMm: 50, rotate: '90', holes: true, includeOriginal: false })
  })
})
