import { BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { IPC } from '@shared/ipc'
import type { CutJob, DeviceStatus, FsEntry, PersistedSettings, PlotEvent } from '@shared/types'
import { createDevice, listDevices, type PlotterDevice } from './plotter'
import { loadSettings, saveSettings } from './settings'

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
      if (isDir || (it.isFile() || it.isSymbolicLink()) && it.name.toLowerCase().endsWith('.svg')) {
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
  const pushStatus = (s: DeviceStatus): void => {
    if (s === lastStatus) return
    lastStatus = s
    send(win, IPC.deviceStatus, s)
  }

  const stopPolling = (): void => {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
  }
  const startPolling = (): void => {
    stopPolling()
    pollTimer = setInterval(async () => {
      if (!device || abort) return // während des Plottens meldet der Lauf den Status
      try { pushStatus(await device.status()) } catch { pushStatus('error') }
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
      return { ok: true }
    } catch (e) {
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
    const emit = (ev: PlotEvent): void => send(win, IPC.plotEvent, ev)
    if (!device) {
      emit({ type: 'error', message: 'Kein Plotter verbunden. Bitte zuerst ein Gerät auswählen und verbinden.' })
      return
    }
    if (abort) {
      emit({ type: 'error', message: 'Es läuft bereits ein Auftrag.' })
      return
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

  ipcMain.handle(IPC.cancelPlot, () => { abort?.abort() })

  ipcMain.handle(IPC.listDir, (_e, dir: string) => listDirEntries(dir))
  ipcMain.handle(IPC.readText, (_e, p: string) => fs.readFile(p, 'utf8'))
  ipcMain.handle(IPC.pickFolder, async () => {
    const w = win()
    const opts = { properties: ['openDirectory' as const] }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  ipcMain.handle(IPC.loadSettings, () => loadSettings())
  ipcMain.handle(IPC.saveSettings, (_e, s: PersistedSettings) => saveSettings(s))
}

export async function shutdownPlotter(): Promise<void> {
  if (pollTimer) clearInterval(pollTimer)
  abort?.abort()
  if (device) { try { await device.close() } catch { /* ignorieren */ } }
  device = null
}
