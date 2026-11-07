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

/** Zeitparameter für den Sendeablauf (in Tests verkürzbar). */
export interface RunTiming {
  /** Abstand der Statusabfragen (ESC 0x05). */
  pollMs: number
  /** Pause nach dem Senden, bevor zum ersten Mal gefragt wird (der Plotter meldet unmittelbar nach dem Empfang oft noch "bereit"). */
  settleMs: number
  /** So viele "bereit"-Antworten in Folge gelten als wirklich fertig. */
  confirmReady: number
  /** Maximale Wartezeit auf "bereit" nach einem Datenblock. */
  readyTimeoutMs: number
  /** Pause nach ESC EOT (Initialisierung). */
  initDelayMs: number
}
export const DEFAULT_TIMING: RunTiming = { pollMs: 150, settleMs: 150, confirmReady: 2, readyTimeoutMs: 120_000, initDelayMs: 300 }

/** Dünne Schicht über den USB-Endpunkten; in Tests durch eine Attrappe ersetzbar. */
export interface UsbTransport {
  write(data: Uint8Array, timeoutMs?: number): Promise<void>
  read(length: number, timeoutMs?: number): Promise<Uint8Array | undefined>
}

const isTimeout = (e: unknown): boolean =>
  String((e as Error | null)?.message ?? e).includes('LIBUSB_ERROR_TIMEOUT') || (e as { errno?: number } | null)?.errno === -7

class EndpointTransport implements UsbTransport {
  constructor(private epOut: any, private epIn: any) {}

  async write(data: Uint8Array, timeoutMs = 10000): Promise<void> {
    this.epOut.timeout = timeoutMs
    try {
      for (let o = 0; o < data.length; o += CHUNK_MAX) {
        await this.epOut.transferAsync(Buffer.from(data.subarray(o, o + CHUNK_MAX)))
      }
    } catch (e) {
      if (isTimeout(e)) {
        throw new Error(
          'Der Plotter nimmt keine Daten mehr an (Zeitüberschreitung beim Senden, vermutlich ist sein Puffer voll oder er hängt). ' +
          'Prüfe, ob Material eingelegt ist und der Plotter nicht blockiert ist, und starte den Schnitt erneut.'
        )
      }
      throw e
    }
  }

  async read(length: number, timeoutMs = 3000): Promise<Uint8Array | undefined> {
    this.epIn.timeout = timeoutMs
    return (await this.epIn.transferAsync(length)) as Uint8Array | undefined
  }
}

async function queryStatus(t: UsbTransport): Promise<GpglStatus> {
  await t.write(GPGL_STATUS_QUERY, 2000)
  const buf = await t.read(64, 3000)
  return buf ? parseGpglStatus(buf) : 'unknown'
}

/**
 * Wartet, bis der Plotter nach dem zuletzt gesendeten Block wirklich fertig ist (Status '0'), und fragt dazu im
 * Abstand `pollMs` per ESC 0x05 ab. Ein einzelnes "bereit" direkt nach dem Senden reicht nicht (der Plotter puffert
 * und beginnt erst später), deshalb Wartepause und mehrere bereit-Antworten in Folge. Antwortet der Plotter beim
 * Abfragen nicht (Timeout), gilt das als "noch beschäftigt".
 */
export async function waitUntilReady(t: UsbTransport, signal: AbortSignal, timing: RunTiming): Promise<void> {
  const t0 = Date.now()
  let ready = 0
  await sleep(timing.settleMs, signal)
  while (!signal.aborted) {
    let s: GpglStatus
    try {
      s = await queryStatus(t)
    } catch (e) {
      if (!isTimeout(e)) throw e
      s = 'moving'
    }
    if (s === 'unloaded') throw new Error('Im Plotter ist kein Material eingelegt. Bitte Material/Schneidematte einlegen und erneut starten.')
    ready = s === 'ready' ? ready + 1 : 0
    if (ready >= timing.confirmReady) return
    if (Date.now() - t0 > timing.readyTimeoutMs) {
      throw new Error(
        `Der Plotter wurde nach ${Math.round(timing.readyTimeoutMs / 1000)} Sekunden nicht fertig (Zeitüberschreitung). ` +
        'Ist das Material eingespannt, bewegt sich der Kopf, oder hängt der Plotter? Schalte ihn bei Bedarf aus und wieder ein.'
      )
    }
    await sleep(timing.pollMs, signal)
  }
}

