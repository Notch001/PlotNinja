/**
 * GP-GL (Graphtec) Befehlserzeugung für Silhouette-Plotter.
 *
 * Quelle: Befehlsfolgen nach inkscape-silhouette (silhouette/Graphtec.py, fablabnbg), nachgebaut in TypeScript.
 * HINWEIS: Die erzeugten Bytes sind NICHT an echter Hardware getestet.
 *
 * Konventionen (wie in der Referenz):
 *  - 1 mm = 20 Einheiten (0,05 mm)
 *  - Befehle enden mit 0x03 (ETX); Escape-Sequenzen (ESC 0x04, ESC 0x05) nicht.
 *  - Koordinaten werden als "M <y>,<x>" bzw. "D <y>,<x>" gesendet (Achsen vertauscht, Ursprung oben links).
 */
import type { CutJob, CutSettings, Point, Polyline } from '@shared/types'

export const VENDOR_ID_GRAPHTEC = 0x0b4d
export const EP_OUT = 0x01
export const EP_IN = 0x82

export type SilhouetteFamily = 'legacy' | 'cameo3' | 'cameo4'

export interface SilhouetteModel {
  id: string
  name: string
  vendorId: number
  productId: number
  family: SilhouetteFamily
  /** Hat zwei Werkzeughalter (Befehl J1 wird gesendet). */
  twoTools: boolean
}

export const SILHOUETTE_MODELS: SilhouetteModel[] = [
  { id: 'cameo1', name: 'Silhouette Cameo', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x1121, family: 'legacy', twoTools: false },
  { id: 'cameo2', name: 'Silhouette Cameo 2', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x112b, family: 'legacy', twoTools: false },
  { id: 'cameo3', name: 'Silhouette Cameo 3', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x112f, family: 'cameo3', twoTools: true },
  { id: 'cameo4', name: 'Silhouette Cameo 4', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x1137, family: 'cameo4', twoTools: true },
  { id: 'cameo4plus', name: 'Silhouette Cameo 4 Plus', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x1138, family: 'cameo4', twoTools: true },
  { id: 'cameo4pro', name: 'Silhouette Cameo 4 Pro', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x1139, family: 'cameo4', twoTools: true },
  { id: 'portrait1', name: 'Silhouette Portrait', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x1123, family: 'legacy', twoTools: false },
  { id: 'portrait2', name: 'Silhouette Portrait 2', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x1132, family: 'legacy', twoTools: false },
  { id: 'portrait3', name: 'Silhouette Portrait 3', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x113a, family: 'cameo4', twoTools: false },
  { id: 'curio', name: 'Silhouette Curio', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x112c, family: 'legacy', twoTools: false }
]

export function findModel(vendorId: number, productId: number): SilhouetteModel | undefined {
  return SILHOUETTE_MODELS.find((m) => m.vendorId === vendorId && m.productId === productId)
}

const ETX = 0x03
const ESC = 0x1b
const enc = new TextEncoder()

/** ESC EOT: Plotter initialisieren. */
export const GPGL_INIT = new Uint8Array([ESC, 0x04])
/** ESC ENQ: Statusabfrage; Antwort '0' bereit, '1' bewegt sich, '2' kein Medium, jeweils mit 0x03 am Ende. */
export const GPGL_STATUS_QUERY = new Uint8Array([ESC, 0x05])

export type GpglStatus = 'ready' | 'moving' | 'unloaded' | 'unknown'

export function parseGpglStatus(resp: Uint8Array | number[]): GpglStatus {
  const bytes = Array.from(resp).filter((b) => b !== ETX)
  const s = String.fromCharCode(...bytes).trim()
  if (s === '0') return 'ready'
  if (s === '1') return 'moving'
  if (s === '2') return 'unloaded'
  return 'unknown'
}

const su = (mm: number): number => Math.round(mm * 20)

function cmds(list: string[]): Uint8Array {
  return enc.encode(list.map((c) => c + '\u0003').join(''))
}

/** Standard-Klingendurchmesser, als Offset (0,9 mm = 18 Einheiten). */
const BLADE_DIAMETER_MM = 0.9

