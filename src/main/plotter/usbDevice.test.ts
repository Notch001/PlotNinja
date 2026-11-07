import { describe, expect, it } from 'vitest'
import type { CutJob, PlotEvent } from '@shared/types'
import { SILHOUETTE_MODELS } from '@core/gpgl'
import { msgDeviceLost, isDeviceLost, runGpglEject, runGpglJob, waitUntilReady, type RunTiming, type UsbTransport } from './usbDevice'
import { setPlotterLogger } from './log'
import { ResumeGate } from './types'

const model = SILHOUETTE_MODELS.find((m) => m.id === 'cameo2')!
const timing: RunTiming = { pollMs: 3, settleMs: 3, confirmReady: 2, readyTimeoutMs: 400, initDelayMs: 1 }

const job: CutJob = {
  workArea: { name: 'x', width: 300, height: 300 },
  settings: { blade: 3, force: 10, speed: 5, passes: 1, overcut: 0 },
  paths: [
    { closed: true, points: [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }] },
    { closed: false, points: [{ x: 100, y: 100 }, { x: 150, y: 100 }] }
  ]
}

/** Attrappe eines puffernden Plotters: nach jedem Datenblock ist er `busyMs` lang beschäftigt (Status '1'). */
class FakePlotter implements UsbTransport {
  busyUntil = 0
  log: { t: number; kind: string }[] = []
  statusAnswers: string[] = [] // Überschreibt die nächsten Antworten (z. B. '2' = kein Medium)
  failReads = 0 // so viele Lesevorgänge laufen in einen Timeout
  failWriteAt = -1 // ab dem n-ten Datenblock (0-basiert) wirft write() einen Fehler
  failWith: Error | null = null
  private dataWrites = 0
  private pending = false
  constructor(public busyMs = 25) {}

  async write(data: Uint8Array): Promise<void> {
    if (data[0] === 0x1b && data[1] === 0x05) { this.pending = true; return }
    if (this.failWriteAt >= 0 && this.dataWrites++ >= this.failWriteAt) throw this.failWith ?? new Error('LIBUSB_ERROR_NO_DEVICE')
    this.busyUntil = Date.now() + this.busyMs
    this.log.push({ t: Date.now(), kind: 'data:' + Buffer.from(data).toString('latin1').slice(0, 4).replace(/[^\x20-\x7e]/g, '.') })
  }

  async read(): Promise<Uint8Array | undefined> {
    if (!this.pending) return undefined
    this.pending = false
    if (this.failReads > 0) { this.failReads--; throw new Error('LIBUSB_ERROR_TIMEOUT') }
    const forced = this.statusAnswers.shift()
    const s = forced ?? (Date.now() < this.busyUntil ? '1' : '0')
    return new Uint8Array([s.charCodeAt(0), 0x03])
  }
}

async function run(t: UsbTransport, signal = new AbortController().signal, tm = timing, gate?: ResumeGate): Promise<{ ev: PlotEvent[]; at: number[] }> {
  const ev: PlotEvent[] = []
  const at: number[] = []
  await runGpglJob(t, model, job, (e) => { ev.push(e); at.push(Date.now()) }, signal, tm, gate)
  return { ev, at }
}

