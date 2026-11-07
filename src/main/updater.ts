import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { appendFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '@shared/ipc'
import type { UpdateStatus } from '@shared/types'
import { t } from '@shared/i18n'
import { describeUpdateError } from './updateError'

let status: UpdateStatus = { state: 'idle' }

function log(line: string): void {
  try {
    appendFileSync(join(app.getPath('userData'), 'update.log'), `${new Date().toISOString()} ${line}\n`)
  } catch { /* Log ist nur Zusatz */ }
}

/** Sucht beim Start (und danach alle 4 Stunden) auf GitHub nach einer neuen Version und meldet den Stand an die Oberfläche. */
export function setupAutoUpdate(getWindow: () => BrowserWindow | null): void {
  const set = (s: UpdateStatus): void => {
    status = s
    log(`${s.state}${s.version ? ' v' + s.version : ''}${s.percent !== undefined ? ' ' + Math.round(s.percent) + '%' : ''}${s.message ? ' – ' + s.message : ''}`)
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(IPC.updateStatus, s)
  }

  ipcMain.handle(IPC.getAppVersion, () => app.getVersion())
  if (!app.isPackaged) {
    // Die Meldung wird bei jeder Abfrage in der aktuellen Sprache gebildet
    const dev = (): UpdateStatus => ({ state: 'dev', message: t('update.devOnly') })
    status = dev()
    ipcMain.handle(IPC.getUpdateStatus, () => dev())
    ipcMain.handle(IPC.checkForUpdates, () => { set(dev()) })
    ipcMain.handle(IPC.restartForUpdate, () => undefined)
    return
  }

  ipcMain.handle(IPC.getUpdateStatus, () => status)
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true // Update wird spätestens beim Beenden installiert
  log(`Start, Version ${app.getVersion()}`)

  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => set({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => set({ state: 'none', version: app.getVersion() }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', version: status.version, percent: p.percent }))
  autoUpdater.on('error', (e) => set({ state: 'error', message: describeUpdateError(e) }))
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'downloaded', version: info.version })
    const win = getWindow()
    const opts = {
      type: 'info' as const,
      buttons: [t('update.ready.restart'), t('update.ready.later')],
      defaultId: 0,
      cancelId: 1,
      title: t('update.ready.title'),
      message: t('update.ready.message', { version: info.version }),
      detail: t('update.ready.detail')
    }
    const p = win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)
    p.then((r) => {
      if (r.response === 0) autoUpdater.quitAndInstall()
    })
  })

  const check = (): void => {
    if (status.state === 'checking' || status.state === 'downloading' || status.state === 'downloaded') return
    autoUpdater.checkForUpdates().catch((e) => {
      if (status.state !== 'error') set({ state: 'error', message: describeUpdateError(e) })
    })
  }
  ipcMain.handle(IPC.checkForUpdates, () => { check() })
  ipcMain.handle(IPC.restartForUpdate, () => {
    if (status.state === 'downloaded') autoUpdater.quitAndInstall()
  })

  setTimeout(check, 3000) // Fenster soll erst geladen sein
  setInterval(check, 4 * 60 * 60 * 1000)
}
