import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerIpc, shutdownPlotter } from './ipc'
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
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  registerIpc(() => mainWindow)
  createWindow()
  setupAutoUpdate(() => mainWindow)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => { void shutdownPlotter() })
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
