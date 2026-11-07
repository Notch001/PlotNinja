import type { CutJob, CutSettings, Part, Point, Polyline, WorkArea } from '@shared/types'
import { buildJob } from './job'
import { uid } from './uid'
import { t } from '@shared/i18n'

/** Position des Testschnitts auf der Matte (linke obere Ecke, mm). */
export const TEST_CUT_ORIGIN = { x: 10, y: 10 }
export const TEST_CUT_SQUARE_MM = 20
export const TEST_CUT_CIRCLE_DIAMETER_MM = 25

function circle(cx: number, cy: number, r: number, n = 72): Point[] {
  const pts: Point[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
  }
  return pts
}

/** Das Testmuster als Bauteil (lokale Koordinaten, bbox.min = 0,0): Quadrat 20x20 mit Dreieck innen, daneben ein Kreis (25 mm). */
export function testCutPart(): Part {
  const sq = TEST_CUT_SQUARE_MM
  const d = TEST_CUT_CIRCLE_DIAMETER_MM
  const gap = 10
  const paths: Polyline[] = [
    { closed: true, points: [{ x: 0, y: 0 }, { x: sq, y: 0 }, { x: sq, y: sq }, { x: 0, y: sq }] },
    { closed: true, points: [{ x: sq * 0.3, y: sq * 0.75 }, { x: sq * 0.7, y: sq * 0.75 }, { x: sq * 0.5, y: sq * 0.25 }] },
    { closed: true, points: circle(sq + gap + d / 2, d / 2, d / 2) }
  ]
  return {
    id: uid(), name: t('part.testCutName'), sourcePath: '', paths,
    width: sq + gap + d, height: d, x: TEST_CUT_ORIGIN.x, y: TEST_CUT_ORIGIN.y, rotation: 0, scale: 1
  }
}

/** Auftrag für den Testschnitt: gleiche Pipeline wie ein normaler Schnitt (Reihenfolge, Überschnitt), aktuelle Einstellungen. */
export function buildTestCutJob(workArea: WorkArea, settings: CutSettings): CutJob {
  return buildJob([testCutPart()], workArea, settings)
}
