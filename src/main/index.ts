import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { initMainLanguage, registerIpc, shutdownPlotter } from './ipc'
import { attachCloseHandler, findProjectArg, markQuitting, requestOpenInWindow, setLaunchFile } from './project'
import { setupAutoUpdate } from './updater'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#14161a',
    autoHideMenuBar: true,
    title: 'PlotNinja',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const wc = mainWindow.webContents
  // Gedroppte Dateien dürfen das Fenster nicht wegnavigieren; die Oberfläche verarbeitet den Drop selbst.
  wc.on('will-navigate', (e, url) => {
    if (!(process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL']))) e.preventDefault()
  })
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  attachCloseHandler(mainWindow)
  mainWindow.on('closed', () => { mainWindow = null })
}

// Nur eine Instanz: Ein Doppelklick auf eine .plotninja-Datei öffnet sie im laufenden Fenster.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  setLaunchFile(findProjectArg(process.argv))
  app.on('second-instance', (_e, argv) => {
    const f = findProjectArg(argv)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    if (f) requestOpenInWindow(mainWindow, f)
  })
}
// macOS: Datei per Finder/Dock geöffnet (kann vor ready eintreffen)
app.on('open-file', (e, path) => {
  e.preventDefault()
  requestOpenInWindow(mainWindow, path)
})

app.whenReady().then(async () => {
  if (!gotLock) return
  await initMainLanguage()
  registerIpc(() => mainWindow)
  createWindow()
  setupAutoUpdate(() => mainWindow)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => { markQuitting(); void shutdownPlotter() })
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