/** Setup-Befehle (nach ESC EOT) je Modellfamilie. */
export function gpglSetup(job: CutJob, model: SilhouetteModel): Uint8Array {
  const s: CutSettings = job.settings
  const force = Math.min(33, Math.max(1, Math.round(s.force)))
  const speed = Math.min(model.family === 'cameo4' ? 30 : 10, Math.max(1, Math.round(s.speed)))
  const w = su(job.workArea.width)
  const h = su(job.workArea.height)
  const blade = su(BLADE_DIAMETER_MM)
  const list: string[] = []

  if (model.family === 'cameo4') {
    if (model.twoTools) list.push('J1')
    list.push(`FX${force},1`, 'TJ0', `!${speed},1`, 'FC0,1,1', 'FE0,1', 'FF1,0,1', 'FF1,1,1')
    list.push(`FX${force},1`, 'TJ3', `FC${blade},1,1`)
    list.push('TG0', 'FN0', 'TB50,0', '\\0,0', `Z${h},${w}`)
  } else if (model.family === 'cameo3') {
    list.push('J1', `!${speed},1`, `FX${force},1`, 'FE0,1', 'FF1,0,1', 'FF1,1,1', 'FC0,1,1', `FC${blade},1,1`)
    list.push('TG0', 'FN0', 'TB50,0', '\\0,0', `Z${h},${w}`)
  } else {
    list.push(`!${speed}`, `FX${force}`, `FC${blade}`, 'FY1', 'FN0', 'TB50,0', 'FE0,0')
    list.push('\\0,0', `Z${h},${w}`, 'L0', 'FE0,0', 'FF0,0,0')
  }
  return cmds(list)
}

/** Abschluss: Kopf zurück. */
export function gpglTrailer(model: SilhouetteModel): Uint8Array {
  if (model.family === 'legacy') return cmds(['H'])
  return cmds(['L0', '\\0,0', 'M0,0', 'J0', 'FN0', 'TB50,0'])
}

/** Abbruch: Plotter initialisieren (stoppt) und Kopf zurückfahren. */
export function gpglAbort(model: SilhouetteModel): Uint8Array[] {
  return [GPGL_INIT, gpglTrailer(model)]
}

export interface GpglPathChunk {
  data: Uint8Array
  /** Erster Punkt des Pfades (mm) - Ausgangsposition für die Live-Anzeige. */
  start: Point
  /** Letzter Punkt des Pfades (mm) - für Fortschrittsanzeige. */
  end: Point
  /** Schnittlänge dieses Pfades inkl. aller Durchgänge (mm). */
  length: number
}

export interface GpglPlan {
  init: Uint8Array
  setup: Uint8Array
  paths: GpglPathChunk[]
  trailer: Uint8Array
}

function pointsOf(pl: Polyline): Point[] {
  return pl.closed && pl.points.length > 1 ? [...pl.points, pl.points[0]] : pl.points
}

function inside(p: Point, wa: { width: number; height: number }): boolean {
  const f = 0.05
  return p.x >= -f && p.y >= -f && p.x <= wa.width + f && p.y <= wa.height + f
}

export function jobToGpglPlan(job: CutJob, model: SilhouetteModel): GpglPlan {
  const passes = Math.min(5, Math.max(1, Math.round(job.settings.passes)))
  const paths: GpglPathChunk[] = []
  for (const pl of job.paths) {
    const pts = pointsOf(pl)
    if (pts.length < 2) continue
    const list: string[] = []
    let length = 0
    for (let pass = 0; pass < passes; pass++) {
      list.push(`M${su(pts[0].y)},${su(pts[0].x)}`)
      let lastInside = inside(pts[0], job.workArea)
      for (let i = 1; i < pts.length; i++) {
        const ins = inside(pts[i], job.workArea)
        // Außerhalb der Arbeitsfläche nur bewegen, nicht schneiden (wie in der Referenz)
        list.push(`${ins && lastInside ? 'D' : 'M'}${su(pts[i].y)},${su(pts[i].x)}`)
        lastInside = ins
        length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
      }
    }
    paths.push({ data: cmds(list), start: pts[0], end: pts[pts.length - 1], length })
  }
  return {
    init: GPGL_INIT,
    setup: gpglSetup(job, model),
    paths,
    trailer: gpglTrailer(model)
  }
}

/** Alle Chunks in Sendereihenfolge: Init, Setup, ein Chunk je Pfad, Abschluss. */
export function jobToGpgl(job: CutJob, model: SilhouetteModel): Uint8Array[] {
  const plan = jobToGpglPlan(job, model)
  return [plan.init, plan.setup, ...plan.paths.map((p) => p.data), plan.trailer]
}
