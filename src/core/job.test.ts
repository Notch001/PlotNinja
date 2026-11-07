import { describe, expect, it } from 'vitest'
import type { CutSettings, Part, WorkArea } from '@shared/types'
import { buildJob } from './index'

const wa: WorkArea = { name: 't', width: 200, height: 200 }
const settings: CutSettings = { blade: 3, force: 10, speed: 5, passes: 1, overcut: 0 }

function rectPath(x: number, y: number, w: number, h: number) {
  return { closed: true, points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] }
}
function part(x: number, y: number, w: number, h: number, paths = [rectPath(0, 0, w, h)]): Part {
  return { id: 'i' + x + y, name: 'p', sourcePath: '', paths, width: w, height: h, x, y, rotation: 0, scale: 1 }
}

describe('buildJob', () => {
  it('transformiert Pfade in Arbeitsflächen-Koordinaten', () => {
    const job = buildJob([part(10, 20, 30, 40)], wa, settings)
    expect(job.paths).toHaveLength(1)
    const xs = job.paths[0].points.map((p) => p.x)
    const ys = job.paths[0].points.map((p) => p.y)
    expect(Math.min(...xs)).toBe(10)
    expect(Math.max(...ys)).toBe(60)
    expect(job.workArea).toBe(wa)
    expect(job.settings).toBe(settings)
  })

  it('schneidet Innenkonturen vor Außenkonturen', () => {
    const p = part(0, 0, 100, 100, [rectPath(0, 0, 100, 100), rectPath(40, 40, 20, 20)])
    const job = buildJob([p], wa, settings)
    expect(job.paths).toHaveLength(2)
    const first = job.paths[0].points
    expect(Math.max(...first.map((q) => q.x))).toBe(60) // inneres Rechteck zuerst
  })

  it('ordnet Teile per Nearest-Neighbor', () => {
    const far = part(150, 150, 10, 10)
    const near = part(5, 5, 10, 10)
    const mid = part(80, 80, 10, 10)
    const job = buildJob([far, near, mid], wa, settings)
    const minX = job.paths.map((p) => Math.min(...p.points.map((q) => q.x)))
    expect(minX).toEqual([5, 80, 150])
  })

  it('hängt Overcut bei geschlossenen Pfaden an', () => {
    const job = buildJob([part(0, 0, 10, 10)], wa, { ...settings, overcut: 5 })
    const pl = job.paths[0]
    expect(pl.closed).toBe(false)
    expect(pl.points).toHaveLength(4 + 1 + 1) // 4 Ecken, Rückkehr zum Start, 5 mm auf der ersten Kante
    expect(pl.points[4]).toEqual({ x: 0, y: 0 })
    expect(pl.points[5].x).toBeCloseTo(5)
    expect(pl.points[5].y).toBeCloseTo(0)
  })

  it('ohne Overcut bleiben geschlossene Pfade geschlossen', () => {
    expect(buildJob([part(0, 0, 10, 10)], wa, settings).paths[0].closed).toBe(true)
  })
})
