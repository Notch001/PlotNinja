import { describe, expect, it } from 'vitest'
import type { Polyline } from '@shared/types'
import { IDENTITY } from './geom'
import { PathBuilder, parsePathData } from './pathdata'

function parse(d: string, tol = 0.01): Polyline[] {
  const b = new PathBuilder(IDENTITY, tol)
  parsePathData(d, b)
  return b.finish()
}
const pts = (pl: Polyline): number[][] => pl.points.map((p) => [p.x, p.y])
const close = (a: number[][], b: number[][]): void => {
  expect(a).toHaveLength(b.length)
  a.forEach((p, i) => { expect(p[0]).toBeCloseTo(b[i][0], 6); expect(p[1]).toBeCloseTo(b[i][1], 6) })
}

describe('parsePathData: Zahlenformate', () => {
  it('Zahlen ohne Trenner: "1.5.5" = 1.5 und .5', () => {
    close(pts(parse('M0 0 L1.5.5')[0]), [[0, 0], [1.5, 0.5]])
  })
  it('Vorzeichen als Trenner: "-1-2"', () => {
    close(pts(parse('M0 0 l-1-2')[0]), [[0, 0], [-1, -2]])
  })
  it('Exponenten: "1e-3" und "1E2"', () => {
    close(pts(parse('M0 0 L1e-3 1E2')[0]), [[0, 0], [0.001, 100]])
  })
  it('Komma, Zeilenumbrüche und Tabs als Trenner', () => {
    close(pts(parse('M0,0\nL\t10,\n5')[0]), [[0, 0], [10, 5]])
  })
  it('führender Punkt und Plus-Zeichen', () => {
    close(pts(parse('M+.5+.5L-.5.5')[0]), [[0.5, 0.5], [-0.5, 0.5]])
  })
})

