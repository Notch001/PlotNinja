import { describe, expect, it } from 'vitest'
import { importSvg } from './index'

const wrap = (inner: string, attrs = 'width="100mm" height="100mm" viewBox="0 0 100 100"'): string =>
  `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${inner}</svg>`

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

  it('splittet mehrere Bauteile und ordnet Löcher dem Außenteil zu', () => {
    const svg = wrap(`
      <rect x="0" y="0" width="30" height="30"/>
      <circle cx="15" cy="15" r="5"/>
      <rect x="50" y="0" width="20" height="20"/>
      <rect x="55" y="5" width="5" height="5"/>
      <circle cx="90" cy="90" r="0.1"/>`)
    const parts = importSvg(svg, 'multi.svg', 'multi.svg')
    expect(parts).toHaveLength(2)
    expect(parts[0].name).toBe('multi')
    expect(parts[1].name).toBe('multi 2')
    expect(parts[0].paths).toHaveLength(2)
    expect(parts[1].paths).toHaveLength(2)
    expect(parts[0].width).toBeCloseTo(30)
    expect(parts[1].width).toBeCloseTo(20)
  })

  it('split:false liefert ein einziges Teil', () => {
    const svg = wrap('<rect width="10" height="10"/><rect x="50" y="50" width="10" height="10"/>')
    const parts = importSvg(svg, 'a.svg', 'a', { split: false })
    expect(parts).toHaveLength(1)
    expect(parts[0].width).toBeCloseTo(60)
  })

  it('wirft verständliche Fehler', () => {
    expect(() => importSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'e.svg', 'e')).toThrow(/keine schneidbaren Pfade/)
    expect(() => importSvg('hallo', 'e.svg', 'e')).toThrow(/keine gültige SVG/)
  })
})
