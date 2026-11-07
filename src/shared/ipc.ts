import type { Language } from './i18n'
import type { CutJob, DeviceInfo, DeviceStatus, FontFile, FsEntry, PersistedSettings, PlotEvent, UpdateStatus } from './types'

/** Kanalnamen (main <-> renderer). */
export const IPC = {
  listDevices: 'device:list',
  connect: 'device:connect',
  disconnect: 'device:disconnect',
  deviceStatus: 'device:status',      // main -> renderer Event (DeviceStatus)
  startPlot: 'plot:start',
  cancelPlot: 'plot:cancel',
  resumePlot: 'plot:resume',
  ejectMedia: 'plot:eject',
  readBinary: 'fs:readBinary',
  listFonts: 'fs:listFonts',
  writeText: 'fs:writeText',
  saveProjectDialog: 'project:saveDialog',
  openProjectDialog: 'project:openDialog',
  getRecentProjects: 'project:recent',
  addRecentProject: 'project:addRecent',
  getLaunchFile: 'project:launchFile',   // Projektdatei, mit der die App gestartet wurde (einmalig)
  openProjectRequest: 'project:openRequest', // main -> renderer Event (Pfad): Datei wurde z. B. per Doppelklick geöffnet
  closeRequested: 'app:closeRequested',  // main -> renderer Event: Fenster soll geschlossen werden
  confirmClose: 'app:confirmClose',
  writeAutosave: 'autosave:write',
  readAutosave: 'autosave:read',
  clearAutosave: 'autosave:clear',
  plotEvent: 'plot:event',            // main -> renderer Event (PlotEvent)
  listDir: 'fs:listDir',
  readText: 'fs:readText',
  pickFolder: 'fs:pickFolder',
  loadSettings: 'settings:load',
  saveSettings: 'settings:save',
  getAppVersion: 'app:version',
  checkForUpdates: 'update:check',
  getUpdateStatus: 'update:status',
  updateStatus: 'update:statusEvent', // main -> renderer Event (UpdateStatus)
  restartForUpdate: 'update:restart',
  getLocale: 'app:locale',
  setLanguage: 'app:setLanguage'
} as const

/** API, das das Preload-Skript als `window.api` bereitstellt. */
export interface PlotNinjaApi {
  listDevices(): Promise<DeviceInfo[]>                    // USB-Plotter + immer ein "simulator"
  connect(deviceId: string): Promise<{ ok: boolean; error?: string }>
  disconnect(): Promise<void>
  onDeviceStatus(cb: (s: DeviceStatus) => void): () => void
  startPlot(job: CutJob): Promise<void>                   // Fortschritt kommt über onPlotEvent
  cancelPlot(): Promise<void>
  resumePlot(): Promise<void>                             // setzt einen pausierten Auftrag fort ("Weiter")
  /** Fährt Material ohne Auftrag um `feedMm` vor (Ausfahren). Wirft bei Fehlern mit verständlicher Meldung. */
  ejectMedia(feedMm: number): Promise<void>
  onPlotEvent(cb: (e: PlotEvent) => void): () => void
  listDir(path: string): Promise<FsEntry[]>               // nur Ordner + unterstützte Dateien (.svg .dxf .pdf .plotninja), Ordner zuerst
  readText(path: string): Promise<string>
  readBinary(path: string): Promise<Uint8Array>           // z. B. PDF
  /** Installierte Schriften (.ttf/.otf) aus dem Windows-Fonts-Ordner und dem Benutzer-Fonts-Ordner. */
  listFonts(): Promise<FontFile[]>
  writeText(path: string, text: string): Promise<void>
  /** Speichern-unter-Dialog (Filter .plotninja); null = abgebrochen. */
  saveProjectDialog(defaultName: string): Promise<string | null>
  /** Öffnen-Dialog (Filter .plotninja); null = abgebrochen. */
  openProjectDialog(): Promise<string | null>
  getRecentProjects(): Promise<string[]>                  // nur noch vorhandene Dateien, max. 10
  addRecentProject(path: string): Promise<void>
  getLaunchFile(): Promise<string | null>
  onOpenProjectRequest(cb: (path: string) => void): () => void
  onCloseRequested(cb: () => void): () => void
  /** Renderer hat die Abfrage „Ungespeicherte Änderungen“ erledigt: Fenster jetzt wirklich schließen. */
  confirmClose(): Promise<void>
  writeAutosave(text: string): Promise<void>
  readAutosave(): Promise<string | null>
  clearAutosave(): Promise<void>
  pickFolder(): Promise<string | null>
  loadSettings(): Promise<PersistedSettings>
  saveSettings(s: PersistedSettings): Promise<void>
  getAppVersion(): Promise<string>
  checkForUpdates(): Promise<void>                        // Ergebnis kommt über onUpdateStatus
  getUpdateStatus(): Promise<UpdateStatus>
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void
  restartForUpdate(): Promise<void>                       // quitAndInstall, nur wenn ein Update heruntergeladen ist
  /** Systemsprache laut Betriebssystem (app.getLocale(), z. B. "de" oder "en-US"); Grundlage für Sprache „Auto“. */
  getLocale(): Promise<string>
  /** Meldet die aufgelöste Oberflächensprache an den Hauptprozess (Dialoge, Updater, Fehlermeldungen folgen ihr). */
  setLanguage(lang: Language): Promise<void>
  /** Pfad einer vom OS gedroppten Datei (webUtils.getPathForFile). */
  getPathForFile(file: File): string
  platform: string
}

declare global {
  interface Window { api: PlotNinjaApi }
}
