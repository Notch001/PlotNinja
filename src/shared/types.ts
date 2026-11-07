/** Gemeinsame Typen für core, main, preload und renderer. Alle Längen in Millimetern. */

export interface Point { x: number; y: number }

/** Ein Schnittpfad als Polylinie (Kurven sind bereits in Segmente zerlegt). */
export interface Polyline { points: Point[]; closed: boolean }

/** Ein Bauteil auf der Arbeitsfläche. `paths` liegen in lokalen mm-Koordinaten, bbox-Ursprung = (0,0). */
export interface Part {
  id: string
  name: string
  sourcePath: string        // Dateipfad (oder Dateiname bei OS-Drop)
  paths: Polyline[]         // lokal, bbox.min = (0,0)
  width: number             // mm, unskaliert
  height: number            // mm, unskaliert
  x: number                 // mm, linke obere Ecke auf der Arbeitsfläche
  y: number
  rotation: number          // Grad, im Uhrzeigersinn um die Bauteilmitte
  scale: number             // 1 = Originalgröße
}

/** Arbeitsfläche / Plotter-Medium. */
export interface WorkArea {
  name: string
  width: number             // mm
  height: number            // mm
}

export interface CutSettings {
  blade: number             // Messer-/Klingenüberstand (Silhouette: 1–10, Anzeige "Klinge")
  force: number             // Druck 1–33
  speed: number             // Geschwindigkeit 1–10
  passes: number            // Anzahl Durchgänge 1–5
  overcut: number           // mm Überschnitt bei geschlossenen Pfaden (0 = aus)
}

export type DeviceStatus = 'disconnected' | 'ready' | 'busy' | 'no-media' | 'error'

export interface DeviceInfo {
  id: string                // eindeutig, z.B. "usb:0b4d:112b" oder "simulator"
  name: string              // "Silhouette Cameo 2"
  kind: 'usb' | 'simulator'
}

/** Ein fertiger Auftrag: alle Pfade bereits transformiert, in mm auf der Arbeitsfläche (0,0 = oben links). */
export interface CutJob {
  paths: Polyline[]
  workArea: WorkArea
  settings: CutSettings
}

/** Fortschritts-/Live-Ereignisse vom Plotter an die UI. */
export type PlotEvent =
  | { type: 'started'; totalPaths: number; totalLength: number }
  | { type: 'progress'; pathIndex: number; x: number; y: number; cutLength: number; done: boolean } // aktuelle Werkzeugposition in mm
  | { type: 'finished' }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }

export interface FsEntry {
  name: string
  path: string
  isDir: boolean
}

export interface PersistedSettings {
  workAreas: WorkArea[]         // gespeicherte Arbeitsflächen-Presets
  activeWorkArea: WorkArea
  cut: CutSettings
  lastFolder?: string
  rootFolders: string[]         // Wurzelordner im Baum links
}

export const DEFAULT_WORK_AREAS: WorkArea[] = [
  { name: 'Cameo – 12" × 12" Matte', width: 305, height: 305 },
  { name: 'Cameo – 12" × 24" Matte', width: 305, height: 610 },
  { name: 'Cameo – Rolle 305 mm', width: 305, height: 1000 },
  { name: 'Portrait – 8" × 12" Matte', width: 203, height: 305 }
]

export const DEFAULT_CUT: CutSettings = { blade: 3, force: 10, speed: 5, passes: 1, overcut: 0 }
