import { describe, expect, it } from 'vitest'
import type { Part } from '@shared/types'
import { importSvg, partBounds, splitPart } from './index'
import { LETTERING_CONTOURS, LETTERING_ORDER, letteringSvg } from './sampleSvgs'

const wrap = (inner: string, attrs = 'width="100mm" height="100mm" viewBox="0 0 100 100"'): string =>
  `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${inner}</svg>`

function unionOf(parts: Part[]): { x: number; y: number; width: number; height: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of parts) {
    const b = partBounds(p)
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

describe('importSvg', () => {
  it('liest ein rect in mm', () => {
    const [p] = importSvg(wrap('<rect x="10" y="20" width="30" height="40"/>'), 'box.svg', '/x/box.svg')
    expect(p.name).toBe('box')
    expect(p.width).toBeCloseTo(30)
    expect(p.height).toBeCloseTo(40)
    expect(p.x).toBe(0)
    expect(p.scale).toBe(1)
    expect(p.paths).toHaveLength(1)
    expect(p.paths[0].closed).toBe(true)
    const xs = p.paths[0].points.map((q) => q.x)
    expect(Math.min(...xs)).toBeCloseTo(0)
  })

  it('liest einen Kreis', () => {
    const [p] = importSvg(wrap('<circle cx="50" cy="50" r="10"/>'), 'c.svg', 'c.svg')
    expect(p.width).toBeCloseTo(20, 1)
    expect(p.height).toBeCloseTo(20, 1)
    expect(p.paths[0].closed).toBe(true)
    expect(p.paths[0].points.length).toBeGreaterThan(8)
  })

  it('zerlegt Pfade mit Kurven und Bögen', () => {
    const d = 'M10 10 H 50 A 20 20 0 0 1 70 30 V 60 C 70 80 40 80 40 60 Q 20 60 10 40 Z'
    const [p] = importSvg(wrap(`<path d="${d}"/>`), 'p.svg', 'p.svg')
    expect(p.paths[0].closed).toBe(true)
    expect(p.paths[0].points.length).toBeGreaterThan(15)
    expect(p.width).toBeCloseTo(60, 0)
  })

  it('Halbkreis-Bogen hat die richtige Ausdehnung', () => {
    const [p] = importSvg(wrap('<path d="M 10 50 A 20 20 0 0 1 50 50"/>'), 'a.svg', 'a.svg')
    expect(p.width).toBeCloseTo(40, 1)
    expect(p.height).toBeCloseTo(20, 1)
    expect(p.paths[0].closed).toBe(false)
  })

  it('kompakte Arc-Flags und relative Kommandos', () => {
    const [p] = importSvg(wrap('<path d="m10 10a5 5 0 1010 0a5 5 0 10-10 0z"/>'), 'a.svg', 'a.svg')
    expect(p.width).toBeCloseTo(10, 1)
    expect(p.height).toBeCloseTo(10, 1)
  })

  it('beachtet Einheiten (cm, in, pt) und fehlende viewBox', () => {
    const cm = importSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10cm" height="5cm" viewBox="0 0 10 5"><rect width="10" height="5"/></svg>', 'a.svg', 'a')[0]
    expect(cm.width).toBeCloseTo(100)
    expect(cm.height).toBeCloseTo(50)
    const px = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="96" height="48"/></svg>', 'a.svg', 'a')[0]
    expect(px.width).toBeCloseTo(25.4)
    expect(px.height).toBeCloseTo(12.7)
    const inch = importSvg('<svg xmlns="http://www.w3.org/2000/svg" width="2in" height="1in" viewBox="0 0 200 100"><rect width="200" height="100"/></svg>', 'a.svg', 'a')[0]
    expect(inch.width).toBeCloseTo(50.8)
    const pt = importSvg('<svg xmlns="http://www.w3.org/2000/svg" width="72pt" height="72pt" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>', 'a.svg', 'a')[0]
    expect(pt.width).toBeCloseTo(25.4)
  })

  it('viewBox-Einheiten als px, wenn width/height fehlen', () => {
    const [p] = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96"/></svg>', 'a.svg', 'a')
    expect(p.width).toBeCloseTo(25.4)
  })

  it('wendet verschachtelte transforms an', () => {
    const svg = wrap('<g transform="translate(10,0) scale(2)"><rect width="5" height="5" transform="rotate(90)"/></g>')
    const [p] = importSvg(svg, 't.svg', 't')
    expect(p.width).toBeCloseTo(10)
    expect(p.height).toBeCloseTo(10)
    const m = importSvg(wrap('<rect width="10" height="5" transform="matrix(1 0 0 2 0 0)"/>'), 't.svg', 't')[0]
    expect(m.height).toBeCloseTo(10)
  })

  it('ignoriert defs, text, clipPath und display:none; use funktioniert', () => {
    const svg = wrap(`
      <defs><rect id="r" width="10" height="10"/><clipPath id="c"><rect width="100" height="100"/></clipPath></defs>
      <text x="1" y="1">Hi</text>
      <rect width="50" height="50" style="display:none"/>
      <use href="#r" x="20" y="20"/>`)
    const parts = importSvg(svg, 'u.svg', 'u')
    expect(parts).toHaveLength(1)
    expect(parts[0].width).toBeCloseTo(10)
  })

  it('importiert standardmäßig EIN Teil mit der Originalanordnung', () => {
    const svg = wrap('<rect width="10" height="10"/><rect x="50" y="50" width="10" height="10"/><circle cx="30" cy="80" r="5"/>')
    const parts = importSvg(svg, 'a.svg', 'a')
    expect(parts).toHaveLength(1)
    expect(parts[0].width).toBeCloseTo(60)
    expect(parts[0].height).toBeCloseTo(85)
    expect(parts[0].paths).toHaveLength(3)
    expect(importSvg(svg, 'a.svg', 'a', { split: false })).toHaveLength(1)
  })

  it('splittet mehrere Bauteile und ordnet Löcher dem Außenteil zu', () => {
    const svg = wrap(`
      <rect x="0" y="0" width="30" height="30"/>
      <circle cx="15" cy="15" r="5"/>
      <rect x="50" y="0" width="20" height="20"/>
      <rect x="55" y="5" width="5" height="5"/>
      <circle cx="90" cy="90" r="0.1"/>`)
    const parts = importSvg(svg, 'multi.svg', 'multi.svg', { split: true, weld: false })
    // das winzige Teil (0,2 mm) wird nicht verworfen
    expect(parts).toHaveLength(3)
    expect(parts[0].name).toBe('multi')
    expect(parts[1].name).toBe('multi 2')
    expect(parts[0].paths).toHaveLength(2)
    expect(parts[1].paths).toHaveLength(2)
    expect(parts[0].width).toBeCloseTo(30)
    expect(parts[1].width).toBeCloseTo(20)
    expect(parts[2].paths).toHaveLength(1)
    expect(parts[2].width).toBeLessThan(0.5)
  })

  it('split: Teile behalten ihre relative Lage (Offsets zur Gesamt-bbox)', () => {
    const svg = wrap('<rect x="10" y="20" width="10" height="10"/><rect x="50" y="60" width="20" height="5"/>')
    const parts = importSvg(svg, 'a.svg', 'a', { split: true })
    expect(parts).toHaveLength(2)
    expect(parts[0].x).toBeCloseTo(0)
    expect(parts[0].y).toBeCloseTo(0)
    expect(parts[1].x).toBeCloseTo(40)
    expect(parts[1].y).toBeCloseTo(40)
    // Ursprünglicher Gesamtumriss ist über die Offsets rekonstruierbar
    const right = Math.max(...parts.map((p) => partBounds(p).x + partBounds(p).width))
    expect(right).toBeCloseTo(60)
  })

  it('split: verschachtelte Konturen nach Even-Odd (Teil im Loch eines Rings bleibt eigenes Teil)', () => {
    const svg = wrap('<circle cx="50" cy="50" r="40"/><circle cx="50" cy="50" r="30"/><circle cx="50" cy="50" r="10"/><circle cx="50" cy="50" r="5"/>')
    const parts = importSvg(svg, 'r.svg', 'r', { split: true, weld: false })
    expect(parts).toHaveLength(2)
    expect(parts.map((p) => p.paths.length).sort()).toEqual([2, 2])
  })

  it('split: halb überlappende Konturen werden nicht zerrissen', () => {
    const svg = wrap('<rect x="0" y="0" width="20" height="20"/><rect x="10" y="10" width="20" height="20"/><rect x="60" y="0" width="10" height="10"/>')
    const parts = importSvg(svg, 'o.svg', 'o', { split: true, weld: false })
    expect(parts).toHaveLength(2)
    expect(parts[0].paths).toHaveLength(2)
    expect(parts[0].width).toBeCloseTo(30)
  })

  it('split: offene Pfade in einem Teil bleiben dort', () => {
    const svg = wrap('<rect width="40" height="40"/><path d="M10 10L30 30"/><path d="M80 80L90 90"/>')
    const parts = importSvg(svg, 'l.svg', 'l', { split: true })
    expect(parts).toHaveLength(2)
    expect(parts[0].paths).toHaveLength(2)
  })

  it('style-Attribut, <style>-Klassen und visibility blenden Elemente aus', () => {
    const svg = wrap(`<style>.weg, #auch { display:none } rect.x { visibility: hidden }</style>
      <rect width="10" height="10"/>
      <rect class="a weg" x="20" width="50" height="50"/>
      <rect id="auch" x="20" width="50" height="50"/>
      <rect class="x" x="20" width="50" height="50"/>
      <rect style="fill:red; display : none" x="20" width="50" height="50"/>
      <g style="display:none"><rect x="20" width="50" height="50"/></g>`)
    const parts = importSvg(svg, 's.svg', 's')
    expect(parts).toHaveLength(1)
    expect(parts[0].paths).toHaveLength(1)
    expect(parts[0].width).toBeCloseTo(10)
  })

  it('transform aus style und CSS-Klassen wird angewandt', () => {
    const svg = wrap('<style>.t { transform: translate(10px, 5px) }</style><rect class="t" width="10" height="10"/><rect style="transform: translate(40px,0)" width="10" height="10"/>')
    const [p] = importSvg(svg, 's.svg', 's')
    expect(p.width).toBeCloseTo(40) // 10..20 und 40..50
  })

  it('transform-Zahlen ohne Trenner und verkettete transforms', () => {
    const [a] = importSvg(wrap('<rect width="10" height="10" transform="translate(10-5)"/><rect width="10" height="10" transform="translate(0,0) scale(.5.5)"/>'), 't.svg', 't')
    // erstes Rechteck 10..20 x -5..5, zweites 0..5 x 0..5
    expect(a.width).toBeCloseTo(20)
    expect(a.height).toBeCloseTo(10)
    const [b] = importSvg(wrap('<rect width="10" height="10" transform="rotate(90)translate(5 0)"/>'), 't.svg', 't')
    expect(b.width).toBeCloseTo(10)
  })

  it('use mit transform, x/y und verschachtelten Gruppen', () => {
    const svg = wrap(`<defs><g id="g"><rect width="10" height="10"/></g></defs>
      <use href="#g" x="5" y="5"/><use xlink:href="#g" transform="translate(50 0) scale(2)"/>`)
    const [p] = importSvg(svg, 'u.svg', 'u')
    expect(p.paths).toHaveLength(2)
    expect(p.width).toBeCloseTo(65) // 5..15 und 50..70
    expect(p.height).toBeCloseTo(20)
  })

  describe('Schriftzug (Text als Pfade)', () => {
    const svg = letteringSvg()

    it('als ein Teil: alle Konturen in Originalanordnung, Größe 150 × 20 mm (ohne verstecktes Element)', () => {
      const [p] = importSvg(svg, 'schriftzug.svg', 's')
      const total = LETTERING_ORDER.reduce((s, g) => s + LETTERING_CONTOURS[g], 0)
      expect(p.paths).toHaveLength(total)
      expect(p.paths.every((pl) => pl.closed)).toBe(true)
      // Glyphen sitzen in Zellen von 36 Einheiten; viewBox-Breite 327 -> 150 mm
      expect(p.width).toBeGreaterThan(130)
      expect(p.width).toBeLessThan(150)
      expect(p.height).toBeGreaterThan(15)
      expect(p.height).toBeLessThan(20)
    })

    it('zerlegt in genau eine Glyphe je Teil, Löcher beim richtigen Buchstaben, keine Fragmente', () => {
      const parts = importSvg(svg, 'schriftzug.svg', 's', { split: true })
      expect(parts).toHaveLength(LETTERING_ORDER.length)
      const byX = [...parts].sort((a, b) => a.x - b.x)
      byX.forEach((p, i) => {
        const g = LETTERING_ORDER[i]
        expect(p.paths, `Glyphe ${g}`).toHaveLength(LETTERING_CONTOURS[g])
        expect(p.width, `Breite ${g}`).toBeGreaterThan(2)
        expect(p.height, `Höhe ${g}`).toBeGreaterThan(6)
      })
      // Gesamtumriss der Teile == Umriss der Einzeldatei
      const [whole] = importSvg(svg, 'schriftzug.svg', 's')
      const bb = unionOf(parts)
      expect(bb.width).toBeCloseTo(whole.width, 3)
      expect(bb.height).toBeCloseTo(whole.height, 3)
      // Teile liegen links nach rechts in der Reihenfolge des Schriftzugs, ohne sich zu überlappen
      for (let i = 1; i < byX.length; i++) expect(byX[i].x).toBeGreaterThan(byX[i - 1].x + byX[i - 1].width - 1e-6)
    })

    it('die Punktzahl aller Konturen bleibt beim Zerlegen identisch (nichts geht verloren)', () => {
      const count = (ps: Part[]): number => ps.reduce((s, p) => s + p.paths.reduce((t, pl) => t + pl.points.length, 0), 0)
      expect(count(importSvg(svg, 's.svg', 's', { split: true }))).toBe(count(importSvg(svg, 's.svg', 's')))
    })
  })

  describe('splitPart', () => {
    const svg = wrap('<rect x="10" y="20" width="10" height="10"/><rect x="50" y="60" width="20" height="5"/><circle cx="55" cy="62.5" r="1"/>')
    it('behält die Lage der Teile zueinander und an der Position des Originals', () => {
      const [whole] = importSvg(svg, 'a.svg', 'a')
      const placed = { ...whole, x: 100, y: 30 }
      const pieces = splitPart(placed)
      expect(pieces).toHaveLength(2)
      expect(pieces.every((p) => p.scale === 1 && p.rotation === 0)).toBe(true)
      const ub = unionOf(pieces)
      expect(ub.x).toBeCloseTo(100)
      expect(ub.y).toBeCloseTo(30)
      expect(ub.width).toBeCloseTo(whole.width)
      expect(ub.height).toBeCloseTo(whole.height)
      expect(pieces[1].x - pieces[0].x).toBeCloseTo(40)
      expect(pieces[1].y - pieces[0].y).toBeCloseTo(40)
      expect(new Set(pieces.map((p) => p.id)).size).toBe(2)
      expect(pieces.every((p) => p.id !== whole.id)).toBe(true)
    })
    it('rechnet Skalierung und Drehung in die Geometrie ein', () => {
      const [whole] = importSvg(svg, 'a.svg', 'a')
      const t = { ...whole, x: 10, y: 10, scale: 2, rotation: 90 }
      const before = partBounds(t)
      const pieces = splitPart(t)
      expect(pieces).toHaveLength(2)
      const ub = unionOf(pieces)
      expect(ub.x).toBeCloseTo(before.x)
      expect(ub.y).toBeCloseTo(before.y)
      expect(ub.width).toBeCloseTo(before.width)
      expect(ub.height).toBeCloseTo(before.height)
    })
    it('liefert das Teil selbst zurück, wenn es nur aus einem Stück besteht', () => {
      const [one] = importSvg(wrap('<rect width="10" height="10"/><circle cx="5" cy="5" r="2"/>'), 'a.svg', 'a')
      expect(splitPart(one)).toEqual([one])
    })
  })

  it('wirft verständliche Fehler', () => {
    expect(() => importSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'e.svg', 'e')).toThrow(/keine schneidbaren Pfade/)
    expect(() => importSvg('hallo', 'e.svg', 'e')).toThrow(/keine gültige SVG/)
  })
})
