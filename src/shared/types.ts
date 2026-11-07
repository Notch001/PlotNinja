/** Gemeinsame Typen für core, main, preload und renderer. Alle Längen in Millimetern. */

export interface Point { x: number; y: number }

/** Ein Schnittpfad als Polylinie (Kurven sind bereits in Segmente zerlegt). */
export interface Polyline {
  points: Point[]
  closed: boolean
  /** false = ungefüllt (fill="none", reine Strichgrafik): wird beim Weld nie vereinigt. Fehlt das Feld = gefüllt. */
  filled?: boolean
  /** SVG fill-rule des Quell-Elements ist evenodd (sonst nonzero). */
  evenOdd?: boolean
  /** Nummer des Quell-Elements im SVG: Konturen mit gleicher Nummer teilen sich Füllregel und Fläche. */
  src?: number
}

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
  /**
   * Optional: getrennte Skalierung in Breite/Höhe (freies Skalieren bei entsperrtem Seitenverhältnis). Wirkt im
   * lokalen Teilkoordinatensystem VOR der Drehung (keine Scherung). Fehlt ein Wert, gilt `scale`.
   */
  scaleX?: number
  scaleY?: number
  /** Gleiche groupId = gehört zu einer Gruppe (starre Einheit beim Bewegen, Skalieren, Drehen, Anordnen). Fehlt = einzeln. */
  groupId?: string
  /**
   * Besondere Rolle des Teils. 'border' = Schnittrand (Entgitterrand): statisches, ungefülltes Teil in der Gruppe seiner
   * Quelle; wird zuletzt geschnitten. Fehlt = normales Bauteil. Ein Rand gehört immer zu einer Gruppe (sonst entfällt die Rolle).
   */
  role?: 'border'
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

/** Benutzerdefiniertes Materialprofil (Name + Schnitteinstellungen). */
export interface MaterialProfile {
  /** Nur eingebaute Profile: stabile Kennung (z. B. 'vinyl'); `name` ist dort der deutsche Schlüsselname, angezeigt wird `materialLabel()`. */
  id?: string
  name: string
  cut: CutSettings
}

/** Eine installierte Schriftdatei (.ttf/.otf) für das Text-Werkzeug. */
export interface FontFile {
  name: string              // Anzeigename (aus dem Dateinamen)
  path: string
}

export type DeviceStatus = 'disconnected' | 'ready' | 'busy' | 'no-media' | 'error'

export interface DeviceInfo {
  id: string                // eindeutig, z.B. "usb:0b4d:112b" oder "simulator"
  name: string              // "Silhouette Cameo 2"
  kind: 'usb' | 'simulator'
  /** Modell-ID aus der Modellliste (z.B. "cameo3"); beim Simulator nicht gesetzt. */
  model?: string
  /** Gerät hat AutoBlade und stellt die Klingentiefe selbst ein (undefined = unbekannt/Simulator). */
  autoBlade?: boolean
}

/** Ein fertiger Auftrag: alle Pfade bereits transformiert, in mm auf der Arbeitsfläche (0,0 = oben links). */
export interface CutJob {
  paths: Polyline[]
  workArea: WorkArea
  settings: CutSettings
  /**
   * Gesetzt = nach dem letzten Schnitt das Material hinten ausfahren: Vorschub bis y_max des Auftrags + dieser Wert (mm).
   * Fehlt = normaler Abschluss (Kopf/Material zurück zum Start).
   */
  ejectExtraMm?: number
}

/** Optionen nach dem Schneiden (persistiert). Das Abschneiden mit dem Quermesser geschieht von Hand (kein GP-GL-Befehl bekannt). */
export interface AfterCutSettings {
  /** Material nach dem Schneiden hinten ausfahren. */
  eject: boolean
  /** Zusätzlicher Vorschub hinter der Schnittkante (mm); beim Button „Material ausfahren“ der gesamte Vorschub. */
  ejectExtraMm: number
}

/** Fortschritts-/Live-Ereignisse vom Plotter an die UI. */
export type PlotEvent =
  | { type: 'started'; totalPaths: number; totalLength: number }
  | { type: 'progress'; pathIndex: number; x: number; y: number; cutLength: number; done: boolean } // aktuelle Werkzeugposition in mm
  | { type: 'finished' }
  | { type: 'cancelled' }
  /** Auftrag wartet vor dem ersten Schnitt (z.B. kein Medium); der Nutzer kann mit "Weiter" fortsetzen oder abbrechen. */
  | { type: 'paused'; reason: 'no-media'; message: string }
  | { type: 'resumed' }
  /** Letzter Schritt nach dem Schnitt: Material wird ausgefahren (nur bei `CutJob.ejectExtraMm`). */
  | { type: 'ejecting' }
  /** `deviceLost`: Gerät mitten im Auftrag verschwunden (Kabel gezogen o.ä.); die Verbindung ist danach getrennt. */
  | { type: 'error'; message: string; deviceLost?: boolean }