describe('parsePathData: Kommandos', () => {
  it('nach M folgende Paare sind LineTo (absolut und relativ)', () => {
    close(pts(parse('M0 0 10 0 10 10')[0]), [[0, 0], [10, 0], [10, 10]])
    close(pts(parse('m1 1 10 0 0 10')[0]), [[1, 1], [11, 1], [11, 11]])
  })
  it('implizit wiederholte L, H, V', () => {
    close(pts(parse('M0 0 L1 0 2 0 3 1')[0]), [[0, 0], [1, 0], [2, 0], [3, 1]])
    close(pts(parse('M0 0 H1 2 3')[0]), [[0, 0], [1, 0], [2, 0], [3, 0]])
    close(pts(parse('M0 0 h1 1 1 v1 1')[0]), [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2]])
  })
  it('mehrere Koordinatentupel nach C, Q, A', () => {
    const c = parse('M0 0 C0 10 10 10 10 0 10 -10 20 -10 20 0')[0]
    expect(c.points[c.points.length - 1].x).toBeCloseTo(20)
    expect(Math.max(...c.points.map((p) => p.y))).toBeGreaterThan(5)
    expect(Math.min(...c.points.map((p) => p.y))).toBeLessThan(-5)
    const q = parse('M0 0 Q5 10 10 0 15 -10 20 0')[0]
    expect(q.points[q.points.length - 1].x).toBeCloseTo(20)
    expect(Math.max(...q.points.map((p) => p.y))).toBeGreaterThan(3)
    expect(Math.min(...q.points.map((p) => p.y))).toBeLessThan(-3)
    const a = parse('M0 0 A5 5 0 0 1 10 0 5 5 0 0 0 20 0')[0]
    expect(a.points[a.points.length - 1].x).toBeCloseTo(20)
    expect(Math.min(...a.points.map((p) => p.y))).toBeLessThan(-4.9)
    expect(Math.max(...a.points.map((p) => p.y))).toBeGreaterThan(4.9)
  })
  it('relative Kommandos addieren zum aktuellen Punkt', () => {
    const r = parse('M10 10 l5 0 l0 5 h-5 v-5')[0]
    expect(r.closed).toBe(true) // endet am Startpunkt
    close(pts(r), [[10, 10], [15, 10], [15, 15], [10, 15]])
  })
  it('m nach z beginnt am Startpunkt des letzten Teilpfads', () => {
    const r = parse('M10 10 l10 0 l0 10 z m5 5 l10 0 l0 10 z')
    expect(r).toHaveLength(2)
    expect(r[0].closed).toBe(true)
    // zweiter Teilpfad startet bei (10,10)+(5,5) = (15,15), NICHT beim letzten Punkt (20,20)+(5,5)
    close(pts(r[1]), [[15, 15], [25, 15], [25, 25]])
  })
  it('Z setzt die aktuelle Position auf den Teilpfad-Start (L ohne M danach)', () => {
    const r = parse('M10 10 L20 10 L20 20 Z L0 0 L0 10')
    expect(r).toHaveLength(2)
    close(pts(r[1]), [[10, 10], [0, 0], [0, 10]])
    const rel = parse('M10 10 L20 10 L20 20 Z l5 5 l5 0')
    close(pts(rel[1]), [[10, 10], [15, 15], [20, 15]])
  })
  it('mehrere Teilpfade in einem path', () => {
    const r = parse('M0 0 L10 0 L10 10 Z M2 2 L4 2 L4 4 Z M20 20 L30 30')
    expect(r).toHaveLength(3)
    expect(r.map((p) => p.closed)).toEqual([true, true, false])
  })
  it('S spiegelt den zweiten Kontrollpunkt des vorherigen C/S', () => {
    // Zwei C-Kurven mit expliziter Spiegelung müssen identisch zu C + S sein
    const full = parse('M0 0 C0 10 10 10 10 0 C10 -10 20 -10 20 0', 0.001)[0]
    const smooth = parse('M0 0 C0 10 10 10 10 0 S20 -10 20 0', 0.001)[0]
    close(pts(smooth), pts(full))
    // S ohne vorheriges C: erster Kontrollpunkt = aktueller Punkt
    const plain = parse('M0 0 S10 10 10 0', 0.001)[0]
    const ref = parse('M0 0 C0 0 10 10 10 0', 0.001)[0]
    close(pts(plain), pts(ref))
  })
  it('S nach relativem c (Reflexion in absoluten Koordinaten)', () => {
    const rel = parse('M0 0 c0 10 10 10 10 0 s10 -10 10 0', 0.001)[0]
    const abs = parse('M0 0 C0 10 10 10 10 0 C10 -10 20 -10 20 0', 0.001)[0]
    close(pts(rel), pts(abs))
  })
  it('T spiegelt den Kontrollpunkt von Q/T', () => {
    const full = parse('M0 0 Q5 10 10 0 Q15 -10 20 0', 0.001)[0]
    const smooth = parse('M0 0 Q5 10 10 0 T20 0', 0.001)[0]
    close(pts(smooth), pts(full))
    const chain = parse('M0 0 Q5 10 10 0 T20 0 T30 0', 0.001)[0]
    const chainFull = parse('M0 0 Q5 10 10 0 Q15 -10 20 0 Q25 10 30 0', 0.001)[0]
    close(pts(chain), pts(chainFull))
    // T ohne vorheriges Q: gerade Linie
    close(pts(parse('M0 0 T10 0')[0]), [[0, 0], [10, 0]])
  })
})

