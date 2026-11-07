import type { DeviceInfo } from '@shared/types'
import { t } from '@shared/i18n'
import { SimulatorDevice } from './simulator'
import { UsbDevice, findUsbDevices, loadUsb } from './usbDevice'
import type { PlotterDevice } from './types'

export type { PlotterDevice } from './types'

/** Der Anzeigename wird bei jedem Aufruf in der aktuellen Sprache gebildet. */
export const simulatorInfo = (): DeviceInfo => ({ id: 'simulator', name: t('plotter.simulator.name'), kind: 'simulator' })

export function listDevices(): DeviceInfo[] {
  loadUsb()
  return [...findUsbDevices().map((d) => d.info), simulatorInfo()]
}

export function createDevice(id: string): PlotterDevice {
  if (id === 'simulator') return new SimulatorDevice()
  const found = findUsbDevices().find((d) => d.info.id === id)
  if (!found) throw new Error(t('plotter.error.notFound'))
  return new UsbDevice(found.model, found.raw, found.info)
}
