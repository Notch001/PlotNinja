import type { CutJob, DeviceInfo, DeviceStatus, PlotEvent } from '@shared/types'
import {
  EP_IN, EP_OUT, GPGL_INIT, GPGL_STATUS_QUERY, gpglEject, ejectFeedMm, findModel, gpglAbort, jobToGpglPlan, parseGpglStatus,
  VENDOR_ID_GRAPHTEC, type GpglStatus, type SilhouetteModel
} from '@core/gpgl'
import { describeRawError, plotterLog } from './log'
import { t } from '@shared/i18n'
import { DeviceLostError, ResumeGate, sleep, type PlotterDevice } from './types'

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
        throw new Error(t('plotter.error.sendTimeout'))
      }
      throw e
    }
  }

  async read(length: number, timeoutMs = 3000): Promise<Uint8Array | undefined> {
    this.epIn.timeout = timeoutMs
    return (await this.epIn.transferAsync(length)) as Uint8Array | undefined
  }
}

/** Gerät ist weg (Kabel gezogen, ausgeschaltet, USB-Fehler): NO_DEVICE, IO, PIPE. */
export function isDeviceLost(e: unknown): boolean {
  const raw = String((e as Error | null)?.message ?? e)
  const errno = (e as { errno?: number } | null)?.errno
  return raw.includes('LIBUSB_ERROR_NO_DEVICE') || raw.includes('LIBUSB_ERROR_IO') || raw.includes('LIBUSB_ERROR_PIPE') ||
    errno === -4 || errno === -1 || errno === -9
}

/** Übersetzte Meldungen (werden beim Erzeugen des Fehlers gebildet, nicht beim Laden des Moduls). */
export const msgNoMediaStart = (): string => t('plotter.error.noMediaStart')
export const msgNoMediaMid = (): string => t('plotter.error.noMediaMid')
export const msgDeviceLost = (): string => t('plotter.error.deviceLost')

async function queryStatus(tp: UsbTransport): Promise<GpglStatus> {
  await tp.write(GPGL_STATUS_QUERY, 2000)
  const buf = await tp.read(64, 3000)
  return buf ? parseGpglStatus(buf) : 'unknown'
}

/**
 * Wartet, bis der Plotter nach dem zuletzt gesendeten Block wirklich fertig ist (Status '0'), und fragt dazu im
 * Abstand `pollMs` per ESC 0x05 ab. Ein einzelnes "bereit" direkt nach dem Senden reicht nicht (der Plotter puffert
 * und beginnt erst später), deshalb Wartepause und mehrere bereit-Antworten in Folge. Antwortet der Plotter beim
 * Abfragen nicht (Timeout), gilt das als "noch beschäftigt".
 */
export async function waitUntilReady(tp: UsbTransport, signal: AbortSignal, timing: RunTiming): Promise<void> {
  const t0 = Date.now()
  let ready = 0
  await sleep(timing.settleMs, signal)
  while (!signal.aborted) {
    let s: GpglStatus
    try {
      s = await queryStatus(tp)
    } catch (e) {
      if (!isTimeout(e)) throw e
      s = 'moving'
    }
    if (s === 'unloaded') throw new Error(msgNoMediaMid())
    ready = s === 'ready' ? ready + 1 : 0
    if (ready >= timing.confirmReady) return
    if (Date.now() - t0 > timing.readyTimeoutMs) {
      throw new Error(t('plotter.error.readyTimeout', { seconds: Math.round(timing.readyTimeoutMs / 1000) }))
    }
    await sleep(timing.pollMs, signal)
  }
}

/** Sendet `data` in kleinen, an Kommandogrenzen (0x03) getrennten Stücken und wartet nach jedem Stück auf "bereit". */
async function sendAndWait(tp: UsbTransport, data: Uint8Array, signal: AbortSignal, timing: RunTiming): Promise<void> {
  let start = 0
  while (start < data.length && !signal.aborted) {
    let end = Math.min(start + SAFE_CHUNK, data.length)
    if (end < data.length) {
      let k = end
      while (k > start && data[k - 1] !== 0x03) k--
      if (k > start) end = k // sonst: ein einzelnes überlanges Kommando am Stück
    }
    await tp.write(data.subarray(start, end))
    start = end
    await waitUntilReady(tp, signal, timing)
  }
}

