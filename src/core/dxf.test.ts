import { describe, expect, it } from 'vitest'
import { buildDxf, dxfArc, dxfBlock, dxfCircle, dxfInsert, dxfLine, dxfLwPoly, sampleBracketDxf } from './sampleDxf'
import { importDxf } from './dxf'

const bbox = (paths: { points: { x: number; y: number }[] }[]): { w: number; h: number } => {
  const xs = paths.flatMap((p) => p.points.map((q) => q.x)), ys = paths.flatMap((p) => p.points.map((q) => q.y))
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

describe('importDxf', () => {
  it('verbindet 4 lose LINEs zu einem geschlossenen Rechteck', () => {
    const dxf = buildDxf([dxfLine(0, 0, 40, 0), dxfLine(40, 0, 40, 20), dxfLine(40, 20, 0, 20), dxfLine(0, 20, 0, 0)])
    const [p] = importDxf(dxf, 'rechteck.dxf', 'C:\\x\\rechteck.dxf')
    expect(p.name).toBe('rechteck')
    expect(p.paths).toHaveLength(1)
    expect(p.paths[0].closed).toBe(true)
    expect(p.paths[0].points).toHaveLength(4)
    expect(p.width).toBeCloseTo(40, 6)
    expect(p.height).toBeCloseTo(20, 6)
  })

  it('verbindet Linien in beliebiger Reihenfolge und Richtung und toleriert 0,005 mm Lücke', () => {
    const dxf = buildDxf([dxfLine(40, 0, 40, 20), dxfLine(0, 20, 40.005, 20), dxfLine(0, 20, 0, 0), dxfLine(0, 0, 40, 0)])
    const [p] = importDxf(dxf, 'r.dxf', 'r.dxf')
    expect(p.paths).toHaveLength(1)
    expect(p.paths[0].closed).toBe(true)
  })

  it('lässt Lücken über 0,01 mm offen', () => {
    const dxf = buildDxf([dxfLine(0, 0, 10, 0), dxfLine(10.05, 0, 20, 0)])
    const [p] = importDxf(dxf, 'l.dxf', 'l.dxf')
    expect(p.paths).toHaveLength(2)
  })

  it('dreht die Y-Achse um', () => {
    const dxf = buildDxf([dxfLine(0, 0, 0, 10), dxfLine(0, 10, 10, 10)])
    const [p] = importDxf(dxf, 'y.dxf', 'y.dxf')
    // DXF: Start (0,0) unten, Ende bei y=10 oben. App: y nach unten -> Start ist unten (großes y)
    const pts = p.paths[0].points
    expect(pts[0].y).toBeCloseTo(10, 6)
    expect(pts[1].y).toBeCloseTo(0, 6)
  })

  it('erzeugt aus CIRCLE eine geschlossene Kontur mit passendem Radius', () => {
    const [p] = importDxf(buildDxf([dxfCircle(50, 50, 10)]), 'k.dxf', 'k.dxf')
    expect(p.paths).toHaveLength(1)
    expect(p.paths[0].closed).toBe(true)
    expect(p.paths[0].points.length).toBeGreaterThanOrEqual(24)
    expect(p.width).toBeCloseTo(20, 1)
    expect(p.height).toBeCloseTo(20, 1)
  })

  it('erzeugt aus ARC einen offenen Bogen (Viertelkreis)', () => {
    const [p] = importDxf(buildDxf([dxfArc(0, 0, 10, 0, 90)]), 'b.dxf', 'b.dxf')
    expect(p.paths[0].closed).toBe(false)
    expect(p.width).toBeCloseTo(10, 2)
    expect(p.height).toBeCloseTo(10, 2)
    const pts = p.paths[0].points
    for (const q of pts) expect(Math.hypot(q.x - 0, q.y - 10)).toBeCloseTo(10, 1) // Mittelpunkt liegt unten links (y gespiegelt)
  })

  it('Bogen mit Ende vor Anfang läuft über 360 Grad', () => {
    const [p] = importDxf(buildDxf([dxfArc(0, 0, 10, 270, 90)]), 'h.dxf', 'h.dxf')
    expect(p.width).toBeCloseTo(10, 1) // rechter Halbkreis
    expect(p.height).toBeCloseTo(20, 1)
  })

  it('wertet Bulge in LWPOLYLINE aus (Halbkreis-Stadium)', () => {
    // Zwei Halbkreise (bulge 1) zwischen (0,0) und (0,10): Kreis mit Durchmesser 10
    const dxf = buildDxf([dxfLwPoly([[0, 0, 1], [0, 10, 1]], true)])
    const [p] = importDxf(dxf, 'bulge.dxf', 'bulge.dxf')
    expect(p.paths[0].closed).toBe(true)
    expect(p.width).toBeCloseTo(10, 1)
    expect(p.height).toBeCloseTo(10, 1)
  })

  it('Bulge-Vorzeichen bestimmt die Seite', () => {
    const left = importDxf(buildDxf([dxfLwPoly([[0, 0, 1], [10, 0]], false)]), 'a.dxf', 'a')[0]
    const right = importDxf(buildDxf([dxfLwPoly([[0, 0, -1], [10, 0]], false)]), 'a.dxf', 'a')[0]
    // positive Bulge von (0,0) nach (10,0): Bogen unterhalb der Sehne (DXF y<0) -> nach dem Spiegeln y>0 (unten)
    const maxY = (p: typeof left): number => Math.max(...p.paths[0].points.map((q) => q.y))
    const minY = (p: typeof left): number => Math.min(...p.paths[0].points.map((q) => q.y))
    expect(left.height).toBeCloseTo(5, 1)
    expect(right.height).toBeCloseTo(5, 1)
    expect(maxY(left) - minY(left)).toBeCloseTo(5, 1)
    expect(left.paths[0].points[Math.floor(left.paths[0].points.length / 2)].y).toBeGreaterThan(left.paths[0].points[0].y)
    expect(right.paths[0].points[Math.floor(right.paths[0].points.length / 2)].y).toBeLessThan(right.paths[0].points[0].y)
    expect(maxY(right)).toBeCloseTo(5, 1)
  })

  it('rechnet Inch (INSUNITS 1) in mm um', () => {
    const dxf = buildDxf([dxfLine(0, 0, 2, 0), dxfLine(2, 0, 2, 1), dxfLine(2, 1, 0, 1), dxfLine(0, 1, 0, 0)], { insUnits: 1 })
    const [p] = importDxf(dxf, 'inch.dxf', 'inch.dxf')
    expect(p.width).toBeCloseTo(50.8, 6)
    expect(p.height).toBeCloseTo(25.4, 6)
  })

  it('rechnet cm und m um und nimmt ohne Angabe mm', () => {
    const rect = (): string[] => [dxfLine(0, 0, 1, 0), dxfLine(1, 0, 1, 1)]
    expect(importDxf(buildDxf(rect(), { insUnits: 5 }), 'a', 'a')[0].width).toBeCloseTo(10, 6)
    expect(importDxf(buildDxf(rect(), { insUnits: 6 }), 'a', 'a')[0].width).toBeCloseTo(1000, 6)
    expect(importDxf(buildDxf(rect()), 'a', 'a')[0].width).toBeCloseTo(1, 6)
  })

  it('löst Block-INSERTs mit Verschiebung, Drehung und Maßstab auf', () => {
    const blk = dxfBlock('QUAD', [dxfLine(0, 0, 10, 0), dxfLine(10, 0, 10, 10), dxfLine(10, 10, 0, 10), dxfLine(0, 10, 0, 0)])
    const dxf = buildDxf([dxfInsert('QUAD', 100, 100), dxfInsert('QUAD', 0, 0, 90, 2, 2)], { blocks: [blk] })
    const [p] = importDxf(dxf, 'blk.dxf', 'blk.dxf')
    expect(p.paths).toHaveLength(2)
    expect(p.paths.every((q) => q.closed)).toBe(true)
    // Instanz 2: 20x20 gedreht um 90 Grad ab (0,0) -> x in [-20,0]; Instanz 1: x in [100,110] -> Gesamtbreite 130
    expect(p.width).toBeCloseTo(130, 4)
    expect(p.height).toBeCloseTo(110, 4) // y: -? Instanz2 y in [0,20] (DXF) bis Instanz1 [100,110]
  })

  it('beachtet den Basispunkt des Blocks', () => {
    const blk = dxfBlock('B', [dxfLine(5, 5, 15, 5), dxfLine(15, 5, 15, 15)], 5, 5)
    const dxf = buildDxf([dxfInsert('B', 0, 0), dxfLine(0, 0, -1, 0)], { blocks: [blk] })
    const [p] = importDxf(dxf, 'b', 'b')
    // Block liegt nach dem Einfügen bei (0..10, 0..10); die Linie nach links verlängert die Breite auf 11
    expect(p.width).toBeCloseTo(11, 6)
  })

  it('ignoriert ausgeschaltete Layer', () => {
    const dxf = buildDxf([dxfLine(0, 0, 10, 0, 'AN'), dxfLine(0, 5, 100, 5, 'AUS')], { layers: [{ name: 'AN' }, { name: 'AUS', off: true }] })
    const [p] = importDxf(dxf, 'l', 'l')
    expect(p.paths).toHaveLength(1)
    expect(p.width).toBeCloseTo(10, 6)
  })

  it('meldet ignorierte Elemente über onNotice', () => {
    const dxf = buildDxf([dxfLine(0, 0, 10, 0), '0\nTEXT\n8\n0\n10\n0\n20\n0\n40\n2\n1\nHallo'])
    const notes: string[] = []
    importDxf(dxf, 't.dxf', 't', { onNotice: (m) => notes.push(m) })
    expect(notes.join(' ')).toMatch(/Text/)
  })

  it('zerlegt mit split in Einzelteile', () => {
    const dxf = buildDxf([dxfCircle(0, 0, 5), dxfCircle(100, 0, 5)])
    expect(importDxf(dxf, 's', 's', { split: true })).toHaveLength(2)
    expect(importDxf(dxf, 's', 's')).toHaveLength(1)
  })

  it('Beispiel-Halterung: Außenkontur, Loch, Langloch und Lasche', () => {
    const [p] = importDxf(sampleBracketDxf(), 'halter.dxf', 'x')
    // Rechteck 4 Linien + Kreis + Langloch + Lasche (Linie+Bogen+Linie) = 4 Konturen; die Lasche hängt an der Platte
    expect(p.paths.filter((q) => q.closed).length).toBeGreaterThanOrEqual(3)
    expect(bbox(p.paths).w).toBeCloseTo(110, 1)
  })

  it('wirft verständliche Fehler bei Müll und leeren Zeichnungen', () => {
    expect(() => importDxf('das ist keine dxf\nnur text', 'x.dxf', 'x')).toThrow(/DXF/)
    expect(() => importDxf(buildDxf([]), 'leer.dxf', 'x')).toThrow(/keine schneidbaren/)
    expect(() => importDxf('', 'leer.dxf', 'x')).toThrow(/DXF/)
  })
})
