/** Kleine DXF-Erzeuger (ASCII) für Tests und die Browser-Demo. Koordinaten in Zeicheneinheiten, y nach oben. */

const g = (code: number, value: string | number): string => `${code}\n${value}`

export interface DxfOpts { insUnits?: number; blocks?: string[]; layers?: { name: string; off?: boolean }[] }

export const dxfLine = (x1: number, y1: number, x2: number, y2: number, layer = '0'): string =>
  [g(0, 'LINE'), g(8, layer), g(10, x1), g(20, y1), g(30, 0), g(11, x2), g(21, y2), g(31, 0)].join('\n')

export const dxfCircle = (cx: number, cy: number, r: number, layer = '0'): string =>
  [g(0, 'CIRCLE'), g(8, layer), g(10, cx), g(20, cy), g(30, 0), g(40, r)].join('\n')

/** Winkel in Grad. */
export const dxfArc = (cx: number, cy: number, r: number, a0: number, a1: number, layer = '0'): string =>
  [g(0, 'ARC'), g(8, layer), g(10, cx), g(20, cy), g(30, 0), g(40, r), g(50, a0), g(51, a1)].join('\n')

export const dxfLwPoly = (pts: [number, number, number?][], closed: boolean, layer = '0'): string =>
  [g(0, 'LWPOLYLINE'), g(8, layer), g(90, pts.length), g(70, closed ? 1 : 0),
    ...pts.map(([x, y, b]) => [g(10, x), g(20, y), ...(b ? [g(42, b)] : [])].join('\n'))].join('\n')

export const dxfInsert = (name: string, x: number, y: number, rotation = 0, sx = 1, sy = 1): string =>
  [g(0, 'INSERT'), g(8, '0'), g(2, name), g(10, x), g(20, y), g(30, 0), g(41, sx), g(42, sy), g(50, rotation)].join('\n')

export const dxfBlock = (name: string, entities: string[], bx = 0, by = 0): string =>
  [g(0, 'BLOCK'), g(8, '0'), g(2, name), g(70, 0), g(10, bx), g(20, by), g(30, 0), g(3, name), ...entities, g(0, 'ENDBLK'), g(8, '0')].join('\n')

export function buildDxf(entities: string[], opts: DxfOpts = {}): string {
  const out: string[] = [g(0, 'SECTION'), g(2, 'HEADER'), g(9, '$ACADVER'), g(1, 'AC1015')]
  if (opts.insUnits !== undefined) out.push(g(9, '$INSUNITS'), g(70, opts.insUnits))
  out.push(g(0, 'ENDSEC'))
  if (opts.layers?.length) {
    out.push(g(0, 'SECTION'), g(2, 'TABLES'), g(0, 'TABLE'), g(2, 'LAYER'), g(70, opts.layers.length))
    for (const l of opts.layers) out.push(g(0, 'LAYER'), g(2, l.name), g(70, 0), g(62, l.off ? -7 : 7), g(6, 'CONTINUOUS'))
    out.push(g(0, 'ENDTAB'), g(0, 'ENDSEC'))
  }
  if (opts.blocks?.length) out.push(g(0, 'SECTION'), g(2, 'BLOCKS'), ...opts.blocks, g(0, 'ENDSEC'))
  out.push(g(0, 'SECTION'), g(2, 'ENTITIES'), ...entities, g(0, 'ENDSEC'), g(0, 'EOF'))
  return out.join('\n') + '\n'
}

/** Beispiel für die Demo: Platte 80 × 50 mm mit Bohrung, Langloch und lose gezeichneter Lasche. */
export function sampleBracketDxf(): string {
  const rect = [dxfLine(0, 0, 80, 0), dxfLine(80, 0, 80, 50), dxfLine(80, 50, 0, 50), dxfLine(0, 50, 0, 0)]
  return buildDxf([
    ...rect,
    dxfCircle(20, 25, 8),
    dxfLwPoly([[45, 15], [65, 15, 1], [65, 35], [45, 35, 1]], true), // Langloch mit Bulge-Rundungen
    dxfLine(80, 10, 100, 10), dxfArc(100, 20, 10, 270, 90), dxfLine(100, 30, 80, 30) // Lasche aus Linie + Bogen + Linie
  ], { insUnits: 4 })
}
