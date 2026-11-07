import type { CutJob, DeviceInfo, DeviceStatus, FsEntry, PersistedSettings, PlotEvent } from './types'

/** Kanalnamen (main <-> renderer). */
export const IPC = {
  listDevices: 'device:list',
  connect: 'device:connect',
  disconnect: 'device:disconnect',
  deviceStatus: 'device:status',      // main -> renderer Event (DeviceStatus)
  startPlot: 'plot:start',
  cancelPlot: 'plot:cancel',
  plotEvent: 'plot:event',            // main -> renderer Event (PlotEvent)
  listDir: 'fs:listDir',
  readText: 'fs:readText',
  pickFolder: 'fs:pickFolder',
  loadSettings: 'settings:load',
  saveSettings: 'settings:save'
} as const

/** API, das das Preload-Skript als `window.api` bereitstellt. */
export interface PlotNinjaApi {
  listDevices(): Promise<DeviceInfo[]>                    // USB-Plotter + immer ein "simulator"
  connect(deviceId: string): Promise<{ ok: boolean; error?: string }>
  disconnect(): Promise<void>
  onDeviceStatus(cb: (s: DeviceStatus) => void): () => void
  startPlot(job: CutJob): Promise<void>                   // Fortschritt kommt über onPlotEvent
  cancelPlot(): Promise<void>
  onPlotEvent(cb: (e: PlotEvent) => void): () => void
  listDir(path: string): Promise<FsEntry[]>               // nur Ordner + unterstützte Dateien (.svg), Ordner zuerst
  readText(path: string): Promise<string>
  pickFolder(): Promise<string | null>
  loadSettings(): Promise<PersistedSettings>
  saveSettings(s: PersistedSettings): Promise<void>
  /** Pfad einer vom OS gedroppten Datei (webUtils.getPathForFile). */
  getPathForFile(file: File): string
  platform: string
}

declare global {
  interface Window { api: PlotNinjaApi }
}