describe('parsePathData: Bögen', () => {
  it('Flags ohne Trenner: "a1 1 0 01.5.5"', () => {
    const a = parse('M0 0 a1 1 0 01.5.5')[0]
    const b = parse('M0 0 a1 1 0 0 1 .5 .5')[0]
    close(pts(a), pts(b))
    expect(a.points[a.points.length - 1].x).toBeCloseTo(0.5)
    expect(a.points[a.points.length - 1].y).toBeCloseTo(0.5)
  })
  it('Flags ohne Trenner, gefolgt von negativer Zahl und Wiederholung', () => {
    const r = parse('m10 10a5 5 0 1010 0a5 5 0 10-10 0z')[0]
    expect(r.closed).toBe(true)
    const xs = r.points.map((p) => p.x), ys = r.points.map((p) => p.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 1)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(10, 1)
  })
  it('zu kleine Radien werden hochskaliert (Halbkreis)', () => {
    const r = parse('M0 0 A1 1 0 0 1 10 0', 0.001)[0]
    const ys = r.points.map((p) => p.y)
    expect(Math.max(...ys.map(Math.abs))).toBeCloseTo(5, 2)
    expect(r.points[r.points.length - 1].x).toBeCloseTo(10)
    for (const p of r.points) expect(Math.hypot(p.x - 5, p.y)).toBeCloseTo(5, 1)
  })
  it('Large-arc- und Sweep-Flag wählen den richtigen Bogen', () => {
    const maxAbsY = (d: string): number => Math.max(...parse(d, 0.001)[0].points.map((p) => Math.abs(p.y)))
    // Sehne (0,0)->(10,0), r=10: kleiner Bogen Höhe ~1.34, großer Bogen Höhe ~18.66
    expect(maxAbsY('M0 0 A10 10 0 0 1 10 0')).toBeCloseTo(1.34, 1)
    expect(maxAbsY('M0 0 A10 10 0 1 1 10 0')).toBeCloseTo(18.66, 1)
    const sy = (d: string): number => parse(d, 0.001)[0].points[3].y
    expect(Math.sign(sy('M0 0 A10 10 0 0 1 10 0'))).toBe(-Math.sign(sy('M0 0 A10 10 0 0 0 10 0')))
  })
  it('gedrehte Ellipse trifft den Endpunkt', () => {
    const r = parse('M0 0 A20 5 30 0 1 15 10')[0]
    expect(r.points[r.points.length - 1].x).toBeCloseTo(15)
    expect(r.points[r.points.length - 1].y).toBeCloseTo(10)
  })
  it('Radius 0 = Gerade, identische Endpunkte = nichts', () => {
    close(pts(parse('M0 0 A0 5 0 0 1 10 10')[0]), [[0, 0], [10, 10]])
    expect(parse('M0 0 A5 5 0 0 1 0 0 L5 5')[0].points).toHaveLength(2)
  })
})

describe('parsePathData: Flattening', () => {
  it('Schleife: Kontrollpunkte jenseits der Endpunkte werden nicht zur Geraden', () => {
    // Endpunkte sehr nah beieinander, Kurve macht eine große Schleife
    const r = parse('M0 0 C20 20 -20 20 0.001 0', 0.01)[0]
    const ys = r.points.map((p) => p.y)
    expect(Math.max(...ys)).toBeGreaterThan(10)
    expect(r.points.length).toBeGreaterThan(10)
  })
  it('Kurve mit Spitze (Kontrollpunkte kollinear mit der Sehne, aber außerhalb)', () => {
    const r = parse('M0 0 C60 0 -50 0 10 0', 0.01)[0]
    // Die Kurve schwingt weit über x=10 hinaus; sie darf nicht zur Sehne (0,0)-(10,0) kollabieren
    expect(Math.max(...r.points.map((p) => p.x))).toBeGreaterThan(15)
  })
  it('Kreisbogen-Abweichung bleibt unter der Toleranz', () => {
    const r = parse('M10 0 A10 10 0 1 1 -10 0 A10 10 0 1 1 10 0 Z', 0.05)[0]
    for (const p of r.points) expect(Math.abs(Math.hypot(p.x, p.y) - 10)).toBeLessThan(0.06)
    expect(r.closed).toBe(true)
  })
  it('Fehlerhafter Rest wird ignoriert, Anfang bleibt erhalten', () => {
    const r = parse('M0 0 L10 0 L10 10 L x')
    close(pts(r[0]), [[0, 0], [10, 0], [10, 10]])
  })
})
