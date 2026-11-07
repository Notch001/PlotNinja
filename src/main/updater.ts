import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { appendFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '@shared/ipc'
import type { UpdateStatus } from '@shared/types'

let status: UpdateStatus = { state: 'idle' }

function log(line: string): void {
  try {
    appendFileSync(join(app.getPath('userData'), 'update.log'), `${new Date().toISOString()} ${line}\n`)
  } catch { /* Log ist nur Zusatz */ }
}

/** Übersetzt einen Roh-Fehler in eine verständliche deutsche Meldung (Roh-Text wird kurz angehängt). */
export function describeUpdateError(e: unknown): string {
  const raw = String((e as { message?: string } | null)?.message ?? e ?? '').split('\n')[0].trim()
  const short = raw.length > 140 ? raw.slice(0, 140) + '…' : raw
  let nice = 'Update-Prüfung fehlgeschlagen'
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|ERR_NAME_NOT_RESOLVED|net::/i.test(raw)) nice = 'Keine Verbindung zu GitHub'
  else if (/404|latest\.yml|Cannot find/i.test(raw)) nice = 'Keine Update-Informationen auf GitHub gefunden'
  else if (/403|rate limit/i.test(raw)) nice = 'GitHub lehnt die Anfrage ab (Limit erreicht)'
  else if (/sha512|checksum/i.test(raw)) nice = 'Heruntergeladenes Update ist beschädigt'
  return short ? `${nice} (${short})` : nice
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
  ipcMain.handle(IPC.getUpdateStatus, () => status)

  if (!app.isPackaged) {
    status = { state: 'dev', message: 'Updates nur in der installierten App' }
    ipcMain.handle(IPC.checkForUpdates, () => { set(status) })
    ipcMain.handle(IPC.restartForUpdate, () => undefined)
    return
  }

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
      buttons: ['Jetzt neu starten', 'Später'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update bereit',
      message: `PlotNinja ${info.version} wurde heruntergeladen.`,
      detail: 'Jetzt neu starten und aktualisieren? Sonst wird beim nächsten Beenden aktualisiert.'
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
