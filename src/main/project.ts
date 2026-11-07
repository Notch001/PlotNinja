import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, promises as fs } from 'fs'
import { IPC } from '@shared/ipc'
import { addRecentProject, getRecentProjects } from './settings'

const PROJECT_EXT = '.plotninja'

/** Projektdatei, mit der die App gestartet wurde (Doppelklick im Explorer) – wird vom Renderer einmal abgeholt. */
let launchFile: string | null = null
let allowClose = false
let quitting = false

const autosaveFile = (): string => join(app.getPath('userData'), 'autosave.plotninja')

/** Erste vorhandene `.plotninja`-Datei in einer Argumentliste (Start bzw. zweite Instanz). */
export function findProjectArg(argv: string[]): string | null {
  for (const a of argv.slice(1)) {
    if (a.toLowerCase().endsWith(PROJECT_EXT) && existsSync(a)) return a
  }
  return null
}

export function setLaunchFile(p: string | null): void { launchFile = p }

/** Datei soll in einem bereits laufenden Fenster geöffnet werden (zweite Instanz, macOS open-file). */
export function requestOpenInWindow(win: BrowserWindow | null, path: string): void {
  if (!win || win.isDestroyed()) { launchFile = path; return }
  if (win.isMinimized()) win.restore()
  win.focus()
  win.webContents.send(IPC.openProjectRequest, path)
}

/**
 * Fenster schließen: Der Renderer prüft ungespeicherte Änderungen (Dialog) und bestätigt per `confirmClose`.
 * Bei App-Beendigung von außen (app.quit, z. B. Update-Neustart) wird nicht blockiert; die Autosave-Datei bleibt dann
 * für die Wiederherstellung erhalten.
 */
export function attachCloseHandler(win: BrowserWindow): void {
  allowClose = false
  win.on('close', (e) => {
    if (allowClose || quitting || win.webContents.isLoading() || win.webContents.isCrashed()) return
    e.preventDefault()
    win.webContents.send(IPC.closeRequested)
  })
}

export function markQuitting(): void { quitting = true }

export function registerProjectIpc(win: () => BrowserWindow | null): void {
  const dlg = async <T extends Electron.OpenDialogReturnValue | Electron.SaveDialogReturnValue>(
    run: (w: BrowserWindow) => Promise<T>, runNoWin: () => Promise<T>
  ): Promise<T> => {
    const w = win()
    return w ? run(w) : runNoWin()
  }
  const filters = [{ name: 'PlotNinja-Projekt', extensions: ['plotninja'] }]

  ipcMain.handle(IPC.saveProjectDialog, async (_e, defaultName: string) => {
    const opts = { title: 'Projekt speichern', defaultPath: String(defaultName || 'Projekt.plotninja'), filters }
    const r = await dlg((w) => dialog.showSaveDialog(w, opts), () => dialog.showSaveDialog(opts))
    if (r.canceled || !r.filePath) return null
    return r.filePath.toLowerCase().endsWith(PROJECT_EXT) ? r.filePath : r.filePath + PROJECT_EXT
  })
  ipcMain.handle(IPC.openProjectDialog, async () => {
    const opts = { title: 'Projekt öffnen', filters, properties: ['openFile' as const] }
    const r = await dlg((w) => dialog.showOpenDialog(w, opts), () => dialog.showOpenDialog(opts))
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  ipcMain.handle(IPC.readBinary, async (_e, p: string) => new Uint8Array(await fs.readFile(p)))
  ipcMain.handle(IPC.writeText, async (_e, p: string, text: string) => {
    // Erst in eine Nebendatei schreiben, dann umbenennen: ein Absturz mitten im Speichern zerstört das alte Projekt nicht.
    const tmp = p + '.tmp'
    await fs.writeFile(tmp, text, 'utf8')
    try { await fs.rename(tmp, p) } catch (err) { await fs.writeFile(p, text, 'utf8'); await fs.unlink(tmp).catch(() => undefined); void err }
  })
  ipcMain.handle(IPC.getRecentProjects, () => getRecentProjects())
  ipcMain.handle(IPC.addRecentProject, (_e, p: string) => addRecentProject(p))
  ipcMain.handle(IPC.getLaunchFile, () => { const f = launchFile; launchFile = null; return f })
  ipcMain.handle(IPC.confirmClose, () => {
    allowClose = true
    void fs.unlink(autosaveFile()).catch(() => undefined) // sauberes Beenden: keine Wiederherstellung nötig
    win()?.close()
  })
  ipcMain.handle(IPC.writeAutosave, async (_e, text: string) => {
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    await fs.writeFile(autosaveFile(), text, 'utf8')
  })
  ipcMain.handle(IPC.readAutosave, async () => {
    try { return await fs.readFile(autosaveFile(), 'utf8') } catch { return null }
  })
  ipcMain.handle(IPC.clearAutosave, () => fs.unlink(autosaveFile()).catch(() => undefined))
}