describe('runGpglJob (Fake-Plotter)', () => {
  it('meldet Fortschritt erst, wenn der Plotter nach dem Pfad wieder bereit ist', async () => {
    const plotter = new FakePlotter(30)
    const { ev, at } = await run(plotter)
    expect(ev[0].type).toBe('started')
    expect(ev[ev.length - 1].type).toBe('finished')
    const done = ev.map((e, i) => ({ e, i })).filter((x) => x.e.type === 'progress' && x.e.done)
    expect(done).toHaveLength(2)
    // Vor dem Ende des letzten Blocks (busyUntil) darf nichts als erledigt gemeldet werden
    const dataWrites = plotter.log.filter((l) => l.kind.startsWith('data:'))
    // Fortschritt für Pfad 0 kommt frühestens busyMs nach dem Schreiben seines Datenblocks
    const firstPathWrite = dataWrites.find((l) => l.kind.startsWith('data:M'))!
    expect(at[done[0].i] - firstPathWrite.t).toBeGreaterThanOrEqual(30 - 2)
    // 'finished' kommt erst nach dem Abschlussblock + bereit
    const trailerWrite = dataWrites[dataWrites.length - 1]
    expect(at[at.length - 1] - trailerWrite.t).toBeGreaterThanOrEqual(30 - 2)
  })

  it('sendet den nächsten Block erst, wenn der vorherige fertig ist', async () => {
    const plotter = new FakePlotter(20)
    await run(plotter)
    const w = plotter.log.filter((l) => l.kind.startsWith('data:'))
    // w[0] ist ESC EOT (Initialisierung, danach nur kurze feste Pause); ab dem Setup wird jeweils auf 'bereit' gewartet
    for (let i = 2; i < w.length; i++) expect(w[i].t - w[i - 1].t).toBeGreaterThanOrEqual(20 - 2)
  })

  it('Start- und Ende-Ereignis je Pfad in richtiger Reihenfolge', async () => {
    const { ev } = await run(new FakePlotter(5))
    const prog = ev.filter((e) => e.type === 'progress') as Extract<PlotEvent, { type: 'progress' }>[]
    expect(prog.map((p) => [p.pathIndex, p.done])).toEqual([[0, false], [0, true], [1, false], [1, true]])
    expect(prog[0]).toMatchObject({ x: 10, y: 10, cutLength: 0 })
    expect(prog[3].cutLength).toBeCloseTo(30 + 30 + Math.hypot(30, 30) + 50, 5)
  })

  it('ein einzelnes "bereit" direkt nach dem Senden genügt nicht', async () => {
    const p = new FakePlotter(0)
    // Erste Antwort nach jedem Block: bereit, danach beschäftigt, danach bereit
    p.statusAnswers = ['0', '1', '1', '0', '0']
    await expect(waitUntilReady(p, new AbortController().signal, timing)).resolves.toBeUndefined()
    expect(p.statusAnswers).toHaveLength(0)
  })

  it('Lese-Timeouts beim Abfragen gelten als "noch beschäftigt"', async () => {
    const p = new FakePlotter(0)
    p.failReads = 3
    const { ev } = await run(p)
    expect(ev[ev.length - 1].type).toBe('finished')
  })

  it('kein Material: Fehlermeldung statt Fortschritt', async () => {
    const p = new FakePlotter(0)
    p.statusAnswers = ['2']
    const { ev } = await run(p)
    const last = ev[ev.length - 1]
    expect(last.type).toBe('error')
    expect(last.type === 'error' && last.message).toMatch(/kein Material/)
    expect(ev.some((e) => e.type === 'progress' && e.done)).toBe(false)
  })

  it('Timeout, wenn der Plotter nie bereit wird: verständliche Fehlermeldung', async () => {
    const p = new FakePlotter(60_000)
    const { ev } = await run(p, new AbortController().signal, { ...timing, readyTimeoutMs: 60 })
    const last = ev[ev.length - 1]
    expect(last.type).toBe('error')
    expect(last.type === 'error' && last.message).toMatch(/Zeitüberschreitung/)
    expect(ev.some((e) => e.type === 'finished' || (e.type === 'progress' && e.done))).toBe(false)
  })

  it('Abbruch während des Wartens liefert "cancelled" und kein "finished"', async () => {
    const ctrl = new AbortController()
    const p = new FakePlotter(200)
    setTimeout(() => ctrl.abort(), 40)
    const { ev } = await run(p, ctrl.signal)
    expect(ev[ev.length - 1].type).toBe('cancelled')
    expect(ev.some((e) => e.type === 'finished')).toBe(false)
  })

  describe('Fehlerpfade', () => {
    it('kein Medium vor dem Start: Pause, "Weiter" setzt fort und schneidet dann komplett', async () => {
      const p = new FakePlotter(0)
      p.statusAnswers = ['2'] // erste Abfrage: kein Medium
      const gate = new ResumeGate()
      const ev: PlotEvent[] = []
      const done = runGpglJob(p, model, job, (e) => ev.push(e), new AbortController().signal, timing, gate)
      await new Promise((r) => setTimeout(r, 40))
      expect(ev.map((e) => e.type)).toEqual(['started', 'paused'])
      expect(p.log.filter((l) => l.kind.startsWith('data:M'))).toHaveLength(0) // noch nichts geschnitten
      gate.resume()
      await done
      expect(ev.map((e) => e.type)).toContain('resumed')
      expect(ev[ev.length - 1].type).toBe('finished')
      expect(ev.filter((e) => e.type === 'progress' && e.done)).toHaveLength(2)
    })

    it('Pause bleibt, wenn nach "Weiter" immer noch kein Medium da ist; Abbruch beendet sauber', async () => {
      const p = new FakePlotter(0)
      p.statusAnswers = ['2', '2']
      const gate = new ResumeGate()
      const ctrl = new AbortController()
      const ev: PlotEvent[] = []
      const done = runGpglJob(p, model, job, (e) => ev.push(e), ctrl.signal, timing, gate)
      await new Promise((r) => setTimeout(r, 30))
      gate.resume()
      await new Promise((r) => setTimeout(r, 30))
      expect(ev.filter((e) => e.type === 'paused')).toHaveLength(2)
      ctrl.abort()
      await done
      expect(ev[ev.length - 1].type).toBe('cancelled')
      expect(ev.some((e) => e.type === 'finished')).toBe(false)
    })

    it('Medium verschwindet mitten im Schnitt: sauberer Abbruch mit Erklärung, kein Fortsetzen', async () => {
      const p = new FakePlotter(0)
      p.statusAnswers = ['0', '0', '0', '2']
      const { ev } = await run(p, new AbortController().signal, timing, new ResumeGate())
      const last = ev[ev.length - 1]
      expect(last.type).toBe('error')
      expect(last.type === 'error' && last.message).toMatch(/kein Medium mehr erkannt/)
      expect(last.type === 'error' && last.deviceLost).toBeFalsy()
      expect(ev.some((e) => e.type === 'paused' || e.type === 'finished')).toBe(false)
    })

    it('Gerät verschwindet mitten im Job (Kabel gezogen): Fehler mit deviceLost, kein Hängen', async () => {
      const p = new FakePlotter(0)
      p.failWriteAt = 3 // Init, Setup, Pfad 0 gehen durch; Pfad 1 nicht mehr
      p.failWith = Object.assign(new Error('LIBUSB_ERROR_NO_DEVICE'), { errno: -4 })
      const { ev } = await run(p)
      const last = ev[ev.length - 1]
      expect(last).toMatchObject({ type: 'error', deviceLost: true, message: msgDeviceLost() })
      expect(ev.filter((e) => e.type === 'progress' && e.done)).toHaveLength(1)
    })

    it('isDeviceLost erkennt NO_DEVICE/IO/PIPE, aber nicht Timeout oder Treiberfehler', () => {
      expect(isDeviceLost(new Error('LIBUSB_ERROR_NO_DEVICE'))).toBe(true)
      expect(isDeviceLost(Object.assign(new Error('x'), { errno: -1 }))).toBe(true)
      expect(isDeviceLost(new Error('LIBUSB_ERROR_PIPE'))).toBe(true)
      expect(isDeviceLost(new Error('LIBUSB_ERROR_TIMEOUT'))).toBe(false)
      expect(isDeviceLost(new Error('LIBUSB_ERROR_NOT_SUPPORTED'))).toBe(false)
    })

    it('Gerätefehler landen im Log', async () => {
      const lines: string[] = []
      setPlotterLogger((l) => lines.push(l))
      try {
        const p = new FakePlotter(0)
        p.failWriteAt = 2
        p.failWith = Object.assign(new Error('LIBUSB_ERROR_IO'), { errno: -1 })
        await run(p)
      } finally { setPlotterLogger(null) }
      expect(lines.some((l) => /device lost/.test(l) && /LIBUSB_ERROR_IO/.test(l) && /errno -1/.test(l))).toBe(true)
    })
  })
})

