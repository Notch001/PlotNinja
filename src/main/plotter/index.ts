import type { DeviceInfo } from '@shared/types'
import { SimulatorDevice } from './simulator'
import { UsbDevice, findUsbDevices, loadUsb } from './usbDevice'
import type { PlotterDevice } from './types'

export type { PlotterDevice } from './types'

export const SIMULATOR_INFO: DeviceInfo = {
  id: 'simulator',
  name: 'Simulator (ohne Plotter testen)',
  kind: 'simulator'
}

export function listDevices(): DeviceInfo[] {
  loadUsb()
  return [...findUsbDevices().map((d) => d.info), SIMULATOR_INFO]
}

export function createDevice(id: string): PlotterDevice {
  if (id === 'simulator') return new SimulatorDevice()
  const found = findUsbDevices().find((d) => d.info.id === id)
  if (!found) throw new Error('Der Plotter wurde nicht gefunden. Ist er angeschlossen und eingeschaltet?')
  return new UsbDevice(found.model, found.raw, found.info)
}
