import { describe, expect, it } from 'vitest'
import { DEFAULT_CUT } from '@shared/types'
import { buildTestCutJob, TEST_CUT_ORIGIN } from './testcut'
import { pointsBox } from './geom'

const wa = { name: 'x', width: 305, height: 305 }

describe('Testschnitt', () => {
  it('Quadrat, Dreieck und Kreis an der Mattenecke (10/10)', () => {
    const job = buildTestCutJob(wa, DEFAULT_CUT)
    expect(job.paths).toHaveLength(3)
    expect(job.paths.every((p) => p.closed)).toBe(true)
    const all = job.paths.flatMap((p) => p.points)
    const b = pointsBox(all)!
    expect(b.x).toBeCloseTo(TEST_CUT_ORIGIN.x, 6)
    expect(b.y).toBeCloseTo(TEST_CUT_ORIGIN.y, 6)
    expect(b.height).toBeCloseTo(25, 1)
    const sq = job.paths.find((p) => p.points.length === 4)!
    const sb = pointsBox(sq.points)!
    expect(sb.width).toBeCloseTo(20, 6)
    expect(sb.height).toBeCloseTo(20, 6)
    const circle = job.paths.find((p) => p.points.length > 20)!
    const cb = pointsBox(circle.points)!
    expect(cb.width).toBeGreaterThan(24.9)
    expect(cb.width).toBeLessThanOrEqual(25)
  })

  it('Dreieck (innen) wird vor dem Quadrat geschnitten; alles liegt auf der Arbeitsfläche', () => {
    const job = buildTestCutJob(wa, DEFAULT_CUT)
    const tri = job.paths.findIndex((p) => p.points.length === 3)
    const sq = job.paths.findIndex((p) => p.points.length === 4)
    expect(tri).toBeLessThan(sq)
    for (const p of job.paths) for (const pt of p.points) {
      expect(pt.x).toBeGreaterThanOrEqual(0)
      expect(pt.y).toBeLessThanOrEqual(wa.height)
    }
  })

  it('übernimmt die aktuellen Schnitteinstellungen', () => {
    const cut = { ...DEFAULT_CUT, force: 22, passes: 2 }
    expect(buildTestCutJob(wa, cut).settings).toEqual(cut)
  })
})
