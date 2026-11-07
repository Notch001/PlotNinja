import { describe, expect, it } from 'vitest'
import { importPdf, MM_PER_PT } from './pdf'
import { buildPdf, sampleLogoPdf } from './samplePdf'

const A4 = { width: 595, height: 842 }

describe('importPdf', () => {
  it('liest ein gefülltes Rechteck, rechnet pt in mm um', async () => {
    const [p] = await importPdf(buildPdf([{ ...A4, content: '0 g 100 200 150 80 re f' }]), 'rect.pdf', 'C:\\rect.pdf')
    expect(p.name).toBe('rect')
    expect(p.paths).toHaveLength(1)
    expect(p.paths[0].closed).toBe(true)
    expect(p.width).toBeCloseTo(150 * MM_PER_PT, 2)
    expect(p.height).toBeCloseTo(80 * MM_PER_PT, 2)
  })

  it('dreht die Y-Achse um (oben im PDF = oben in der App)', async () => {
    // Linie von (0,0) unten links nach (0,100) -> Startpunkt unten (großes y)
    const [p] = await importPdf(buildPdf([{ ...A4, content: '10 10 m 10 110 l S' }]), 'l.pdf', 'l')
    expect(p.paths[0].closed).toBe(false)
    const pts = p.paths[0].points
    expect(pts[0].y).toBeGreaterThan(pts[1].y)
    expect(pts[0].y - pts[1].y).toBeCloseTo(100 * MM_PER_PT, 3)
  })

  it('wendet cm-Transformationen und q/Q an', async () => {
    const content = 'q 2 0 0 2 50 50 cm 0 0 10 10 re f Q 200 200 10 10 re f'
    const [p] = await importPdf(buildPdf([{ ...A4, content }]), 't.pdf', 't', { weld: false })
    expect(p.paths).toHaveLength(2)
    const sizes = p.paths.map((q) => Math.max(...q.points.map((a) => a.x)) - Math.min(...q.points.map((a) => a.x))).sort((a, b) => a - b)
    expect(sizes[0]).toBeCloseTo(10 * MM_PER_PT, 3) // nach Q wieder ohne Skalierung
    expect(sizes[1]).toBeCloseTo(20 * MM_PER_PT, 3)
  })

  it('flacht Bézierkurven ab (Kreis) und schließt mit h', async () => {
    const [p] = await importPdf(sampleLogoPdf(), 'logo.pdf', 'logo')
    const circ = p.paths.find((q) => q.points.length > 20)
    expect(circ).toBeTruthy()
    expect(circ?.closed).toBe(true)
  })

  it('ignoriert das seitenfüllende Hintergrundrechteck und meldet es', async () => {
    const notes: string[] = []
    const [p] = await importPdf(sampleLogoPdf(), 'logo.pdf', 'logo', { onNotice: (m) => notes.push(m) })
    expect(notes.join(' ')).toMatch(/Hintergrund/)
    expect(p.width).toBeLessThan(297 * MM_PER_PT) // nicht die ganze Seite
  })

  it('vereint überlappende gefüllte Rechtecke per Weld (Standard) und lässt sie ohne Weld getrennt', async () => {
    const content = '0 0 100 100 re f 50 50 100 100 re f'
    const welded = (await importPdf(buildPdf([{ ...A4, content }]), 'w.pdf', 'w'))[0]
    const raw = (await importPdf(buildPdf([{ ...A4, content }]), 'w.pdf', 'w', { weld: false }))[0]
    expect(welded.paths).toHaveLength(1)
    expect(raw.paths).toHaveLength(2)
  })

  it('Strich-Pfade (S) werden nicht vereint', async () => {
    const content = '0 0 100 100 re S 50 50 100 100 re S'
    const [p] = await importPdf(buildPdf([{ ...A4, content }]), 's.pdf', 's')
    expect(p.paths).toHaveLength(2)
  })

  it('Clip-Pfade (W n) werden nicht geschnitten', async () => {
    const content = '0 0 300 300 re W n 20 20 50 50 re f'
    const [p] = await importPdf(buildPdf([{ ...A4, content }]), 'c.pdf', 'c')
    expect(p.paths).toHaveLength(1)
    expect(p.width).toBeCloseTo(50 * MM_PER_PT, 2)
  })

  it('meldet mehrere Seiten und importiert die gewählte', async () => {
    const pdf = buildPdf([
      { ...A4, content: '0 0 10 10 re f' },
      { ...A4, content: '0 0 40 40 re f' }
    ])
    const notes: string[] = []
    const [p1] = await importPdf(pdf, 'm.pdf', 'm', { onNotice: (m) => notes.push(m) })
    expect(p1.width).toBeCloseTo(10 * MM_PER_PT, 3)
    expect(notes.join(' ')).toMatch(/2 Seiten/)
    const [p2] = await importPdf(pdf, 'm.pdf', 'm', { page: 2 })
    expect(p2.width).toBeCloseTo(40 * MM_PER_PT, 3)
  })

  it('weist reinen Text mit klarer Meldung ab', async () => {
    const notes: string[] = []
    const pdf = buildPdf([{ ...A4, content: 'BT /F1 24 Tf 50 700 Td (Hallo) Tj ET' }], { withFont: true })
    await expect(importPdf(pdf, 'text.pdf', 'text', { onNotice: (m) => notes.push(m) })).rejects.toThrow(/Text oder Bilder/)
    expect(notes.join(' ')).toMatch(/Text oder Bilder/)
  })

  it('warnt bei Text neben Pfaden, importiert aber die Pfade', async () => {
    const notes: string[] = []
    const pdf = buildPdf([{ ...A4, content: '0 0 50 50 re f BT /F1 24 Tf 50 700 Td (Hallo) Tj ET' }], { withFont: true })
    const [p] = await importPdf(pdf, 'mix.pdf', 'mix', { onNotice: (m) => notes.push(m) })
    expect(p.paths).toHaveLength(1)
    expect(notes.join(' ')).toMatch(/Text oder Bilder, die nicht geschnitten werden können/)
  })

  it('wirft bei leerer Seite und kaputten Dateien deutsche Fehler', async () => {
    await expect(importPdf(buildPdf([{ ...A4, content: '' }]), 'leer.pdf', 'x')).rejects.toThrow(/keine Vektorpfade/)
    await expect(importPdf(new TextEncoder().encode('das ist kein pdf'), 'k.pdf', 'k')).rejects.toThrow(/keine gültige PDF/)
  })
})
