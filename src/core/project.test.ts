import { describe, expect, it } from 'vitest'
import type { Part } from '@shared/types'
import { DEFAULT_CUT } from '@shared/types'
import { parseProject, serializeProject, type ProjectData } from './project'

const part = (id: string, extra: Partial<Part> = {}): Part => ({
  id, name: 'Stern ' + id, sourcePath: 'C:\\x\\stern.svg',
  paths: [
    { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5.5 }], closed: true, evenOdd: true, src: 3 },
    { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], closed: false, filled: false }
  ],
  width: 10, height: 5.5, x: 12.25, y: 40, rotation: 30, scale: 1.5, ...extra
})

const data = (): ProjectData => ({
  parts: [part('a', { groupId: 'g' }), part('b', { groupId: 'g' }), part('c')],
  workArea: { name: 'Test', width: 300, height: 400 },
  cut: { ...DEFAULT_CUT, force: 20, passes: 2 },
  weldOnImport: false,
  view: { zoom: 2, panX: 10, panY: 20 }
})

describe('Projektdatei', () => {
  it('Roundtrip erhält Teile, Gruppen, Arbeitsfläche, Schnitt und Optionen', () => {
    const d = data()
    const back = parseProject(serializeProject(d))
    expect(back.parts).toEqual(d.parts)
    expect(back.workArea).toEqual(d.workArea)
    expect(back.cut).toEqual(d.cut)
    expect(back.weldOnImport).toBe(false)
    expect(back.view).toEqual(d.view)
  })

  it('schreibt Format und Version', () => {
    const j = JSON.parse(serializeProject(data()))
    expect(j.format).toBe('plotninja-project')
    expect(j.version).toBe(1)
  })

  it('rundet Koordinaten auf 0,0001 mm', () => {
    const d = data()
    d.parts[0].paths[0].points[1].x = 1 / 3
    expect(parseProject(serializeProject(d)).parts[0].paths[0].points[1].x).toBe(0.3333)
  })

  it('füllt fehlende Felder mit Standardwerten', () => {
    const p = parseProject(JSON.stringify({
      format: 'plotninja-project', version: 1,
      parts: [{ paths: [{ points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }], closed: true }] }]
    }))
    expect(p.parts).toHaveLength(1)
    expect(p.parts[0].scale).toBe(1)
    expect(p.parts[0].rotation).toBe(0)
    expect(p.parts[0].width).toBe(4)
    expect(p.parts[0].height).toBe(3)
    expect(p.parts[0].id).toBeTruthy()
    expect(p.cut).toEqual(DEFAULT_CUT)
    expect(p.weldOnImport).toBe(true)
    expect(p.workArea.width).toBeGreaterThan(0)
    expect(p.view).toBeUndefined()
  })

  it('akzeptiert ein Projekt ohne Teile', () => {
    expect(parseProject('{"format":"plotninja-project","version":1}').parts).toEqual([])
  })

  it('vergibt neue ids bei Duplikaten und löst Einzelgruppen auf', () => {
    const d = data()
    d.parts = [part('x', { groupId: 'solo' }), part('x')]
    const p = parseProject(serializeProject(d))
    expect(new Set(p.parts.map((q) => q.id)).size).toBe(2)
    expect(p.parts[0].groupId).toBeUndefined()
  })

  it('ersetzt unbrauchbare Zahlen durch Standardwerte', () => {
    const j = JSON.parse(serializeProject(data()))
    j.parts[0].scale = -3
    j.parts[0].x = 'abc'
    j.cut.force = null
    j.workArea.width = -5
    const p = parseProject(JSON.stringify(j))
    expect(p.parts[0].scale).toBe(1)
    expect(p.parts[0].x).toBe(0)
    expect(p.cut.force).toBe(DEFAULT_CUT.force)
    expect(p.workArea.width).toBeGreaterThan(0)
  })

  it('lehnt kaputte Dateien mit deutscher Meldung ab', () => {
    expect(() => parseProject('{kaputt')).toThrow(/gültige PlotNinja-Projektdatei/)
    expect(() => parseProject('[]')).toThrow(/keine PlotNinja-Projektdatei/)
    expect(() => parseProject('{"format":"anderes","version":1}')).toThrow(/keine PlotNinja-Projektdatei/)
    expect(() => parseProject('{"format":"plotninja-project"}')).toThrow(/Versionsangabe/)
    expect(() => parseProject('{"format":"plotninja-project","version":2}')).toThrow(/neueren PlotNinja-Version/)
    expect(() => parseProject('{"format":"plotninja-project","version":1,"parts":5}')).toThrow(/Bauteilliste/)
    expect(() => parseProject('{"format":"plotninja-project","version":1,"parts":[7]}')).toThrow(/Bauteil 1/)
    expect(() => parseProject('{"format":"plotninja-project","version":1,"parts":[{"paths":[]}]}')).toThrow(/keine gültigen Pfade/)
  })

  it('verwirft Pfade mit nicht endlichen Zahlen', () => {
    const j = JSON.stringify({
      format: 'plotninja-project', version: 1,
      parts: [{ paths: [{ points: [{ x: 0, y: 0 }, { x: 'NaN', y: 1 }] }] }]
    })
    expect(() => parseProject(j)).toThrow(/keine gültigen Pfade/)
  })

  it('übersteht ein BOM am Dateianfang', () => {
    expect(parseProject('\uFEFF' + serializeProject(data())).parts).toHaveLength(3)
  })
})
