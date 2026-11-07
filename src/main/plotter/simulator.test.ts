import { describe, expect, it } from 'vitest'
import type { CutJob, PlotEvent } from '@shared/types'
import { SimulatorDevice } from './simulator'

const job: CutJob = {
  workArea: { name: 'x', width: 300, height: 300 },
  settings: { blade: 3, force: 10, speed: 10, passes: 1, overcut: 0 },
  paths: [
    { closed: true, points: [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }] },
    { closed: false, points: [{ x: 100, y: 100 }, { x: 150, y: 100 }] }
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

  it('bricht ab', async () => {
    const ev: PlotEvent[] = []
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 120)
    await new SimulatorDevice().run(job, (e) => ev.push(e), ctrl.signal)
    expect(ev[ev.length - 1].type).toBe('cancelled')
  })
})
