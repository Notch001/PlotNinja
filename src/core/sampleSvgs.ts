/**
 * Beispiel-SVGs für Tests und die Browser-Demo (mockApi): ein "Schriftzug" aus Text-als-Pfade, so wie ihn
 * Inkscape/Illustrator beim Umwandeln von Text erzeugen (Glyphen mit Löchern, überlappende Konturen,
 * relative Kommandos, kompakte Zahlen/Bogen-Flags, <use>, transform, CSS-Klassen).
 */

/** Pfad-Daten je Glyphe in einer 30 × 42 Einheiten großen Zelle. */
const GLYPHS_RAW: Record<string, string[]> = {
  // Außenkontur + dreieckiges Loch
  A: ['M0 40L13 0H17L30 40H24L21 30H9L6 40Z', 'M11 24H19L15 8Z'],
  // Ellipse aus Bögen mit Flags ohne Trenner ("1030 0" = large=1, sweep=0, x=30, y=0) und Loch
  o: ['M0 28a15 12 0 1030 0a15 12 0 10-30 0z', 'M7 28a8 6 0 1 1 16 0a8 6 0 1 1-16 0z'],
  // Ziffer 0
  '0': [
    'M15 0C4 0 3 12 3 20C3 28 4 40 15 40C26 40 27 28 27 20C27 12 26 0 15 0Z',
    'M15 6C10 6 9 14 9 20C9 26 10 34 15 34C20 34 21 26 21 20C21 14 20 6 15 6Z'
  ],
  // Ziffer 6 mit Bauch-Loch
  '6': [
    'M26 6C20-2 4-2 4 22C4 40 10 42 15 42C24 42 28 36 28 30C28 22 22 18 15 18C11 18 8 20 6 22C6 12 14 4 26 6Z',
    'M8 30C8 24 12 22 15 22C19 22 22 25 22 30C22 35 19 38 15 38C11 38 8 35 8 30Z'
  ],
  // Ziffer 8 mit zwei Löchern
  '8': [
    'M15 0C5 0 3 8 8 14C2 18 1 26 4 34C7 40 23 40 26 34C29 26 28 18 22 14C27 8 25 0 15 0Z',
    'M15 6C11 6 11 11 15 12C19 11 19 6 15 6Z',
    'M15 19C9 20 8 30 15 34C22 30 21 20 15 19Z'
  ],
  // "f": Schaft und Querstrich als getrennte, sich überlappende Konturen (wie bei Variablen-Fonts) -> Weld: 1 Kontur
  f: ['M12 6C12 0 20 0 24 3L22 8C18 6 17 7 17 10V40H12Z', 'M5 14H26V19H5Z'],
  // Blockige Ziffer 3 aus zwei sich überlappenden "⊐"-Teilen (y 18-20 überlappt) -> Weld: 1 Kontur, kein Loch
  '3': ['M4 2H24V20H4V15H19V7H4Z', 'M4 18H24V38H4V33H19V23H4Z'],
  // Ziffer 2
  '2': ['M3 10C5-2 25-2 26 10C26 18 18 24 10 32H27V38H3V33C10 24 20 18 20 10C20 5 9 5 9 11Z'],
  // Ziffer 1: Schaft und Fahne als überlappende Konturen -> Weld: 1 Kontur
  '1': ['M10 0H18V38H10Z', 'M3 8L12 3V12H3Z'],
  // "P": Schaft + Bauch (mit Loch, Gegenwindung) überlappen -> Weld: Außenkontur + 1 Loch
  P: ['M4 0H10V40H4Z', 'M4 0H20C30 0 30 22 20 22H4Z M10 6V16H19C22 16 22 6 19 6Z']
}

/**
 * Wie in echten Font-Exporten liegen Außenkontur und Löcher eines Buchstabens in EINEM Pfad (Unterpfade).
 * Glyphen in OVERLAP_GLYPHS bestehen dagegen bewusst aus mehreren, sich überlappenden Pfaden.
 */
const OVERLAP_GLYPHS = new Set(['f', '3', '1', 'P'])
const GLYPHS: Record<string, string[]> = Object.fromEntries(
  Object.entries(GLYPHS_RAW).map(([g, ds]) => [g, OVERLAP_GLYPHS.has(g) ? ds : [ds.join(' ')]])
)

/** Reihenfolge im Schriftzug und erwartete Konturenanzahl je Glyphe NACH dem Vereinen (Weld): Außenkontur + echte Löcher. */
export const LETTERING_ORDER = ['A', 'o', '0', '6', '8', 'f', '3', '2', '1', 'P']
export const LETTERING_CONTOURS: Record<string, number> = { A: 2, o: 2, '0': 2, '6': 2, '8': 3, f: 1, '3': 1, '2': 1, '1': 1, P: 2 }
export const LETTERING_CELL = 36

/** Glyphen, deren Löcher per fill-rule: evenodd (CSS-Klasse "eo") statt per Gegenwindung definiert sind. */
const EVENODD_GLYPHS = new Set(['0', '8'])

/** Schriftzug als Text-als-Pfade-SVG, 150 × 20 mm. Jede Glyphe sitzt in einer eigenen Gruppe mit transform. */
export function letteringSvg(): string {
  const body = LETTERING_ORDER.map((g, i) => {
    const cls = EVENODD_GLYPHS.has(g) ? 'glyph eo' : 'glyph'
    const paths = GLYPHS[g].map((d) => `<path class="${cls}" d="${d}"/>`).join('')
    return `<g id="glyph-${g}" transform="translate(${3 + i * LETTERING_CELL} 1)">${paths}</g>`
  }).join('\n  ')
  const w = 3 + LETTERING_ORDER.length * LETTERING_CELL
  return `<svg xmlns="http://www.w3.org/2000/svg" width="150mm" height="20mm" viewBox="0 0 ${w} 44">
  <style>.glyph { fill: #000 } .eo { fill-rule: evenodd } .hidden { display: none }</style>
  <path class="hidden" d="M0 0H500V500H0Z"/>
  ${body}
</svg>`
}
