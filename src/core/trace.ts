import type { Polyline } from '@shared/types'
import { douglasPeucker } from './sanitize'

/**
 * Bild nachzeichnen (Vektorisieren): reine Funktionen auf einem ImageData-ähnlichen Objekt (kein DOM).
 *
 * Ablauf: Bild (ggf. auf max. `MAX_TRACE_EDGE` px Kantenlänge verkleinert) -> Skalarfeld (positiv = Form) ->
 * optional Löcher füllen -> Gauß-Glättung des Feldes -> Marching Squares mit linearer Interpolation (subpixelgenau)
 * -> geschlossene Konturen (Orientierung trennt Außenkontur und Loch) -> Rauschfilter -> Douglas-Peucker -> mm.
 */

export interface ImageLike { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

export type TraceMode = 'bw' | 'alpha' | 'color'

export interface TraceOptions {
  mode: TraceMode
  /** bw: Helligkeitsschwelle 0–255 (dunkler = Form); alpha: Alpha-Schwelle 0–255 (deckender = Form). */
  threshold: number
  /** Form und Hintergrund vertauschen. */
  invert: boolean
  /** Konturen mit weniger als n Pixeln Fläche (Flecken und winzige Löcher) entfallen. */
  speckle: number
  /** Glättung 0–5 (Gauß-Radius auf dem Feld, in Pixeln etwa 0,5 pro Stufe). */
  smooth: number
  /** Vereinfachung (Douglas-Peucker-Toleranz) in Pixeln. */
  simplifyPx: number
  /** Alle Löcher füllen (nur Außenkonturen). */
  fillHoles: boolean
  /** Zielbreite des GANZEN Bildes in mm (die Form kann kleiner sein). */
  widthMm: number
  /** Modus 'color': gewählte Farbe und Toleranz (0–255, euklidischer RGB-Abstand / sqrt(3)). */
  color?: { r: number; g: number; b: number }
  tolerance: number
}

export const DEFAULT_TRACE: TraceOptions = {
  mode: 'bw', threshold: 128, invert: false, speckle: 8, smooth: 1, simplifyPx: 0.7, fillHoles: false, widthMm: 100, tolerance: 60
}

/** Ab dieser Kantenlänge (px) wird vor dem Nachzeichnen verkleinert. */
export const MAX_TRACE_EDGE = 2000
/** Standard-Auflösung für die Anfangsgröße in mm (96 dpi). */
export const MM_PER_PX_96DPI = 25.4 / 96

export interface TraceResult {
  /** Geschlossene, gefüllte Konturen in mm, y nach unten, Ursprung = linke obere Ecke des Bildes. */
  paths: Polyline[]
  /** Breite/Höhe des ganzen Bildes in mm. */
  imageWidthMm: number
  imageHeightMm: number
  /** Nichts erkannt. */
  empty: boolean
  pointCount: number
  /** Faktor, um den vor dem Nachzeichnen verkleinert wurde (1 = unverändert). */
  downscale: number
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** Helligkeit eines Pixels, Transparenz wird auf Weiß gelegt. */
function lumAt(d: ArrayLike<number>, i: number): number {
  const a = d[i + 3]
  const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  return a === 255 ? l : (l * a + 255 * (255 - a)) / 255
}

/** Auto-Schwellwert nach Otsu (auf der Helligkeit, Transparenz = weiß). Ergebnis 1–254. */
export function otsuThreshold(img: ImageLike): number {
  const hist = new Float64Array(256)
  const d = img.data
  const n = img.width * img.height
  // Bei großen Bildern genügt eine Stichprobe
  const step = n > 1_000_000 ? Math.ceil(n / 1_000_000) : 1
  let total = 0
  for (let p = 0; p < n; p += step) { hist[Math.round(lumAt(d, p * 4))]++; total++ }
  if (!total) return 128
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let wB = 0, sumB = 0, best = -1, thr = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; thr = t }
  }
  // Der Schwellwert t trennt "<= t" von "> t"; Mitte zwischen den Klassen ergibt stabilere Kanten
  return clamp(thr + 1, 1, 254)
}

