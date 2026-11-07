import { app, dialog, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

/** Sucht beim Start (und danach alle 4 Stunden) auf GitHub nach einer neuen Version. */
export function setupAutoUpdate(): void {
  if (!app.isPackaged) return // nur in der installierten App

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true // Update wird spätestens beim Beenden installiert

  autoUpdater.on('update-downloaded', (info) => {
    const win = BrowserWindow.getAllWindows()[0]
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
  autoUpdater.on('error', (e) => console.warn('Update-Prüfung fehlgeschlagen:', e?.message))

  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => undefined)
  }
  check()
  setInterval(check, 4 * 60 * 60 * 1000)
}
