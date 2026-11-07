import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { appendFileSync, promises as fs } from 'fs'
import { IPC } from '@shared/ipc'
import { MAX_EJECT_MM } from '@shared/types'
import type { CutJob, DeviceStatus, FsEntry, PersistedSettings, PlotEvent } from '@shared/types'
import { createDevice, listDevices, type PlotterDevice } from './plotter'
import { describeRawError, plotterLog, setPlotterLogger } from './plotter/log'
import { registerProjectIpc } from './project'
import { loadSettings, saveSettings } from './settings'
import { fontDirs, listFontFiles } from './fonts'

let device: PlotterDevice | null = null
let abort: AbortController | null = null
let lastStatus: DeviceStatus = 'disconnected'
let pollTimer: NodeJS.Timeout | null = null

function send(win: () => BrowserWindow | null, channel: string, payload: unknown): void {
  const w = win()
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
}

export async function listDirEntries(dir: string): Promise<FsEntry[]> {
  try {
    const items = await fs.readdir(dir, { withFileTypes: true })
    const out: FsEntry[] = []
    for (const it of items) {
      if (it.name.startsWith('.')) continue
      const full = join(dir, it.name)
      let isDir = it.isDirectory()
      if (it.isSymbolicLink()) {
        try { isDir = (await fs.stat(full)).isDirectory() } catch { continue }
      }
      if (isDir || (it.isFile() || it.isSymbolicLink()) && /\.(svg|dxf|pdf|plotninja)$/i.test(it.name)) {
        out.push({ name: it.name, path: full, isDir })
      }
    }
    out.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name, 'de', { sensitivity: 'base', numeric: true })))
    return out
  } catch {
    return []
  }
}

