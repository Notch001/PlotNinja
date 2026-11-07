import type { CutJob, DeviceInfo, DeviceStatus, PlotEvent } from '@shared/types'
import {
  EP_IN, EP_OUT, GPGL_STATUS_QUERY, findModel, gpglAbort, jobToGpglPlan, parseGpglStatus,
  VENDOR_ID_GRAPHTEC, type GpglStatus, type SilhouetteModel
} from '@core/gpgl'
import { sleep, type PlotterDevice } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */
type UsbModule = any

let usbModule: UsbModule | null | undefined
let usbLoadError = ''

/** `usb` wird lazy geladen, damit die App auch ohne funktionierendes Native-Modul startet. */
export function loadUsb(): UsbModule | null {
  if (usbModule !== undefined) return usbModule
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    usbModule = require('usb')
  } catch (e) {
    usbModule = null
    usbLoadError = e instanceof Error ? e.message : String(e)
  }
  return usbModule
}

export function usbUnavailableReason(): string {
  return usbLoadError
}

const CHUNK_MAX = 4096
const SAFE_CHUNK = 1024 // Silhouette Studio sendet max. ca. 1-3 kB am Stück; wie in der Referenz warten wir dazwischen

export function usbErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const errno = (e as { errno?: number } | null)?.errno
  const is = (name: string, no: number): boolean => raw.includes(name) || errno === no
  if (is('LIBUSB_ERROR_NOT_SUPPORTED', -12) || is('LIBUSB_ERROR_ACCESS', -3) || is('LIBUSB_ERROR_NOT_FOUND', -5)) {
    return (
      'Der Plotter konnte nicht geöffnet werden (' + raw + '). Vermutlich ist kein WinUSB-Treiber installiert: ' +
      'Installiere mit dem Programm Zadig (https://zadig.akeo.ie) den Treiber „WinUSB“ für „Silhouette Cameo“. ' +
      'Schließe außerdem Silhouette Studio, falls es läuft.'
    )
  }
  if (is('LIBUSB_ERROR_BUSY', -6)) {
    return 'Der Plotter wird gerade von einem anderen Programm benutzt (z. B. Silhouette Studio). Bitte schließe dieses Programm.'
  }
  if (is('LIBUSB_ERROR_NO_DEVICE', -4) || is('LIBUSB_ERROR_IO', -1) || is('LIBUSB_ERROR_PIPE', -9)) {
    return 'Die Verbindung zum Plotter wurde unterbrochen. Prüfe USB-Kabel und Stromversorgung und verbinde erneut. (' + raw + ')'
  }
  if (is('LIBUSB_ERROR_TIMEOUT', -7)) {
    return 'Der Plotter antwortet nicht (Zeitüberschreitung). Ist er eingeschaltet und bereit?'
  }
  return 'USB-Fehler: ' + raw
}

/** Findet angeschlossene Silhouette-Plotter. */
export function findUsbDevices(): { info: DeviceInfo; model: SilhouetteModel; raw: any }[] {
  const usb = loadUsb()
  if (!usb) return []
  const res: { info: DeviceInfo; model: SilhouetteModel; raw: any }[] = []
  try {
    for (const raw of usb.getDeviceList()) {
      const d = raw.deviceDescriptor
      if (d.idVendor !== VENDOR_ID_GRAPHTEC) continue
      const model = findModel(d.idVendor, d.idProduct)
      if (!model) continue
      const hex = (n: number): string => n.toString(16).padStart(4, '0')
      res.push({
        info: { id: `usb:${hex(d.idVendor)}:${hex(d.idProduct)}`, name: model.name, kind: 'usb' },
        model,
        raw
      })
    }
  } catch {
    /* Geräteliste nicht lesbar -> keine USB-Geräte */
  }
  return res
}

export class UsbDevice implements PlotterDevice {
  readonly info: DeviceInfo
  private iface: any = null
  private epOut: any = null
  private epIn: any = null
  private isOpen = false
  private busy = false

  constructor(private model: SilhouetteModel, private raw: any, info: DeviceInfo) {
    this.info = info
  }

  async open(): Promise<void> {
    try {
      this.raw.open()
      const iface = this.raw.interfaces?.[0]
      if (!iface) throw new Error('Keine USB-Schnittstelle gefunden.')
      iface.claim()
      this.iface = iface
      this.epOut = iface.endpoints.find((e: any) => e.address === EP_OUT)
      this.epIn = iface.endpoints.find((e: any) => e.address === EP_IN)
      if (!this.epOut || !this.epIn) throw new Error('Erwartete USB-Endpunkte (0x01/0x82) nicht gefunden.')
      this.isOpen = true
    } catch (e) {
      await this.close()
      if (e instanceof Error && !e.message.startsWith('LIBUSB') && !('errno' in e)) throw e
      throw new Error(usbErrorMessage(e))
    }
  }

