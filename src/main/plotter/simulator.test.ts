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
})
