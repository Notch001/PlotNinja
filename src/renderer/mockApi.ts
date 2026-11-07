/**
 * Simuliert window.api im reinen Browser (ohne Electron). Wird nur installiert, wenn window.api fehlt.
 */
import type { CutJob, DeviceInfo, DeviceStatus, FsEntry, PersistedSettings, PlotEvent } from '@shared/types'
import { DEFAULT_CUT, DEFAULT_WORK_AREAS } from '@shared/types'
import type { PlotNinjaApi } from '@shared/ipc'

function polygon(points: [number, number][]): string {
  return `<polygon points="${points.map((p) => p.join(',')).join(' ')}"/>`
}
function starPoints(cx: number, cy: number, ro: number, ri: number, n: number): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? ro : ri
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2
    pts.push([+(cx + Math.cos(a) * r).toFixed(2), +(cy + Math.sin(a) * r).toFixed(2)])
  }
  return pts
}
function gearPath(): string {
  const teeth = 12, cx = 100, cy = 100
  const pts: string[] = []
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2
    const r = i % 4 === 1 || i % 4 === 2 ? 95 : 78
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><path d="M${pts.join(' L')} Z"/><circle cx="100" cy="100" r="28"/></svg>`
}
const HEART = 'M50 88 C10 58 0 35 14 18 C28 3 46 10 50 26 C54 10 72 3 86 18 C100 35 90 58 50 88 Z'
const wrap = (inner: string, vb = '0 0 100 100'): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${inner}</svg>`

const SVGS: Record<string, string> = {
  'C:\\Beispiele\\Formen\\stern.svg': wrap(polygon(starPoints(50, 52, 48, 20, 5))),
  'C:\\Beispiele\\Formen\\herz.svg': wrap(`<path d="${HEART}"/>`),
  'C:\\Beispiele\\Formen\\ring.svg': wrap('<circle cx="50" cy="50" r="48"/><circle cx="50" cy="50" r="30"/>'),
  'C:\\Beispiele\\Formen\\zahnrad.svg': gearPath(),
  'C:\\Beispiele\\Sets\\aufkleber-set.svg': wrap(
    `<rect x="4" y="4" width="90" height="50" rx="6"/>
     <circle cx="150" cy="40" r="32"/>
     <g transform="translate(14,70)">${polygon(starPoints(40, 40, 38, 16, 6))}</g>
     <path transform="translate(110,78) scale(0.9)" d="${HEART}"/>
     <path d="M200 8 L240 8 L240 48 L200 48 Z M210 18 L230 18 L230 38 L210 38 Z"/>`,
    '0 0 250 170'
  ),
  'C:\\Beispiele\\Sets\\girlande.svg': wrap(
    [0, 1, 2, 3, 4].map((i) => polygon([[4 + i * 40, 4], [44 + i * 40, 4], [24 + i * 40, 60]])).join(''),
    '0 0 210 70'
  ),
  'C:\\Beispiele\\Geburtstag\\kerze.svg': wrap('<rect x="35" y="35" width="30" height="60"/><path d="M50 4 C62 18 62 28 50 32 C38 28 38 18 50 4 Z"/>'),
  'C:\\Beispiele\\Geburtstag\\ballon.svg': wrap('<path d="M50 4 C90 4 96 52 50 78 C4 52 10 4 50 4 Z"/><path d="M50 78 L44 90 L56 90 Z"/>'),
  'D:\\Download\\Weihnachten\\tannenbaum.svg': wrap(polygon([[50, 2], [80, 40], [66, 40], [92, 74], [58, 74], [58, 98], [42, 98], [42, 74], [8, 74], [34, 40], [20, 40]]))
}
SVGS['C:\\Beispiele\\Formen\\sechseck.svg'] = wrap(
  polygon([0, 1, 2, 3, 4, 5].map((i): [number, number] => [+(50 + Math.cos((i / 6) * Math.PI * 2) * 48).toFixed(2), +(50 + Math.sin((i / 6) * Math.PI * 2) * 48).toFixed(2)]))
)

const dirs = new Set<string>()
for (const p of Object.keys(SVGS)) {
  const parts = p.split('\\')
  for (let i = 2; i < parts.length; i++) dirs.add(parts.slice(0, i).join('\\'))
}

function listDirMock(path: string): FsEntry[] {
  const prefix = path.replace(/\\$/, '') + '\\'
  const out: FsEntry[] = []
  const seen = new Set<string>()
  for (const d of dirs) {
    if (d.startsWith(prefix) && !d.slice(prefix.length).includes('\\') && !seen.has(d)) {
      seen.add(d)
      out.push({ name: d.slice(prefix.length), path: d, isDir: true })
    }
  }
  for (const f of Object.keys(SVGS)) {
    if (f.startsWith(prefix) && !f.slice(prefix.length).includes('\\')) out.push({ name: f.slice(prefix.length), path: f, isDir: false })
  }
  out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'de') : a.isDir ? -1 : 1))
  return out
}

