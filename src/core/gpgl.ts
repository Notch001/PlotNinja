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
  /**
   * Hat die AutoBlade (motorisch einstellbare Klingentiefe). Nur dann wird `settings.blade` als Tiefe (TF) gesendet;
   * sonst muss die Klinge am Messer von Hand eingestellt werden. Nach der Modellliste in inkscape-silhouette
   * (PRODUCT_LINE_CAMEO3_ON: Cameo 3, Cameo 4-Familie, Portrait 3).
   */
  autoBlade: boolean
}

export const SILHOUETTE_MODELS: SilhouetteModel[] = [
  { id: 'cameo1', name: 'Silhouette Cameo', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x1121, family: 'legacy', twoTools: false, autoBlade: false },
  { id: 'cameo2', name: 'Silhouette Cameo 2', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x112b, family: 'legacy', twoTools: false, autoBlade: false },
  { id: 'cameo3', name: 'Silhouette Cameo 3', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x112f, family: 'cameo3', twoTools: true, autoBlade: true },
  { id: 'cameo4', name: 'Silhouette Cameo 4', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x1137, family: 'cameo4', twoTools: true, autoBlade: true },
  { id: 'cameo4plus', name: 'Silhouette Cameo 4 Plus', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x1138, family: 'cameo4', twoTools: true, autoBlade: true },
  { id: 'cameo4pro', name: 'Silhouette Cameo 4 Pro', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x1139, family: 'cameo4', twoTools: true, autoBlade: true },
  { id: 'portrait1', name: 'Silhouette Portrait', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x1123, family: 'legacy', twoTools: false, autoBlade: false },
  { id: 'portrait2', name: 'Silhouette Portrait 2', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x1132, family: 'legacy', twoTools: false, autoBlade: false },
  { id: 'portrait3', name: 'Silhouette Portrait 3', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x113a, family: 'cameo4', twoTools: false, autoBlade: true },
  { id: 'curio', name: 'Silhouette Curio', vendorId: VENDOR_ID_GRAPHTEC, productId: 0x112c, family: 'legacy', twoTools: false, autoBlade: false }
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

/** Klingentiefe fuer die AutoBlade: UI-Stufe 1-10 -> Geraetewert 0-10 (Wertebereich laut Referenz, 1:1 uebernommen). */
export function autoBladeDepth(blade: number): number {
  const n = Math.round(Number.isFinite(blade) ? blade : 0)
  return Math.min(10, Math.max(0, n))
}

/** Tool-Depth-Befehl `TF<tiefe>,<werkzeughalter>` fuer AutoBlade-Modelle, sonst nichts. */
export function gpglBladeDepthCommands(model: SilhouetteModel, settings: CutSettings): string[] {
  return model.autoBlade ? [`TF${autoBladeDepth(settings.blade)},1`] : []
}

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
    list.push(...gpglBladeDepthCommands(model, s)) // wie in der Referenz direkt nach dem Messer-Offset
    list.push('TG0', 'FN0', 'TB50,0', '\\0,0', `Z${h},${w}`)
  } else if (model.family === 'cameo3') {
    list.push('J1', `!${speed},1`, `FX${force},1`, 'FE0,1', 'FF1,0,1', 'FF1,1,1', 'FC0,1,1', `FC${blade},1,1`)
    list.push(...gpglBladeDepthCommands(model, s))
    list.push('TG0', 'FN0', 'TB50,0', '\\0,0', `Z${h},${w}`)
  } else {
    list.push(`!${speed}`, `FX${force}`, `FC${blade}`, 'FY1', 'FN0', 'TB50,0', 'FE0,0')
    list.push('\\0,0', `Z${h},${w}`, 'L0', 'FE0,0', 'FF0,0,0')
  }
  return cmds(list)
}

/*
 * AUSFAHREN NACH DEM SCHNEIDEN (Material hinten herausfahren)
 *
 * Herkunft (silhouette/Graphtec.py, inkscape-silhouette, fablabnbg):
 *  - BELEGT: `M<y>,<x>` (Move) mit y = Vorschubrichtung in 0,05-mm-Einheiten, danach `SO0`. So fährt die Referenz bei
 *    `endposition='below'` (Standard) das Material "unter den Schnitt" (Doku dort: "also good for using the cross-cutter"):
 *    `move_mm_cmd(bbox.lly + end_paper_offset, 0)` und `SO0`. Gleiche Folge `M<feed>,0` / `SO0` / `FN0` in `move_origin()`.
 *  - BELEGT (Bedeutung): `FN0` ist laut Referenz eine Art Reset/Normalausrichtung; `SO0` wird dort am Jobende gesendet,
 *    damit der Plotter den neuen Ursprung hier setzt (Bedeutung "Set Origin" ist aus der Verwendung abgeleitet, nicht dokumentiert).
 *  - NICHT BELEGT / bewusst NICHT umgesetzt: ein Befehl, der das Quermesser (Cross-Cutter) auslöst. Weder die Referenz
 *    noch die durchsuchten Quellen enthalten einen solchen GP-GL-Befehl; das Quermesser des Cameo 4 wird nach allem, was
 *    zu finden war, von Hand über die Schiene gezogen (die Referenz kommentiert nur, dass `below` dafür gedacht ist).
 *    Darum: PlotNinja fährt nur aus, getrennt wird von Hand.
 *  - VERMUTET: dass der Vorschub über die mit `Z` gesetzte Arbeitsflächenhöhe hinaus ausgeführt wird (die Referenz
 *    macht dasselbe mit `end_paper_offset` > 0, ohne es zu kommentieren), und dass die Folge bei allen Modellfamilien gleich wirkt
 *    (in der Referenz ist `below` nicht modellabhängig).
 *  - Die Reihenfolge `ESC EOT` -> Status -> Befehle beim Ausfahren ohne Auftrag ist wie beim normalen Auftragsstart.
 * Ungetestet an echter Hardware.
 */

/* Der Zusatzvorschub hinter der letzten Schnittkante ist die Einstellung `ejectExtraMm` (Standard 20 mm, 0-300 mm; siehe @shared/types). */

/** Vorschub in mm für das Ausfahren nach einem Auftrag: tiefster Punkt des Auftrags (y_max) + Zusatz, mindestens 0. */
export function ejectFeedMm(job: CutJob): number {
  let yMax = 0
  for (const pl of job.paths) for (const p of pl.points) if (p.y > yMax) yMax = p.y
  return yMax + Math.max(0, job.ejectExtraMm ?? 0)
}

/** Befehlsfolge zum Ausfahren um `feedMm` (ab Ursprung des Auftrags bzw. ab aktueller Position). Modellunabhängig wie in der Referenz. */
export function gpglEject(feedMm: number): Uint8Array {
  return cmds([`M${su(Math.max(0, feedMm))},0`, 'SO0', 'FN0'])
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
  /** true = `trailer` fährt das Material aus (statt den Kopf zurückzuholen). */
  ejects: boolean
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
    // Beim Ausfahren entfällt das Zurückholen (M0,0 würde das Material wieder einziehen)
    trailer: job.ejectExtraMm !== undefined ? gpglEject(ejectFeedMm(job)) : gpglTrailer(model),
    ejects: job.ejectExtraMm !== undefined
  }
}

/** Alle Chunks in Sendereihenfolge: Init, Setup, ein Chunk je Pfad, Abschluss. */
export function jobToGpgl(job: CutJob, model: SilhouetteModel): Uint8Array[] {
  const plan = jobToGpglPlan(job, model)
  return [plan.init, plan.setup, ...plan.paths.map((p) => p.data), plan.trailer]
}