export interface FsEntry {
  name: string
  path: string
  isDir: boolean
}

/** Art des Schnittrands: Rechteck um die Auswahl oder Kontur-Offset der Außenform. */
export type BorderMode = 'rect' | 'offset'

/** Voreinstellungen für den Schnittrand (persistiert). */
export interface BorderSettings {
  mode: BorderMode
  /** Abstand zur Außenform in mm. */
  offsetMm: number
  /** Nur bei mode 'rect': Ecken abrunden. */
  rounded: boolean
  /** Eckenradius in mm (wirkt nur, wenn `rounded`). */
  cornerRadiusMm: number
}

/** Drehen beim Nesting: aus, nur 90°-Schritte oder frei (alle 15°). */
export type NestRotate = 'off' | '90' | 'free'

/** Voreinstellungen für „Mehrfach platzieren“ und „Kompakt anordnen“ (persistiert). */
export interface NestSettings {
  /** 'count' = feste Anzahl Kopien, 'fill' = so viele wie passen. */
  mode: 'count' | 'fill'
  count: number
  gapMm: number
  marginMm: number
  rotate: NestRotate
  /** Kleinere Teile dürfen in Löcher größerer Teile (Standard aus). */
  holes: boolean
  /** Das Original wird mit neu eingeordnet (sonst bleibt es und ist ein Hindernis). */
  includeOriginal: boolean
}

export const DEFAULT_NEST: NestSettings = { mode: 'count', count: 10, gapMm: 3, marginMm: 5, rotate: '90', holes: false, includeOriginal: true }
export const NEST_MAX_COUNT = 999
export const NEST_MAX_MM = 50

export interface PersistedSettings {
  workAreas: WorkArea[]         // gespeicherte Arbeitsflächen-Presets
  activeWorkArea: WorkArea
  cut: CutSettings
  lastFolder?: string
  rootFolders: string[]         // Wurzelordner im Baum links
  weldOnImport?: boolean        // Überlappende Konturen beim Import vereinen (Standard: an)
  afterCut?: AfterCutSettings   // Ausfahren nach dem Schneiden (additiv; fehlt = aus)
  materialProfiles?: MaterialProfile[]  // Eigene Materialprofile (additiv; fehlt = keine)
  borderDefaults?: BorderSettings  // Schnittrand-Voreinstellungen (additiv; fehlt = Standard)
  nestDefaults?: NestSettings   // Mehrfach platzieren / Nesting (additiv; fehlt = Standard)
  recentProjects?: string[]     // Zuletzt geöffnete Projektdateien (neueste zuerst, max. 10); wird nur vom Hauptprozess geschrieben
  language?: 'auto' | 'de' | 'en'  // Oberflächensprache (additiv; fehlt = 'auto' = Betriebssystemsprache)
}

export const DEFAULT_WORK_AREAS: WorkArea[] = [
  { name: 'Cameo – 12" × 12" Matte', width: 305, height: 305 },
  { name: 'Cameo – 12" × 24" Matte', width: 305, height: 610 },
  { name: 'Cameo – Rolle 305 mm', width: 305, height: 1000 },
  { name: 'Portrait – 8" × 12" Matte', width: 203, height: 305 }
]

export const DEFAULT_AFTER_CUT: AfterCutSettings = { eject: false, ejectExtraMm: 20 }
export const MAX_EJECT_MM = 300

export const DEFAULT_BORDER: BorderSettings = { mode: 'rect', offsetMm: 3, rounded: false, cornerRadiusMm: 3 }
export const BORDER_MIN_MM = 0.5
export const BORDER_MAX_MM = 50

export const DEFAULT_CUT: CutSettings = { blade: 3, force: 10, speed: 5, passes: 1, overcut: 0 }

/** Zustand der automatischen Update-Prüfung. 'dev' = nicht installierte Entwicklungs-App. */
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'none' | 'error' | 'dev'
  version?: string
  percent?: number
  message?: string
}
