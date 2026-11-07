import { describe, expect, it } from 'vitest'
import type { CutJob, PlotEvent } from '@shared/types'
import { SILHOUETTE_MODELS } from '@core/gpgl'
import { runGpglJob, waitUntilReady, type RunTiming, type UsbTransport } from './usbDevice'

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
  private pending = false
  constructor(public busyMs = 25) {}

  async write(data: Uint8Array): Promise<void> {
    if (data[0] === 0x1b && data[1] === 0x05) { this.pending = true; return }
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

async function run(t: UsbTransport, signal = new AbortController().signal, tm = timing): Promise<{ ev: PlotEvent[]; at: number[] }> {
  const ev: PlotEvent[] = []
  const at: number[] = []
  await runGpglJob(t, model, job, (e) => { ev.push(e); at.push(Date.now()) }, signal, tm)
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
})
