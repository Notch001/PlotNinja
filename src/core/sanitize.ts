import type { Point, Polyline } from '@shared/types'

/** Größte erlaubte Dateigröße beim Import (Zeichen/Bytes). */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024
/** Ab so vielen Punkten pro Bauteil wird vereinfacht. */
export const MAX_PART_POINTS = 200_000
/** Toleranz der Vereinfachung (mm). */
export const SIMPLIFY_TOLERANCE_MM = 0.02
/** Koordinaten jenseits dieser Grenze (mm, 1 km) gelten als ungültig – Clipper würde sonst abstürzen. */
export const MAX_COORD_MM = 1e6

/** Wirft eine verständliche Meldung, wenn eine Datei zu groß für den Import ist. */
export function assertImportSize(size: number, fileName = 'Die Datei'): void {
  if (size > MAX_IMPORT_BYTES) {
    const mb = (size / (1024 * 1024)).toLocaleString('de-DE', { maximumFractionDigits: 1 })
    throw new Error(`${fileName} ist mit ${mb} MB zu groß (maximal 20 MB) und wurde nicht importiert. Bitte die Datei verkleinern, z. B. Pfade vereinfachen oder in mehrere Dateien aufteilen.`)
  }
}

const validPoint = (q: Point): boolean => Number.isFinite(q.x) && Number.isFinite(q.y) && Math.abs(q.x) <= MAX_COORD_MM && Math.abs(q.y) <= MAX_COORD_MM

/** Behält nur Pfade mit mindestens 2 Punkten, die alle endlich und im erlaubten Bereich liegen. `dropped` zählt die verworfenen Pfade. */
export function dropInvalidPaths(paths: Polyline[]): { paths: Polyline[]; dropped: number } {
  const ok = paths.filter((p) => p.points.length >= 2 && p.points.every(validPoint))
  const dropped = paths.filter((p) => p.points.length >= 2).length - ok.length
  return { paths: ok, dropped: Math.max(0, dropped) }
}

/** Douglas-Peucker (iterativ, ohne Rekursion) für eine offene Punktfolge; behält erste und letzte Punkte. */
export function douglasPeucker(pts: Point[], tol: number): Point[] {
  const n = pts.length
  if (n < 3) return pts
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number]
    if (b <= a + 1) continue
    const A = pts[a], B = pts[b]
    const dx = B.x - A.x, dy = B.y - A.y
    const l2 = dx * dx + dy * dy
    let best = -1, bd = tol
    for (let i = a + 1; i < b; i++) {
      const P = pts[i]
      let d: number
      if (l2 < 1e-18) d = Math.hypot(P.x - A.x, P.y - A.y)
      else {
        const t = Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / l2))
        d = Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy))
      }
      if (d > bd) { bd = d; best = i }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]) }
  }
  const out: Point[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i])
  return out
}

/** Vereinfacht eine Polylinie; geschlossene Pfade behalten mindestens 3 Punkte. */
export function simplifyPolyline(pl: Polyline, tol = SIMPLIFY_TOLERANCE_MM): Polyline {
  if (pl.points.length < 4) return pl
  let pts: Point[]
  if (pl.closed) {
    // Als offener Pfad vom Start zurück zum Start vereinfachen
    pts = douglasPeucker([...pl.points, pl.points[0]], tol)
    pts.pop()
    if (pts.length < 3) return pl
  } else pts = douglasPeucker(pl.points, tol)
  return { ...pl, points: pts }
}

/**
 * Hat das Bauteil mehr als `maxPoints` Punkte, werden alle Pfade mit Douglas-Peucker (0,02 mm) vereinfacht.
 * `simplified` ist true, wenn vereinfacht wurde.
 */
export function limitPoints(paths: Polyline[], maxPoints = MAX_PART_POINTS, tol = SIMPLIFY_TOLERANCE_MM): { paths: Polyline[]; simplified: boolean; before: number; after: number } {
  const before = paths.reduce((s, p) => s + p.points.length, 0)
  if (before <= maxPoints) return { paths, simplified: false, before, after: before }
  const out = paths.map((p) => simplifyPolyline(p, tol))
  return { paths: out, simplified: true, before, after: out.reduce((s, p) => s + p.points.length, 0) }
}
