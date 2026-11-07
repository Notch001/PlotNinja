import { describe, expect, it } from 'vitest'
import type { CutJob } from '@shared/types'
import {
  GPGL_INIT, GPGL_STATUS_QUERY, SILHOUETTE_MODELS, autoBladeDepth, findModel, gpglAbort, jobToGpgl, jobToGpglPlan, parseGpglStatus
} from './gpgl'

const dec = (u: Uint8Array): string => new TextDecoder().decode(u)
const model = (id: string) => SILHOUETTE_MODELS.find((m) => m.id === id)!

function job(passes = 1): CutJob {
  return {
    workArea: { name: 'x', width: 305, height: 305 },
    settings: { blade: 3, force: 12, speed: 4, passes, overcut: 0 },
    paths: [
      { closed: true, points: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 40 }] },
      { closed: false, points: [{ x: 1.5, y: 2.5 }, { x: 3, y: 4 }] }
    ]
  }
}

describe('GP-GL', () => {
  it('kennt alle Modelle mit korrekten IDs', () => {
    expect(findModel(0x0b4d, 0x112b)?.name).toBe('Silhouette Cameo 2')
    expect(findModel(0x0b4d, 0x1139)?.family).toBe('cameo4')
    expect(findModel(0x0b4d, 0x1)).toBeUndefined()
    expect(SILHOUETTE_MODELS).toHaveLength(10)
  })

  it('Escape-Sequenzen', () => {
    expect(Array.from(GPGL_INIT)).toEqual([0x1b, 0x04])
    expect(Array.from(GPGL_STATUS_QUERY)).toEqual([0x1b, 0x05])
    expect(parseGpglStatus(Uint8Array.from([0x30, 0x03]))).toBe('ready')
    expect(parseGpglStatus(Uint8Array.from([0x31, 0x03]))).toBe('moving')
    expect(parseGpglStatus(Uint8Array.from([0x20, 0x20, 0x32, 0x03]))).toBe('unloaded')
    expect(parseGpglStatus(Uint8Array.from([0x39, 0x03]))).toBe('unknown')
  })

  it('Pfade: M/D in 0,05-mm-Einheiten, y zuerst, geschlossen = zurück zum Start', () => {
    const plan = jobToGpglPlan(job(), model('cameo2'))
    expect(plan.paths).toHaveLength(2)
    expect(dec(plan.paths[0].data)).toBe('M400,200\u0003D400,600\u0003D800,600\u0003D400,200\u0003')
    expect(dec(plan.paths[1].data)).toBe('M50,30\u0003D80,60\u0003')
    expect(plan.paths[1].end).toEqual({ x: 3, y: 4 })
  })

  it('Durchgänge wiederholen den Pfad', () => {
    const plan = jobToGpglPlan(job(2), model('cameo2'))
    const s = dec(plan.paths[1].data)
    expect(s).toBe('M50,30\u0003D80,60\u0003M50,30\u0003D80,60\u0003')
  })

  it('Setup Cameo 2: Speed, Druck, Fläche', () => {
    const s = dec(jobToGpglPlan(job(), model('cameo2')).setup)
    expect(s).toContain('!4\u0003')
    expect(s).toContain('FX12\u0003')
    expect(s).toContain('FC18\u0003')
    expect(s).toContain('Z6100,6100\u0003')
    expect(s.endsWith('\u0003')).toBe(true)
  })

  it('Setup Cameo 4 benutzt Werkzeug-Parameter', () => {
    const s = dec(jobToGpglPlan(job(), model('cameo4')).setup)
    expect(s).toContain('J1\u0003')
    expect(s).toContain('FX12,1\u0003')
    expect(s).toContain('!4,1\u0003')
  })

  it('Gesamtfolge: Init, Setup, Pfade, Abschluss; alle Kommandos enden auf ETX', () => {
    const chunks = jobToGpgl(job(), model('cameo3'))
    expect(chunks).toHaveLength(5)
    expect(Array.from(chunks[0])).toEqual([0x1b, 0x04])
    for (const c of chunks.slice(1)) expect(c[c.length - 1]).toBe(0x03)
    expect(dec(chunks[4])).toContain('M0,0\u0003')
  })

  it('Punkte außerhalb der Fläche werden nur angefahren', () => {
    const j = job()
    j.paths = [{ closed: false, points: [{ x: 10, y: 10 }, { x: 400, y: 10 }, { x: 20, y: 20 }] }]
    const s = dec(jobToGpglPlan(j, model('cameo2')).paths[0].data)
    expect(s).toBe('M200,200\u0003M200,8000\u0003M400,400\u0003')
  })

  it('Abbruch sendet Init + Rückfahrt', () => {
    const a = gpglAbort(model('cameo2'))
    expect(a).toHaveLength(2)
    expect(dec(a[1])).toBe('H\u0003')
  })

  describe('AutoBlade (Klingentiefe TF)', () => {
    const setup = (id: string, blade: number): string => {
      const j = job()
      j.settings.blade = blade
      return dec(jobToGpglPlan(j, model(id)).setup)
    }
    const cmdsOf = (s: string): string[] => s.split('\u0003').filter(Boolean)

    it('autoBlade-Flag je Modell (nach Referenz: Cameo 3, Cameo 4-Familie, Portrait 3)', () => {
      const yes = SILHOUETTE_MODELS.filter((m) => m.autoBlade).map((m) => m.id)
      expect(yes).toEqual(['cameo3', 'cameo4', 'cameo4plus', 'cameo4pro', 'portrait3'])
    })

    it('Cameo 3: TF direkt nach dem Messer-Offset, vor Mattensetup', () => {
      const c = cmdsOf(setup('cameo3', 7))
      expect(c).toContain('TF7,1')
      expect(c.indexOf('TF7,1')).toBe(c.lastIndexOf('FC18,1,1') + 1)
      expect(c.indexOf('TF7,1')).toBeLessThan(c.indexOf('TG0'))
    })

    it.each(['cameo4', 'cameo4plus', 'cameo4pro', 'portrait3'])('%s: TF nach FC-Offset (Tool-Block)', (id) => {
      const c = cmdsOf(setup(id, 4))
      expect(c.filter((x) => x.startsWith('TF'))).toEqual(['TF4,1'])
      expect(c.indexOf('TF4,1')).toBe(c.indexOf('FC18,1,1') + 1)
      expect(c.indexOf('TF4,1')).toBeLessThan(c.indexOf('TG0'))
    })

    it.each(['cameo1', 'cameo2', 'portrait1', 'portrait2', 'curio'])('%s: ohne AutoBlade wird KEINE Tiefe gesendet', (id) => {
      expect(setup(id, 7)).not.toContain('TF')
    })

    it('Wertebereich: 1-10 wird übernommen, Ausreißer geklemmt', () => {
      expect(autoBladeDepth(1)).toBe(1)
      expect(autoBladeDepth(10)).toBe(10)
      expect(autoBladeDepth(12)).toBe(10)
      expect(autoBladeDepth(-3)).toBe(0)
      expect(autoBladeDepth(Number.NaN)).toBe(0)
      expect(setup('cameo4', 99)).toContain('TF10,1\u0003')
    })
  })
})