  async close(): Promise<void> {
    this.isOpen = false
    try {
      if (this.iface) await new Promise<void>((res) => this.iface.release(true, () => res()))
    } catch { /* ignorieren */ }
    try { this.raw.close() } catch { /* ignorieren */ }
    this.iface = this.epOut = this.epIn = null
  }

  private async write(data: Uint8Array, timeout = 10000): Promise<void> {
    this.epOut.timeout = timeout
    for (let o = 0; o < data.length; o += CHUNK_MAX) {
      await this.epOut.transferAsync(Buffer.from(data.subarray(o, o + CHUNK_MAX)))
    }
  }

  /** Schreibt in kleinen, an Kommandogrenzen (0x03) getrennten Stücken und wartet dazwischen auf "bereit". */
  private async writeSafe(data: Uint8Array, signal: AbortSignal): Promise<void> {
    let start = 0
    while (start < data.length) {
      let end = Math.min(start + SAFE_CHUNK, data.length)
      if (end < data.length) {
        let k = end
        while (k > start && data[k - 1] !== 0x03) k--
        if (k > start) end = k // sonst: ein einzelnes überlanges Kommando am Stück
      }
      await this.write(data.subarray(start, end))
      start = end
      await this.waitReady(signal)
      if (signal.aborted) return
    }
  }

  private async queryStatus(): Promise<GpglStatus> {
    await this.write(GPGL_STATUS_QUERY, 2000)
    this.epIn.timeout = 3000
    const buf: Buffer | undefined = await this.epIn.transferAsync(64)
    return buf ? parseGpglStatus(buf) : 'unknown'
  }

  private async waitReady(signal: AbortSignal, timeoutMs = 180000): Promise<void> {
    const t0 = Date.now()
    while (!signal.aborted) {
      const s = await this.queryStatus()
      if (s === 'ready') return
      if (s === 'unloaded') throw new Error('Im Plotter ist kein Material eingelegt. Bitte Material/Schneidematte einlegen und erneut starten.')
      if (Date.now() - t0 > timeoutMs) throw new Error('Der Plotter wurde nicht rechtzeitig fertig (Zeitüberschreitung).')
      await sleep(60, signal)
    }
  }

  async status(): Promise<DeviceStatus> {
    if (!this.isOpen) return 'disconnected'
    if (this.busy) return 'busy'
    try {
      const s = await this.queryStatus()
      return s === 'ready' ? 'ready' : s === 'moving' ? 'busy' : s === 'unloaded' ? 'no-media' : 'error'
    } catch {
      return 'error'
    }
  }

  async run(job: CutJob, onEvent: (e: PlotEvent) => void, signal: AbortSignal): Promise<void> {
    if (!this.isOpen) {
      onEvent({ type: 'error', message: 'Der Plotter ist nicht verbunden.' })
      return
    }
    const plan = jobToGpglPlan(job, this.model)
    const total = plan.paths.reduce((s, p) => s + p.length, 0)
    this.busy = true
    try {
      onEvent({ type: 'started', totalPaths: plan.paths.length, totalLength: total })
      await this.write(plan.init)
      await sleep(300, signal)
      const first = await this.queryStatus()
      if (first === 'unloaded') throw new Error('Im Plotter ist kein Material eingelegt. Bitte Material/Schneidematte einlegen und erneut starten.')
      await this.writeSafe(plan.setup, signal)

      let cut = 0
      for (let i = 0; i < plan.paths.length && !signal.aborted; i++) {
        const p = plan.paths[i]
        await this.writeSafe(p.data, signal)
        if (signal.aborted) break
        cut += p.length
        onEvent({ type: 'progress', pathIndex: i, x: p.end.x, y: p.end.y, cutLength: cut, done: true })
      }

      if (signal.aborted) {
        await this.abortHardware()
        onEvent({ type: 'cancelled' })
        return
      }
      await this.writeSafe(plan.trailer, signal)
      onEvent({ type: 'finished' })
    } catch (e) {
      try { await this.abortHardware() } catch { /* ignorieren */ }
      onEvent({ type: 'error', message: e instanceof Error && !('errno' in e) ? e.message : usbErrorMessage(e) })
    } finally {
      this.busy = false
    }
  }

  private async abortHardware(): Promise<void> {
    for (const c of gpglAbort(this.model)) {
      await this.write(c, 3000)
      await sleep(200)
    }
  }
}