export function registerIpc(win: () => BrowserWindow | null): void {
  // Geräteprotokoll: plotter.log im Datenordner (wie update.log)
  setPlotterLogger((line) => appendFileSync(join(app.getPath('userData'), 'plotter.log'), line + '\n'))

  const pushStatus = (s: DeviceStatus): void => {
    if (s === lastStatus) return
    lastStatus = s
    send(win, IPC.deviceStatus, s)
  }

  const stopPolling = (): void => {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
  }
  /** Gerät ist mitten im Betrieb verschwunden: Auftrag beenden, Verbindung sauber schließen, Status 'disconnected'. */
  const dropLostDevice = async (why: string): Promise<void> => {
    plotterLog('Gerät verloren: ' + why)
    stopPolling()
    abort?.abort()
    const d = device
    device = null
    if (d) { try { await d.close() } catch { /* ignorieren */ } }
    pushStatus('disconnected')
  }
  const startPolling = (): void => {
    stopPolling()
    pollTimer = setInterval(async () => {
      if (!device || abort) return // während des Plottens meldet der Lauf den Status
      try {
        const st = await device.status()
        if (st === 'disconnected' && device.info.kind === 'usb') await dropLostDevice('Statusabfrage im Leerlauf')
        else pushStatus(st)
      } catch (e) {
        plotterLog('Statusabfrage: ' + describeRawError(e))
        pushStatus('error')
      }
    }, 2500)
  }

  ipcMain.handle(IPC.listDevices, () => listDevices())

  ipcMain.handle(IPC.connect, async (_e, id: string) => {
    try {
      if (device) { await device.close(); device = null }
      const d = createDevice(id)
      await d.open()
      device = d
      pushStatus(await d.status())
      startPolling()
      plotterLog('Verbunden: ' + d.info.name)
      return { ok: true }
    } catch (e) {
      plotterLog('Verbinden fehlgeschlagen: ' + describeRawError(e))
      device = null
      pushStatus('disconnected')
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(IPC.disconnect, async () => {
    stopPolling()
    abort?.abort()
    if (device) { try { await device.close() } catch { /* ignorieren */ } }
    device = null
    pushStatus('disconnected')
  })

  ipcMain.handle(IPC.startPlot, async (_e, job: CutJob) => {
    const emit = (ev: PlotEvent): void => {
      if (ev.type === 'error') plotterLog(`Fehler im Auftrag: ${ev.message}`)
      else if (ev.type === 'paused') plotterLog(`Pausiert: ${ev.message}`)
      else if (ev.type === 'started' || ev.type === 'finished' || ev.type === 'cancelled') plotterLog(`Auftrag ${ev.type}`)
      send(win, IPC.plotEvent, ev)
      if (ev.type === 'error' && ev.deviceLost) void dropLostDevice('mitten im Auftrag')
    }
    if (!device) {
      emit({ type: 'error', message: 'Kein Plotter verbunden. Bitte zuerst ein Gerät auswählen und verbinden.' })
      return
    }
    if (abort) {
      emit({ type: 'error', message: 'Es läuft bereits ein Auftrag.' })
      return
    }
    // Vorabprüfung: Gerät antwortet? (Kein Medium meldet der Lauf selbst als Pause mit "Weiter".)
    try {
      const st = await device.status()
      if (st === 'disconnected' && device.info.kind === 'usb') {
        emit({ type: 'error', deviceLost: true, message: 'Der Plotter ist nicht mehr verbunden. Prüfe USB-Kabel und Stromversorgung und verbinde ihn erneut.' })
        return
      }
      if (st === 'error') {
        emit({ type: 'error', message: 'Der Plotter antwortet nicht oder meldet einen Fehler. Prüfe, ob er eingeschaltet und bereit ist (USB-Kabel, Strom), und versuche es erneut.' })
        pushStatus('error')
        return
      }
    } catch (e) {
      plotterLog('Vorabprüfung fehlgeschlagen: ' + describeRawError(e))
    }
    const ctrl = new AbortController()
    abort = ctrl
    pushStatus('busy')
    // Nicht auf das Ende warten: Fortschritt kommt über Events.
    void device
      .run(job, emit, ctrl.signal)
      .catch((e) => emit({ type: 'error', message: e instanceof Error ? e.message : String(e) }))
      .finally(async () => {
        abort = null
        try { pushStatus(device ? await device.status() : 'disconnected') } catch { pushStatus('error') }
      })
  })

  ipcMain.handle(IPC.ejectMedia, async (_e, feedMm: number) => {
    if (!device) throw new Error('Kein Plotter verbunden.')
    if (abort) throw new Error('Der Plotter ist gerade beschäftigt.')
    const mm = Math.min(MAX_EJECT_MM, Math.max(0, Number(feedMm) || 0))
    const ctrl = new AbortController()
    abort = ctrl
    pushStatus('busy')
    try {
      await device.eject(mm, ctrl.signal)
    } catch (e) {
      plotterLog('Ausfahren: ' + describeRawError(e))
      if (e instanceof Error && e.message.startsWith('Die Verbindung zum Plotter ist abgebrochen')) void dropLostDevice('beim Ausfahren')
      throw e
    } finally {
      abort = null
      try { pushStatus(device ? await device.status() : 'disconnected') } catch { pushStatus('error') }
    }
  })
  ipcMain.handle(IPC.cancelPlot, () => { abort?.abort() })
  ipcMain.handle(IPC.resumePlot, () => { device?.resume?.() })

  ipcMain.handle(IPC.listDir, (_e, dir: string) => listDirEntries(dir))
  ipcMain.handle(IPC.readText, (_e, p: string) => fs.readFile(p, 'utf8'))
  ipcMain.handle(IPC.listFonts, () => listFontFiles(fontDirs()))
  ipcMain.handle(IPC.pickFolder, async () => {
    const w = win()
    const opts = { properties: ['openDirectory' as const] }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  registerProjectIpc(win)
  ipcMain.handle(IPC.loadSettings, () => loadSettings())
  ipcMain.handle(IPC.saveSettings, (_e, s: PersistedSettings) => saveSettings(s))
}

export async function shutdownPlotter(): Promise<void> {
  if (pollTimer) clearInterval(pollTimer)
  abort?.abort()
  if (device) { try { await device.close() } catch { /* ignorieren */ } }
  device = null
}