/**
 * Der komplette Sendeablauf. Fortschritt wird erst gemeldet, wenn der Plotter den Pfad wirklich fertig geschnitten
 * hat (alle Stücke gesendet UND Plotter wieder bereit); 'finished' erst, wenn er nach dem Abschluss bereit ist.
 */
export async function runGpglJob(
  tp: UsbTransport, model: SilhouetteModel, job: CutJob,
  onEvent: (e: PlotEvent) => void, signal: AbortSignal, timing: RunTiming = DEFAULT_TIMING, gate?: ResumeGate
): Promise<void> {
  const plan = jobToGpglPlan(job, model)
  const total = plan.paths.reduce((s, p) => s + p.length, 0)
  try {
    onEvent({ type: 'started', totalPaths: plan.paths.length, totalLength: total })
    await tp.write(plan.init)
    await sleep(timing.initDelayMs, signal)
    let first = await queryStatus(tp).catch((e) => { if (isTimeout(e)) return 'unknown' as const; throw e })
    // Vor dem ersten Schnitt ist Warten gefahrlos: kein Medium -> pausieren, bis der Nutzer "Weiter" drückt (oder abbricht)
    while (first === 'unloaded' && !signal.aborted) {
      if (!gate) throw new Error(msgNoMediaStart())
      plotterLog('Paused: no media before start')
      onEvent({ type: 'paused', reason: 'no-media', message: msgNoMediaStart() })
      if (!(await gate.wait(signal))) break
      onEvent({ type: 'resumed' })
      first = await queryStatus(tp).catch((e) => { if (isTimeout(e)) return 'unknown' as const; throw e })
    }
    if (signal.aborted) {
      await abortHardware(tp, model)
      onEvent({ type: 'cancelled' })
      return
    }
    await sendAndWait(tp, plan.setup, signal, timing)

    let cut = 0
    for (let i = 0; i < plan.paths.length && !signal.aborted; i++) {
      const p = plan.paths[i]
      // Beginn des Pfades: die Live-Anzeige kann ab hier zum Ende hin schätzen
      onEvent({ type: 'progress', pathIndex: i, x: p.start.x, y: p.start.y, cutLength: cut, done: false })
      await sendAndWait(tp, p.data, signal, timing)
      if (signal.aborted) break
      cut += p.length
      onEvent({ type: 'progress', pathIndex: i, x: p.end.x, y: p.end.y, cutLength: cut, done: true })
    }

    if (signal.aborted) {
      await abortHardware(tp, model)
      onEvent({ type: 'cancelled' })
      return
    }
    if (plan.ejects) {
      plotterLog(`Ejecting media (feed up to ${ejectFeedMm(job).toFixed(1)} mm)`)
      onEvent({ type: 'ejecting' })
    }
    await sendAndWait(tp, plan.trailer, signal, timing)
    if (signal.aborted) {
      await abortHardware(tp, model)
      onEvent({ type: 'cancelled' })
      return
    }
    onEvent({ type: 'finished' })
  } catch (e) {
    const lost = isDeviceLost(e)
    plotterLog(`Job failed${lost ? ' (device lost)' : ''}: ${describeRawError(e)}`)
    if (!lost) { try { await abortHardware(tp, model) } catch { /* ignorieren */ } }
    onEvent({
      type: 'error',
      message: lost ? msgDeviceLost() : e instanceof Error && !('errno' in e) ? e.message : usbErrorMessage(e),
      ...(lost ? { deviceLost: true } : {})
    })
  }
}