/** Anteil der Pixel mit nennenswerter Transparenz (Alpha < 250). */
export function alphaCoverage(img: ImageLike): { transparent: number; opaque: number } {
  const d = img.data
  const n = img.width * img.height
  const step = n > 1_000_000 ? Math.ceil(n / 1_000_000) : 1
  let tr = 0, op = 0, tot = 0
  for (let p = 0; p < n; p += step) {
    const a = d[p * 4 + 3]
    if (a < 250) tr++
    if (a > 128) op++
    tot++
  }
  return { transparent: tot ? tr / tot : 0, opaque: tot ? op / tot : 0 }
}

/** Hat das Bild nennenswert Alpha (mehr als 2 % transparent, aber nicht komplett leer)? Dann ist der Modus „Transparenz“ sinnvoll. */
export function hasSignificantAlpha(img: ImageLike): boolean {
  const c = alphaCoverage(img)
  return c.transparent > 0.02 && c.opaque > 0.001
}

/** Verkleinert mit Flächenmittelung (Box-Filter) auf höchstens `maxEdge`; gibt das Original zurück, wenn nichts zu tun ist. */
export function downscaleImage(img: ImageLike, maxEdge = MAX_TRACE_EDGE): { img: ImageLike; factor: number } {
  const m = Math.max(img.width, img.height)
  if (m <= maxEdge) return { img, factor: 1 }
  const f = maxEdge / m
  const w = Math.max(1, Math.round(img.width * f)), h = Math.max(1, Math.round(img.height * f))
  const out = new Uint8ClampedArray(w * h * 4)
  const sx = img.width / w, sy = img.height / h
  const src = img.data
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(img.height, Math.ceil((y + 1) * sy)))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(img.width, Math.ceil((x + 1) * sx)))
      // Alpha-gewichtet mitteln, damit transparente Pixel die Farbe nicht verfälschen
      let r = 0, g = 0, b = 0, a = 0, c = 0
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * img.width + x0) * 4
        for (let xx = x0; xx < x1; xx++, i += 4) {
          const al = src[i + 3]
          r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al; c++
        }
      }
      const o = (y * w + x) * 4
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a }
      out[o + 3] = c ? a / c : 0
    }
  }
  return { img: { width: w, height: h, data: out }, factor: w / img.width }
}

/** Skalarfeld: > 0 = Form, <= 0 = Hintergrund; Werte in [-1, 1] (weiche Kante für die Interpolation). */
function buildField(img: ImageLike, o: TraceOptions): Float32Array {
  const n = img.width * img.height
  const f = new Float32Array(n)
  const d = img.data
  const sgn = o.invert ? -1 : 1
  const SOFT = 24
  if (o.mode === 'alpha') {
    for (let p = 0, i = 3; p < n; p++, i += 4) f[p] = sgn * clamp((d[i] - o.threshold) / SOFT, -1, 1)
  } else if (o.mode === 'color') {
    const c = o.color ?? { r: 0, g: 0, b: 0 }
    const k = 1 / Math.sqrt(3)
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const dist = Math.hypot(d[i] - c.r, d[i + 1] - c.g, d[i + 2] - c.b) * k
      let v = clamp((o.tolerance - dist) / SOFT, -1, 1)
      if (d[i + 3] < 128) v = -1
      f[p] = sgn * v
    }
  } else {
    for (let p = 0, i = 0; p < n; p++, i += 4) f[p] = sgn * clamp((o.threshold - lumAt(d, i)) / SOFT, -1, 1)
  }
  return f
}

/** Füllt Hintergrundbereiche, die nicht mit dem Bildrand verbunden sind (4er-Nachbarschaft), mit Form. */
function fillHolesInField(f: Float32Array, w: number, h: number): void {
  const seen = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let sp = 0
  const push = (p: number): void => { if (!seen[p] && f[p] <= 0) { seen[p] = 1; stack[sp++] = p } }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (sp) {
    const p = stack[--sp]
    const x = p % w, y = (p - x) / w
    if (x > 0) push(p - 1)
    if (x < w - 1) push(p + 1)
    if (y > 0) push(p - w)
    if (y < h - 1) push(p + w)
  }
  for (let p = 0; p < w * h; p++) if (!seen[p] && f[p] <= 0) f[p] = 0.5
}