/** Sendet `data` in kleinen, an Kommandogrenzen (0x03) getrennten Stücken und wartet nach jedem Stück auf "bereit". */
async function sendAndWait(t: UsbTransport, data: Uint8Array, signal: AbortSignal, timing: RunTiming): Promise<void> {
  let start = 0
  while (start < data.length && !signal.aborted) {
    let end = Math.min(start + SAFE_CHUNK, data.length)
    if (end < data.length) {
      let k = end
      while (k > start && data[k - 1] !== 0x03) k--
      if (k > start) end = k // sonst: ein einzelnes überlanges Kommando am Stück
    }
    await t.write(data.subarray(start, end))
    start = end
    await waitUntilReady(t, signal, timing)
  }
}

/**
 * Der komplette Sendeablauf. Fortschritt wird erst gemeldet, wenn der Plotter den Pfad wirklich fertig geschnitten
 * hat (alle Stücke gesendet UND Plotter wieder bereit); 'finished' erst, wenn er nach dem Abschluss bereit ist.
 */
export async function runGpglJob(
  t: UsbTransport, model: SilhouetteModel, job: CutJob,
  onEvent: (e: PlotEvent) => void, signal: AbortSignal, timing: RunTiming = DEFAULT_TIMING
): Promise<void> {
  const plan = jobToGpglPlan(job, model)
  const total = plan.paths.reduce((s, p) => s + p.length, 0)
  try {
    onEvent({ type: 'started', totalPaths: plan.paths.length, totalLength: total })
    await t.write(plan.init)
    await sleep(timing.initDelayMs, signal)
    const first = await queryStatus(t).catch((e) => { if (isTimeout(e)) return 'unknown' as const; throw e })
    if (first === 'unloaded') throw new Error('Im Plotter ist kein Material eingelegt. Bitte Material/Schneidematte einlegen und erneut starten.')
    await sendAndWait(t, plan.setup, signal, timing)

    let cut = 0
    for (let i = 0; i < plan.paths.length && !signal.aborted; i++) {
      const p = plan.paths[i]
      // Beginn des Pfades: die Live-Anzeige kann ab hier zum Ende hin schätzen
      onEvent({ type: 'progress', pathIndex: i, x: p.start.x, y: p.start.y, cutLength: cut, done: false })
      await sendAndWait(t, p.data, signal, timing)
      if (signal.aborted) break
      cut += p.length
      onEvent({ type: 'progress', pathIndex: i, x: p.end.x, y: p.end.y, cutLength: cut, done: true })
    }

    if (signal.aborted) {
      await abortHardware(t, model)
      onEvent({ type: 'cancelled' })
      return
    }
    await sendAndWait(t, plan.trailer, signal, timing)
    if (signal.aborted) {
      await abortHardware(t, model)
      onEvent({ type: 'cancelled' })
      return
    }
    onEvent({ type: 'finished' })
  } catch (e) {
    try { await abortHardware(t, model) } catch { /* ignorieren */ }
    onEvent({ type: 'error', message: e instanceof Error && !('errno' in e) ? e.message : usbErrorMessage(e) })
  }
}

async function abortHardware(t: UsbTransport, model: SilhouetteModel): Promise<void> {
  for (const c of gpglAbort(model)) {
    await t.write(c, 3000)
    await sleep(200)
  }
}


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
  private transport: UsbTransport | null = null
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
      const epOut = iface.endpoints.find((e: any) => e.address === EP_OUT)
      const epIn = iface.endpoints.find((e: any) => e.address === EP_IN)
      if (!epOut || !epIn) throw new Error('Erwartete USB-Endpunkte (0x01/0x82) nicht gefunden.')
      this.transport = new EndpointTransport(epOut, epIn)
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
    this.iface = this.transport = null
  }

  async status(): Promise<DeviceStatus> {
    if (!this.isOpen || !this.transport) return 'disconnected'
    if (this.busy) return 'busy'
    try {
      const s = await queryStatus(this.transport)
      return s === 'ready' ? 'ready' : s === 'moving' ? 'busy' : s === 'unloaded' ? 'no-media' : 'error'
    } catch {
      return 'error'
    }
  }

  async run(job: CutJob, onEvent: (e: PlotEvent) => void, signal: AbortSignal): Promise<void> {
    if (!this.isOpen || !this.transport) {
      onEvent({ type: 'error', message: 'Der Plotter ist nicht verbunden.' })
      return
    }
    this.busy = true
    try {
      await runGpglJob(this.transport, this.model, job, onEvent, signal)
    } finally {
      this.busy = false
    }
  }
}
