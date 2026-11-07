import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type PlotNinjaApi } from '@shared/ipc'
import type { DeviceStatus, PlotEvent, UpdateStatus } from '@shared/types'

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: PlotNinjaApi = {
  listDevices: () => ipcRenderer.invoke(IPC.listDevices),
  connect: (id) => ipcRenderer.invoke(IPC.connect, id),
  disconnect: () => ipcRenderer.invoke(IPC.disconnect),
  onDeviceStatus: (cb) => subscribe<DeviceStatus>(IPC.deviceStatus, cb),
  startPlot: (job) => ipcRenderer.invoke(IPC.startPlot, job),
  cancelPlot: () => ipcRenderer.invoke(IPC.cancelPlot),
  resumePlot: () => ipcRenderer.invoke(IPC.resumePlot),
  ejectMedia: (mm) => ipcRenderer.invoke(IPC.ejectMedia, mm),
  onPlotEvent: (cb) => subscribe<PlotEvent>(IPC.plotEvent, cb),
  listDir: (p) => ipcRenderer.invoke(IPC.listDir, p),
  readText: (p) => ipcRenderer.invoke(IPC.readText, p),
  readBinary: (p) => ipcRenderer.invoke(IPC.readBinary, p),
  listFonts: () => ipcRenderer.invoke(IPC.listFonts),
  writeText: (p, t) => ipcRenderer.invoke(IPC.writeText, p, t),
  saveProjectDialog: (n) => ipcRenderer.invoke(IPC.saveProjectDialog, n),
  openProjectDialog: () => ipcRenderer.invoke(IPC.openProjectDialog),
  getRecentProjects: () => ipcRenderer.invoke(IPC.getRecentProjects),
  addRecentProject: (p) => ipcRenderer.invoke(IPC.addRecentProject, p),
  getLaunchFile: () => ipcRenderer.invoke(IPC.getLaunchFile),
  onOpenProjectRequest: (cb) => subscribe<string>(IPC.openProjectRequest, cb),
  onCloseRequested: (cb) => subscribe<void>(IPC.closeRequested, () => cb()),
  confirmClose: () => ipcRenderer.invoke(IPC.confirmClose),
  writeAutosave: (t) => ipcRenderer.invoke(IPC.writeAutosave, t),
  readAutosave: () => ipcRenderer.invoke(IPC.readAutosave),
  clearAutosave: () => ipcRenderer.invoke(IPC.clearAutosave),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  loadSettings: () => ipcRenderer.invoke(IPC.loadSettings),
  saveSettings: (s) => ipcRenderer.invoke(IPC.saveSettings, s),
  getAppVersion: () => ipcRenderer.invoke(IPC.getAppVersion),
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
  getUpdateStatus: () => ipcRenderer.invoke(IPC.getUpdateStatus),
  onUpdateStatus: (cb) => subscribe<UpdateStatus>(IPC.updateStatus, cb),
  restartForUpdate: () => ipcRenderer.invoke(IPC.restartForUpdate),
  getLocale: () => ipcRenderer.invoke(IPC.getLocale),
  setLanguage: (l) => ipcRenderer.invoke(IPC.setLanguage, l),
  getPathForFile: (f) => webUtils.getPathForFile(f),
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