/** Gauß-Weichzeichnung (separabel, Kanten geklemmt) in place. */
function gaussBlur(f: Float32Array, w: number, h: number, sigma: number): void {
  if (sigma < 0.05) return
  const r = Math.max(1, Math.ceil(sigma * 2.5))
  const k = new Float32Array(2 * r + 1)
  let s = 0
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + r] = v; s += v }
  for (let i = 0; i < k.length; i++) k[i] /= s
  const tmp = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let i = -r; i <= r; i++) acc += f[row + clamp(x + i, 0, w - 1)] * k[i + r]
      tmp[row + x] = acc
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let acc = 0
      for (let i = -r; i <= r; i++) acc += tmp[clamp(y + i, 0, h - 1) * w + x] * k[i + r]
      f[y * w + x] = acc
    }
  }
}

interface Loop { pts: Float64Array; n: number; area: number }

/**
 * Marching Squares auf dem Feld (innen = > 0). Ein Rand aus „Hintergrund“ um das Feld schließt alle Konturen.
 * Rückgabe: geschlossene Schleifen in Pixelkoordinaten (Pixelmitte = x + 0,5). Das Vorzeichen der Fläche trennt
 * Außenkonturen (area > 0) von Löchern (area < 0).
 */
function marchingSquares(f: Float32Array, w: number, h: number): Loop[] {
  const W = w + 2, H = h + 2
  const N = W * H
  const g = new Float32Array(N).fill(-1)
  for (let y = 0; y < h; y++) g.set(f.subarray(y * w, y * w + w), (y + 1) * W + 1)
  const next = new Int32Array(2 * N).fill(-1)
  // Kantenkennung: waagerecht (x,y)-(x+1,y) = y*W+x; senkrecht (x,y)-(x,y+1) = N + y*W+x
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const i = y * W + x
      const a = g[i] > 0 ? 8 : 0, b = g[i + 1] > 0 ? 4 : 0, c = g[i + W + 1] > 0 ? 2 : 0, d = g[i + W] > 0 ? 1 : 0
      const cs = a | b | c | d
      if (cs === 0 || cs === 15) continue
      const T = i, B = i + W, L = N + i, R = N + i + 1
      switch (cs) {
        case 8: next[T] = L; break
        case 4: next[R] = T; break
        case 2: next[B] = R; break
        case 1: next[L] = B; break
        case 12: next[R] = L; break
        case 6: next[B] = T; break
        case 3: next[L] = R; break
        case 9: next[T] = B; break
        case 7: next[L] = T; break
        case 11: next[T] = R; break
        case 13: next[R] = B; break
        case 14: next[B] = L; break
        case 10:
          if ((g[i] + g[i + 1] + g[i + W] + g[i + W + 1]) > 0) { next[T] = R; next[B] = L } else { next[T] = L; next[B] = R }
          break
        case 5:
          if ((g[i] + g[i + 1] + g[i + W] + g[i + W + 1]) > 0) { next[L] = T; next[R] = B } else { next[R] = T; next[L] = B }
          break
      }
    }
  }
  const loops: Loop[] = []
  const buf: number[] = []
  const edgePoint = (e: number): [number, number] => {
    if (e < N) {
      const y = Math.floor(e / W), x = e - y * W
      const va = g[e], vb = g[e + 1]
      return [x + clamp(va / (va - vb), 0, 1) - 0.5, y - 0.5]
    }
    const q = e - N
    const y = Math.floor(q / W), x = q - y * W
    const va = g[q], vb = g[q + W]
    return [x - 0.5, y + clamp(va / (va - vb), 0, 1) - 0.5]
  }
  for (let start = 0; start < 2 * N; start++) {
    if (next[start] < 0) continue
    buf.length = 0
    let e = start
    while (e >= 0 && next[e] >= 0) {
      const nx = next[e]
      next[e] = -1
      const [px, py] = edgePoint(e)
      buf.push(px, py)
      e = nx
      if (e === start) break
    }
    const n = buf.length / 2
    if (n < 3) continue
    let area = 0
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n
      area += buf[2 * k] * buf[2 * k2 + 1] - buf[2 * k2] * buf[2 * k + 1]
    }
    loops.push({ pts: Float64Array.from(buf), n, area: area / 2 })
  }
  return loops
}

