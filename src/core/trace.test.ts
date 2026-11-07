import { describe, expect, it } from 'vitest'
import { DEFAULT_TRACE, defaultWidthMm, downscaleImage, hasSignificantAlpha, otsuThreshold, traceImage } from './trace'
import { disc, makeImage } from './traceTestUtil'
import { pathsBox, polygonArea } from './geom'

describe('traceImage', () => {
  it('Kreis: eine Kontur, passende Größe, subpixelgenau', () => {
    const img = makeImage(100, 100, disc(50, 50, 30))
    const r = traceImage(img, { widthMm: 100, smooth: 0 }) // 1 px = 1 mm
    expect(r.empty).toBe(false)
    expect(r.paths).toHaveLength(1)
    const b = pathsBox(r.paths)!
    expect(b.width).toBeGreaterThan(59)
    expect(b.width).toBeLessThan(61.2)
    expect(b.x + b.width / 2).toBeCloseTo(50, 0)
    expect(polygonArea(r.paths[0].points)).toBeGreaterThan(Math.PI * 29 * 29)
    expect(r.paths[0].closed && r.paths[0].filled && r.paths[0].evenOdd).toBe(true)
  })

  it('Ring: Außenkontur und Loch (entgegengesetzte Orientierung)', () => {
    const ring = (x: number, y: number): boolean => disc(60, 60, 50)(x, y) && !disc(60, 60, 25)(x, y)
    const r = traceImage(makeImage(120, 120, ring), { widthMm: 120 })
    expect(r.paths).toHaveLength(2)
    const sa = (pts: { x: number; y: number }[]): number => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y }, 0)
    const [a, b] = r.paths.map((p) => sa(p.points))
    expect(Math.sign(a)).toBe(-Math.sign(b))
    // Even-Odd-Fläche = Ring
    const area = Math.abs(a) / 2 - Math.abs(b) / 2
    expect(area).toBeGreaterThan(Math.PI * (50 * 50 - 25 * 25) * 0.97)
    expect(area).toBeLessThan(Math.PI * (50 * 50 - 25 * 25) * 1.03)
  })

  it('Löcher füllen: nur noch die Außenkontur', () => {
    const ring = (x: number, y: number): boolean => disc(60, 60, 50)(x, y) && !disc(60, 60, 25)(x, y)
    const r = traceImage(makeImage(120, 120, ring), { widthMm: 120, fillHoles: true })
    expect(r.paths).toHaveLength(1)
  })

  it('zwei getrennte Formen', () => {
    const img = makeImage(200, 100, (x, y) => disc(50, 50, 30)(x, y) || (x > 120 && x < 180 && y > 20 && y < 80))
    const r = traceImage(img, { widthMm: 200 })
    expect(r.paths).toHaveLength(2)
  })

  it('Invertieren vertauscht Form und Hintergrund', () => {
    const img = makeImage(100, 100, disc(50, 50, 30))
    const r = traceImage(img, { widthMm: 100, invert: true })
    // Rechteck außen (Bildrand) + Kreis als Loch
    expect(r.paths).toHaveLength(2)
    const big = r.paths.map((p) => polygonArea(p.points)).sort((a, b) => b - a)
    expect(big[0]).toBeGreaterThan(95 * 95)
  })

  it('Transparenz-Modus: Alpha bestimmt die Form, Farbe egal', () => {
    const img = makeImage(100, 100, (x, y) => (disc(50, 50, 30)(x, y) ? [255, 255, 255, 255] : [255, 0, 0, 0]))
    expect(hasSignificantAlpha(img)).toBe(true)
    const r = traceImage(img, { mode: 'alpha', threshold: 128, widthMm: 100 })
    expect(r.paths).toHaveLength(1)
    const b = pathsBox(r.paths)!
    expect(b.width).toBeGreaterThan(59)
    expect(b.width).toBeLessThan(61.2)
    // Im Schwarz/Weiß-Modus würde das weiße Bild auf Transparenz (weiß) nichts liefern
    expect(traceImage(img, { mode: 'bw', widthMm: 100 }).empty).toBe(true)
  })

  it('hasSignificantAlpha: deckendes oder leeres Bild hat keins', () => {
    expect(hasSignificantAlpha(makeImage(20, 20, disc(10, 10, 5)))).toBe(false)
    expect(hasSignificantAlpha(makeImage(20, 20, () => [0, 0, 0, 0]))).toBe(false)
  })

  it('Rauschfilter: Fleck unter n px verschwindet, Standard 8', () => {
    const img = makeImage(100, 100, (x, y) => disc(50, 50, 30)(x, y) || (x >= 5 && x < 7 && y >= 5 && y < 7))
    expect(traceImage(img, { widthMm: 100, speckle: 8 }).paths).toHaveLength(1)
    expect(traceImage(img, { widthMm: 100, speckle: 0, smooth: 0 }).paths).toHaveLength(2)
    // kleines Loch wird gefüllt
    const holed = makeImage(100, 100, (x, y) => disc(50, 50, 30)(x, y) && !(x >= 48 && x < 50 && y >= 48 && y < 50))
    expect(traceImage(holed, { widthMm: 100, speckle: 8 }).paths).toHaveLength(1)
    expect(traceImage(holed, { widthMm: 100, speckle: 0, smooth: 0 }).paths).toHaveLength(2)
  })

  it('Skalierung auf mm: Zielbreite gilt für das ganze Bild', () => {
    const img = makeImage(100, 50, (x, y) => x >= 0 && x < 100 && y >= 10 && y < 40)
    const r = traceImage(img, { widthMm: 50 })
    expect(r.imageWidthMm).toBe(50)
    expect(r.imageHeightMm).toBeCloseTo(25)
    const b = pathsBox(r.paths)!
    expect(b.width).toBeCloseTo(50, 0)
    expect(b.height).toBeCloseTo(15, 0)
    expect(defaultWidthMm(96)).toBeCloseTo(25.4, 1)
  })

  it('Pipette-Modus: nur die gewählte Farbe', () => {
    const img = makeImage(100, 100, (x, y) => (disc(25, 50, 18)(x, y) ? [220, 30, 30, 255] : disc(75, 50, 18)(x, y) ? [30, 30, 220, 255] : [255, 255, 255, 255]))
    const r = traceImage(img, { mode: 'color', color: { r: 220, g: 30, b: 30 }, tolerance: 50, widthMm: 100 })
    expect(r.paths).toHaveLength(1)
    const b = pathsBox(r.paths)!
    expect(b.x + b.width / 2).toBeCloseTo(25, 0)
  })

  it('Leeres Ergebnis wird gemeldet', () => {
    const r = traceImage(makeImage(50, 50, () => false), {})
    expect(r.empty).toBe(true)
    expect(r.paths).toHaveLength(0)
  })

  it('Vereinfachung reduziert die Punktzahl', () => {
    const img = makeImage(200, 200, disc(100, 100, 80))
    const fine = traceImage(img, { widthMm: 200, simplifyPx: 0, smooth: 0 })
    const coarse = traceImage(img, { widthMm: 200, simplifyPx: 2, smooth: 0 })
    expect(coarse.pointCount).toBeLessThan(fine.pointCount / 3)
  })

  it('große Bilder werden vor dem Tracen verkleinert und proportional zurückgerechnet', () => {
    const img = makeImage(3000, 3000, disc(1500, 1500, 1000))
    const d = downscaleImage(img)
    expect(Math.max(d.img.width, d.img.height)).toBe(2000)
    const r = traceImage(img, { widthMm: 300 }) // 0,1 mm/px
    expect(r.downscale).toBeCloseTo(2 / 3, 3)
    const b = pathsBox(r.paths)!
    expect(b.width).toBeGreaterThan(198)
    expect(b.width).toBeLessThan(201.5)
  })

  it('Leistung: 2000 x 2000 in unter 2 s', () => {
    const img = makeImage(2000, 2000, (x, y) => disc(1000, 1000, 800)(x, y) && !disc(1000, 1000, 400)(x, y) || ((x >> 6) + (y >> 6)) % 7 === 0 && x < 300)
    const t = Date.now()
    const r = traceImage(img, { widthMm: 200 })
    expect(Date.now() - t).toBeLessThan(2500)
    expect(r.paths.length).toBeGreaterThan(2)
  })
})

describe('otsuThreshold', () => {
  it('liegt zwischen zwei Helligkeitsgruppen', () => {
    const img = makeImage(100, 100, (x) => (x < 50 ? [40, 40, 40, 255] : [200, 200, 200, 255]))
    const t = otsuThreshold(img)
    expect(t).toBeGreaterThan(40)
    expect(t).toBeLessThanOrEqual(200)
  })
  it('liefert bei einfarbigem Bild einen gültigen Wert', () => {
    const t = otsuThreshold(makeImage(10, 10, () => false))
    expect(t).toBeGreaterThanOrEqual(1)
    expect(t).toBeLessThanOrEqual(254)
    expect(DEFAULT_TRACE.speckle).toBe(8)
  })
})
