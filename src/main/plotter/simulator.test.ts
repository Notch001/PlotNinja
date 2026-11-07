import { describe, expect, it } from 'vitest'
import type { CutJob, PlotEvent } from '@shared/types'
import { motionSeconds } from '@core/timing'
import { SimulatorDevice } from './simulator'

const job: CutJob = {
  workArea: { name: 'x', width: 300, height: 300 },
  settings: { blade: 3, force: 10, speed: 10, passes: 1, overcut: 0 },
  paths: [
    { closed: true, points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }] },
    { closed: false, points: [{ x: 30, y: 30 }, { x: 40, y: 30 }] }
  ]
}

describe('SimulatorDevice', () => {
  it('spielt einen Job ab und meldet Ereignisse', async () => {
    const ev: PlotEvent[] = []
    await new SimulatorDevice().run(job, (e) => ev.push(e), new AbortController().signal)
    expect(ev[0].type).toBe('started')
    expect(ev[ev.length - 1].type).toBe('finished')
    const done = ev.filter((e) => e.type === 'progress' && e.done)
    expect(done).toHaveLength(2)
    expect(ev.some((e) => e.type === 'progress' && !e.done)).toBe(true)
  })

  it('läuft in Echtzeit (Dauer = motionSeconds)', async () => {
    const expected = motionSeconds(job) // ca. 1 s bei Stufe 10
    expect(expected).toBeGreaterThan(0.5)
    const t0 = Date.now()
    await new SimulatorDevice().run(job, () => {}, new AbortController().signal)
    const took = (Date.now() - t0) / 1000
    expect(took).toBeGreaterThan(expected * 0.85)
    expect(took).toBeLessThan(expected * 1.5 + 0.3)
  })

  it('bricht ab', async () => {
    const ev: PlotEvent[] = []
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 120)
    await new SimulatorDevice().run(job, (e) => ev.push(e), ctrl.signal)
    expect(ev[ev.length - 1].type).toBe('cancelled')
  })

  it('Fehlerfall disconnect: Fehler mit deviceLost, kein "finished"', async () => {
    const ev: PlotEvent[] = []
    await new SimulatorDevice('disconnect').run(job, (e) => ev.push(e), new AbortController().signal)
    const last = ev[ev.length - 1]
    expect(last).toMatchObject({ type: 'error', deviceLost: true })
    expect(ev.some((e) => e.type === 'finished' || e.type === 'cancelled')).toBe(false)
  })

  it('Fehlerfall media-lost: Fehler ohne deviceLost', async () => {
    const ev: PlotEvent[] = []
    await new SimulatorDevice('media-lost').run(job, (e) => ev.push(e), new AbortController().signal)
    const last = ev[ev.length - 1]
    expect(last.type).toBe('error')
    expect(last.type === 'error' && last.deviceLost).toBeFalsy()
  })

  it('Fehlerfall no-media: Pause bis "Weiter", danach normaler Ablauf; Abbruch in der Pause = cancelled', async () => {
    const dev = new SimulatorDevice('no-media')
    const ev: PlotEvent[] = []
    const done = dev.run(job, (e) => ev.push(e), new AbortController().signal)
    await new Promise((r) => setTimeout(r, 60))
    expect(ev.map((e) => e.type)).toEqual(['started', 'paused'])
    dev.resume()
    await done
    expect(ev.map((e) => e.type)).toContain('resumed')
    expect(ev[ev.length - 1].type).toBe('finished')

    const dev2 = new SimulatorDevice('no-media')
    const ctrl = new AbortController()
    const ev2: PlotEvent[] = []
    const done2 = dev2.run(job, (e) => ev2.push(e), ctrl.signal)
    await new Promise((r) => setTimeout(r, 30))
    ctrl.abort()
    await done2
    expect(ev2[ev2.length - 1].type).toBe('cancelled')
  })
})