/** Douglas-Peucker für geschlossene Konturen: am weitesten vom Startpunkt entfernten Punkt als zweiten Ankerpunkt. */
function simplifyLoop(pts: { x: number; y: number }[], tol: number): { x: number; y: number }[] {
  if (tol <= 0 || pts.length < 5) return pts
  let far = 0, fd = -1
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2
    if (d > fd) { fd = d; far = i }
  }
  const a = douglasPeucker(pts.slice(0, far + 1), tol)
  const b = douglasPeucker([...pts.slice(far), pts[0]], tol)
  const out = [...a.slice(0, -1), ...b.slice(0, -1)]
  return out.length >= 3 ? out : pts
}

/** Zielbreite in mm aus Pixelbreite bei 96 dpi (gerundet auf 0,1 mm). */
export function defaultWidthMm(pxWidth: number): number {
  return Math.max(1, Math.round(pxWidth * MM_PER_PX_96DPI * 10) / 10)
}

/**
 * Zeichnet ein Bild nach. Die Ergebnisse liegen in mm; Ursprung = linke obere Ecke des (ganzen) Bildes.
 * Die Außenkonturen laufen im Uhrzeigersinn, Löcher dagegen; für die Füllung gilt Even-Odd (`evenOdd: true`).
 */
export function traceImage(src: ImageLike, opts: Partial<TraceOptions> = {}): TraceResult {
  const o: TraceOptions = { ...DEFAULT_TRACE, ...opts }
  const widthMm = Number.isFinite(o.widthMm) && o.widthMm > 0 ? o.widthMm : DEFAULT_TRACE.widthMm
  const mmPerPx = widthMm / src.width
  const imageWidthMm = widthMm, imageHeightMm = src.height * mmPerPx
  const empty = (downscale: number): TraceResult => ({ paths: [], imageWidthMm, imageHeightMm, empty: true, pointCount: 0, downscale })
  if (src.width < 1 || src.height < 1) return empty(1)

  const { img, factor } = downscaleImage(src)
  const w = img.width, h = img.height
  const f = buildField(img, o)
  if (o.fillHoles) fillHolesInField(f, w, h)
  gaussBlur(f, w, h, clamp(o.smooth, 0, 5) * 0.5)
  const loops = marchingSquares(f, w, h)

  // Die Pixelgröße im Ergebnis; Rauschgrenze und Toleranz sind in Pixeln des Originalbildes angegeben
  const k = mmPerPx / factor
  const minArea = Math.max(0, o.speckle) * factor * factor
  const tolPx = Math.max(0, o.simplifyPx) * factor
  const paths: Polyline[] = []
  let pointCount = 0
  for (const lp of loops) {
    if (Math.abs(lp.area) < Math.max(minArea, 0.5)) continue
    let pts: { x: number; y: number }[] = new Array(lp.n)
    for (let i = 0; i < lp.n; i++) pts[i] = { x: lp.pts[2 * i], y: lp.pts[2 * i + 1] }
    pts = simplifyLoop(pts, tolPx)
    if (pts.length < 3) continue
    pointCount += pts.length
    paths.push({ points: pts.map((p) => ({ x: p.x * k, y: p.y * k })), closed: true, filled: true, evenOdd: true, src: 0 })
  }
  if (!paths.length) return empty(factor)
  return { paths, imageWidthMm, imageHeightMm, empty: false, pointCount, downscale: factor }
}

/** Skaliert ein Nachzeichnen-Ergebnis um `f` (Zielbreite nachträglich ändern, ohne neu zu tracen). */
export function scaleTrace(r: TraceResult, f: number): TraceResult {
  if (f === 1) return r
  return {
    ...r,
    imageWidthMm: r.imageWidthMm * f,
    imageHeightMm: r.imageHeightMm * f,
    paths: r.paths.map((p) => ({ ...p, points: p.points.map((q) => ({ x: q.x * f, y: q.y * f })) }))
  }
}
