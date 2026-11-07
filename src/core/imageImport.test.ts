import { describe, expect, it } from 'vitest'
import type { Part } from '@shared/types'
import { buildStickerContour, imageToParts } from './imageImport'
import { buildJob } from './job'
import { disc, makeImage } from './traceTestUtil'
import { partPaths } from './layout'
import { pathsBox, polygonArea } from './geom'
import { DEFAULT_CUT } from '@shared/types'

const sq = (x: number, y: number, s: number) => ({ points: [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }], closed: true, filled: true })
const mk = (paths: ReturnType<typeof sq>[]): Part => {
  const box = pathsBox(paths)!
  return {
    id: 'p', name: 'Test', sourcePath: '', width: box.width, height: box.height, x: 0, y: 0, rotation: 0, scale: 1,
    paths: paths.map((p) => ({ ...p, points: p.points.map((q) => ({ x: q.x - box.x, y: q.y - box.y })) }))
  }
}

describe('Aufkleberkontur mit Lückenschluss', () => {
  const two = mk([sq(0, 0, 10), sq(11, 0, 10)]) // 1 mm Lücke

  it('ohne Lückenschluss: zwei getrennte Konturen', () => {
    const c = buildStickerContour([two], { offsetMm: 0.2, gapMm: 0, smoothMm: 0 })
    expect(c.paths).toHaveLength(2)
  })

  it('mit Lückenschluss: eine zusammenhängende Außenkontur', () => {
    const c = buildStickerContour([two], { offsetMm: 0.2, gapMm: 1.5, smoothMm: 0 })
    expect(c.paths).toHaveLength(1)
    const box = pathsBox(c.paths)!
    expect(box.width).toBeGreaterThan(21.3)
    expect(box.width).toBeLessThan(21.8)
    expect(c.role).toBe('border')
  })

  it('Löcher werden geschlossen (nur Außenkontur)', () => {
    const ring = mk([sq(0, 0, 30), { ...sq(10, 10, 10), points: sq(10, 10, 10).points.slice().reverse() }])
    const c = buildStickerContour([ring], { offsetMm: 2, gapMm: 0, smoothMm: 0 })
    expect(c.paths).toHaveLength(1)
  })

  it('Abstand: Kontur liegt offset mm außerhalb', () => {
    const c = buildStickerContour([mk([sq(0, 0, 20)])], { offsetMm: 2, gapMm: 0, smoothMm: 0 })
    expect(c.width).toBeCloseTo(24, 1)
    expect(c.height).toBeCloseTo(24, 1)
  })

  it('Glättung rundet einspringende Ecken ab (Fläche wächst)', () => {
    const l = mk([{ points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 20 }, { x: 0, y: 20 }], closed: true, filled: true }])
    const sharp = buildStickerContour([l], { offsetMm: 0.5, gapMm: 0, smoothMm: 0 })
    const soft = buildStickerContour([l], { offsetMm: 0.5, gapMm: 0, smoothMm: 3 })
    expect(polygonArea(partPaths(soft)[0].points)).toBeGreaterThan(polygonArea(partPaths(sharp)[0].points))
  })
})

describe('imageToParts (Bild -> Part + Rand)', () => {
  const circle = makeImage(100, 100, disc(50, 50, 30))

  it('nur Bild: ein gefülltes even-odd-Teil mit Dateinamen', () => {
    const r = imageToParts(circle, 'logo.png', 'C:\\logo.png', { trace: { widthMm: 50 } })
    expect(r.parts).toHaveLength(1)
    const p = r.parts[0]
    expect(p.name).toBe('logo')
    expect(p.paths[0].filled && p.paths[0].evenOdd && p.paths[0].closed).toBe(true)
    expect(p.width).toBeGreaterThan(29)
    expect(p.width).toBeLessThan(30.6)
    expect(p.x).toBe(0)
  })

  it('mit Kontur: Bild-Teil + Rand in einer Gruppe, Rand zuletzt im Job', () => {
    const r = imageToParts(circle, 'logo.png', '', { trace: { widthMm: 100 }, sticker: { offsetMm: 2, gapMm: 0, smoothMm: 0 } })
    expect(r.parts).toHaveLength(2)
    const [img, border] = r.parts
    expect(border.role).toBe('border')
    expect(img.groupId).toBeTruthy()
    expect(border.groupId).toBe(img.groupId)
    expect(border.width).toBeGreaterThan(img.width + 3.9)
    expect(Math.min(...r.parts.map((p) => p.x))).toBeCloseTo(0)
    const job = buildJob(r.parts, { name: 't', width: 300, height: 300 }, DEFAULT_CUT, { optimize: true })
    const last = job.paths[job.paths.length - 1]
    expect(last.filled).toBe(false)
    expect(Math.abs(pathsBox([last])!.width - border.width)).toBeLessThan(0.01)
  })

  it('nur Kontur: ein normales ungefülltes Teil ohne Gruppe/Rolle', () => {
    const r = imageToParts(circle, 'logo.png', '', { trace: { widthMm: 100 }, sticker: { offsetMm: 2, gapMm: 0, smoothMm: 0 }, onlyContour: true })
    expect(r.parts).toHaveLength(1)
    expect(r.parts[0].role).toBeUndefined()
    expect(r.parts[0].groupId).toBeUndefined()
    expect(r.parts[0].paths.every((p) => p.filled === false)).toBe(true)
    expect(r.parts[0].name).toBe('logo – Kontur')
  })

  it('Transparenz-Bild: Kontur ist die Alpha-Silhouette, Lücken werden überbrückt', () => {
    const img = makeImage(120, 60, (x, y) => (disc(30, 30, 25)(x, y) || disc(88, 30, 25)(x, y) ? [10, 10, 10, 255] : [0, 0, 0, 0]))
    const sep = imageToParts(img, 'a.png', '', { trace: { mode: 'alpha', widthMm: 120 }, sticker: { offsetMm: 1, gapMm: 0, smoothMm: 0 }, onlyContour: true })
    expect(sep.parts[0].paths).toHaveLength(2) // 8 mm Abstand der Kreise bleibt
    const joined = imageToParts(img, 'a.png', '', { trace: { mode: 'alpha', widthMm: 120 }, sticker: { offsetMm: 1, gapMm: 10, smoothMm: 0 }, onlyContour: true })
    expect(joined.parts[0].paths).toHaveLength(1)
  })

  it('leeres Bild: keine Teile, Hinweis über traced.empty', () => {
    const r = imageToParts(makeImage(40, 40, () => false), 'leer.png', '', { trace: {}, sticker: { offsetMm: 2, gapMm: 0, smoothMm: 0 } })
    expect(r.parts).toHaveLength(0)
    expect(r.traced.empty).toBe(true)
  })
})