/** Ausfahren ohne Auftrag: Init, Medium prüfen, Vorschub `feedMm`, auf "bereit" warten. Wirft mit übersetzter Meldung. */
export async function runGpglEject(
  tp: UsbTransport, feedMm: number, signal: AbortSignal, timing: RunTiming = DEFAULT_TIMING
): Promise<void> {
  try {
    plotterLog(`Eject without job: feed ${feedMm.toFixed(1)} mm`)
    await tp.write(GPGL_INIT)
    await sleep(timing.initDelayMs, signal)
    const st = await queryStatus(tp).catch((e) => { if (isTimeout(e)) return 'unknown' as const; throw e })
    if (st === 'unloaded') throw new Error(t('plotter.error.noMediaEject'))
    if (signal.aborted) return
    await sendAndWait(tp, gpglEject(feedMm), signal, timing)
    plotterLog('Eject finished')
  } catch (e) {
    const lost = isDeviceLost(e)
    plotterLog(`Eject failed${lost ? ' (device lost)' : ''}: ${describeRawError(e)}`)
    if (lost) throw new DeviceLostError(msgDeviceLost())
    throw new Error(e instanceof Error && !('errno' in e) ? e.message : usbErrorMessage(e))
  }
}

async function abortHardware(tp: UsbTransport, model: SilhouetteModel): Promise<void> {
  for (const c of gpglAbort(model)) {
    await tp.write(c, 3000)
    await sleep(200)
  }
}


export function usbErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const errno = (e as { errno?: number } | null)?.errno
  const is = (name: string, no: number): boolean => raw.includes(name) || errno === no
  if (is('LIBUSB_ERROR_NOT_SUPPORTED', -12) || is('LIBUSB_ERROR_ACCESS', -3) || is('LIBUSB_ERROR_NOT_FOUND', -5)) {
    return t('plotter.error.openFailed', { raw })
  }
  if (is('LIBUSB_ERROR_BUSY', -6)) {
    return t('plotter.error.inUse')
  }
  if (is('LIBUSB_ERROR_NO_DEVICE', -4) || is('LIBUSB_ERROR_IO', -1) || is('LIBUSB_ERROR_PIPE', -9)) {
    return t('plotter.error.interrupted', { raw })
  }
  if (is('LIBUSB_ERROR_TIMEOUT', -7)) {
    return t('plotter.error.timeout')
  }
  return t('plotter.error.usb', { raw })
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
        info: { id: `usb:${hex(d.idVendor)}:${hex(d.idProduct)}`, name: model.name, kind: 'usb', model: model.id, autoBlade: model.autoBlade },
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
  private gate = new ResumeGate()

  constructor(private model: SilhouetteModel, private raw: any, info: DeviceInfo) {
    this.info = info
  }

  async open(): Promise<void> {
    try {
      this.raw.open()
      const iface = this.raw.interfaces?.[0]
      if (!iface) throw new Error(t('plotter.error.noInterface'))
      iface.claim()
      this.iface = iface
      const epOut = iface.endpoints.find((e: any) => e.address === EP_OUT)
      const epIn = iface.endpoints.find((e: any) => e.address === EP_IN)
      if (!epOut || !epIn) throw new Error(t('plotter.error.noEndpoints'))
      this.transport = new EndpointTransport(epOut, epIn)
      this.isOpen = true
    } catch (e) {
      plotterLog('Open failed: ' + describeRawError(e))
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
    } catch (e) {
      if (isDeviceLost(e)) {
        plotterLog('Status query: device lost: ' + describeRawError(e))
        this.isOpen = false
        return 'disconnected'
      }
      plotterLog('Status query failed: ' + describeRawError(e))
      return 'error'
    }
  }

  resume(): void { this.gate.resume() }

  async eject(feedMm: number, signal: AbortSignal): Promise<void> {
    if (!this.isOpen || !this.transport) throw new Error(t('plotter.error.notConnected'))
    this.busy = true
    try {
      await runGpglEject(this.transport, feedMm, signal)
    } finally {
      this.busy = false
    }
  }

  async run(job: CutJob, onEvent: (e: PlotEvent) => void, signal: AbortSignal): Promise<void> {
    if (!this.isOpen || !this.transport) {
      onEvent({ type: 'error', message: t('plotter.error.notConnected') })
      return
    }
    this.busy = true
    try {
      await runGpglJob(this.transport, this.model, job, onEvent, signal, DEFAULT_TIMING, this.gate)
    } finally {
      this.busy = false
    }
  }
}