describe('Ausfahren (Fake-Plotter)', () => {
  const ejectJob: CutJob = { ...job, ejectExtraMm: 20 }
  const writes = (p: FakePlotter): string[] => p.log.map((l) => l.kind)

  it('nach dem Job: ejecting vor finished, Ausfahr-Befehl als letzter Block', async () => {
    const plotter = new FakePlotter(5)
    const ev: PlotEvent[] = []
    await runGpglJob(plotter, model, ejectJob, (e) => ev.push(e), new AbortController().signal, timing)
    const types = ev.map((e) => e.type)
    expect(types[types.length - 2]).toBe('ejecting')
    expect(types[types.length - 1]).toBe('finished')
    expect(writes(plotter)[writes(plotter).length - 1]).toBe('data:M240')
    expect(plotter.log.some((l) => l.kind === 'data:H...')).toBe(false) // kein Zurückholen
  })

  it('Job ohne Option: kein Ausfahren', async () => {
    const plotter = new FakePlotter(5)
    const ev: PlotEvent[] = []
    await runGpglJob(plotter, model, job, (e) => ev.push(e), new AbortController().signal, timing)
    expect(ev.some((e) => e.type === 'ejecting')).toBe(false)
  })

  it('bei Abbruch wird NICHT ausgefahren', async () => {
    const plotter = new FakePlotter(30)
    const ctrl = new AbortController()
    const ev: PlotEvent[] = []
    const p = runGpglJob(plotter, model, ejectJob, (e) => { ev.push(e); if (e.type === 'progress' && e.done) ctrl.abort() }, ctrl.signal, timing)
    await p
    expect(ev.some((e) => e.type === 'ejecting')).toBe(false)
    expect(ev[ev.length - 1].type).toBe('cancelled')
    expect(plotter.log.some((l) => l.kind.startsWith('data:M240'))).toBe(false)
  })

  it('ohne Job: Init, dann Ausfahr-Befehl, wartet auf bereit', async () => {
    const plotter = new FakePlotter(20)
    const t0 = Date.now()
    await runGpglEject(plotter, 100, new AbortController().signal, timing)
    expect(writes(plotter)).toHaveLength(2)
    expect(writes(plotter)[1]).toBe('data:M200')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(18)
  })

  it('ohne Job und ohne Medium: verständliche Meldung, kein Vorschub', async () => {
    const plotter = new FakePlotter(5)
    plotter.statusAnswers = ['2']
    await expect(runGpglEject(plotter, 100, new AbortController().signal, timing)).rejects.toThrow(/kein Material/)
    expect(plotter.log.some((l) => l.kind.startsWith('data:M'))).toBe(false)
  })

  it('Gerät weg: Meldung zur Verbindung', async () => {
    const plotter = new FakePlotter(5)
    plotter.failWriteAt = 1
    await expect(runGpglEject(plotter, 100, new AbortController().signal, timing)).rejects.toThrow(msgDeviceLost())
  })
})