const SETTINGS_KEY = 'plotninja.mock.settings'
function defaultSettings(): PersistedSettings {
  return {
    workAreas: DEFAULT_WORK_AREAS.map((w) => ({ ...w })),
    activeWorkArea: { ...DEFAULT_WORK_AREAS[0] },
    cut: { ...DEFAULT_CUT },
    rootFolders: ['C:\\Beispiele', 'D:\\Download']
  }
}

function pathLen(pts: { x: number; y: number }[], closed: boolean): number {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  if (closed && pts.length > 1) l += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y)
  return l
}

export function installMockApi(): void {
  if (typeof window === 'undefined' || (window as { api?: PlotNinjaApi }).api) return

  const statusCbs = new Set<(s: DeviceStatus) => void>()
  const plotCbs = new Set<(e: PlotEvent) => void>()
  let status: DeviceStatus = 'disconnected'
  let timer: ReturnType<typeof setInterval> | null = null
  const setStatus = (s: DeviceStatus): void => { status = s; statusCbs.forEach((cb) => cb(s)) }
  const emit = (e: PlotEvent): void => plotCbs.forEach((cb) => cb(e))
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  const api: PlotNinjaApi = {
    platform: 'browser-mock',
    async listDevices(): Promise<DeviceInfo[]> {
      await wait(250)
      return [
        { id: 'usb:0b4d:112b', name: 'Silhouette Cameo 3 (Demo)', kind: 'usb' },
        { id: 'simulator', name: 'Simulator (kein echter Plotter)', kind: 'simulator' }
      ]
    },
    async connect(id) {
      await wait(300)
      void id
      setStatus('ready')
      return { ok: true }
    },
    async disconnect() { setStatus('disconnected') },
    onDeviceStatus(cb) { statusCbs.add(cb); return () => { statusCbs.delete(cb) } },
    async startPlot(job: CutJob) {
      if (status !== 'ready') throw new Error('Kein Gerät bereit')
      const speedMmPerTick = 3 + job.settings.speed * 1.2
      const paths = job.paths
      const total = paths.reduce((s, p) => s + pathLen(p.points, p.closed), 0)
      setStatus('busy')
      emit({ type: 'started', totalPaths: paths.length, totalLength: total })
      let idx = 0, seg = 0, segPos = 0, cut = 0
      const pts = (i: number): { x: number; y: number }[] => {
        const p = paths[i]
        return p.closed ? [...p.points, p.points[0]] : p.points
      }
      timer = setInterval(() => {
        let budget = speedMmPerTick
        while (budget > 0 && idx < paths.length) {
          const P = pts(idx)
          if (seg >= P.length - 1) { idx++; seg = 0; segPos = 0; continue }
          const a = P[seg], b = P[seg + 1]
          const l = Math.hypot(b.x - a.x, b.y - a.y)
          const rest = l - segPos
          if (rest <= budget) { budget -= rest; cut += rest; seg++; segPos = 0 } else { segPos += budget; cut += budget; budget = 0 }
        }
        if (idx >= paths.length) {
          if (timer) clearInterval(timer)
          timer = null
          const last = paths[paths.length - 1]
          const lp = last ? last.points[last.points.length - 1] : { x: 0, y: 0 }
          emit({ type: 'progress', pathIndex: paths.length - 1, x: lp.x, y: lp.y, cutLength: total, done: true })
          emit({ type: 'finished' })
          setStatus('ready')
          return
        }
        const P = pts(idx)
        const a = P[seg], b = P[Math.min(seg + 1, P.length - 1)]
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
        emit({ type: 'progress', pathIndex: idx, x: a.x + ((b.x - a.x) * segPos) / l, y: a.y + ((b.y - a.y) * segPos) / l, cutLength: cut, done: false })
      }, 40)
    },
    async cancelPlot() {
      if (timer) clearInterval(timer)
      timer = null
      emit({ type: 'cancelled' })
      setStatus('ready')
    },
    onPlotEvent(cb) { plotCbs.add(cb); return () => { plotCbs.delete(cb) } },
    async listDir(path) { await wait(80); return listDirMock(path) },
    async readText(path) {
      const t = SVGS[path]
      if (t === undefined) throw new Error('Datei nicht gefunden: ' + path)
      return t
    },
    async pickFolder() {
      await wait(150)
      return 'C:\\Beispiele\\Sets'
    },
    async loadSettings() {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY)
        if (raw) return { ...defaultSettings(), ...JSON.parse(raw) } as PersistedSettings
      } catch { /* ignorieren */ }
      return defaultSettings()
    },
    async saveSettings(s) {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* ignorieren */ }
    },
    getPathForFile(file) { return file.name }
  }
  ;(window as unknown as { api: PlotNinjaApi }).api = api
}
