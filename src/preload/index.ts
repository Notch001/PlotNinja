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
  onPlotEvent: (cb) => subscribe<PlotEvent>(IPC.plotEvent, cb),
  listDir: (p) => ipcRenderer.invoke(IPC.listDir, p),
  readText: (p) => ipcRenderer.invoke(IPC.readText, p),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  loadSettings: () => ipcRenderer.invoke(IPC.loadSettings),
  saveSettings: (s) => ipcRenderer.invoke(IPC.saveSettings, s),
  getAppVersion: () => ipcRenderer.invoke(IPC.getAppVersion),
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
  getUpdateStatus: () => ipcRenderer.invoke(IPC.getUpdateStatus),
  onUpdateStatus: (cb) => subscribe<UpdateStatus>(IPC.updateStatus, cb),
  restartForUpdate: () => ipcRenderer.invoke(IPC.restartForUpdate),
  getPathForFile: (f) => webUtils.getPathForFile(f),
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
