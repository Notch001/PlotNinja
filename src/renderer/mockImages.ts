/** Beispielbilder für den Browser-Mock (per Canvas erzeugt, Ausgabe als PNG/JPEG-Bytes). */

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return { c, g: c.getContext('2d') as CanvasRenderingContext2D }
}

async function bytes(c: HTMLCanvasElement, type: string): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, 0.92))
  if (!blob) throw new Error('Bild konnte nicht erzeugt werden')
  return new Uint8Array(await blob.arrayBuffer())
}

/** Schwarzer Kreis (Ring) mit Text auf weißem Grund. */
export async function sampleCircleText(): Promise<Uint8Array> {
  const { c, g } = canvas(640, 640)
  g.fillStyle = '#fff'
  g.fillRect(0, 0, 640, 640)
  g.strokeStyle = '#111'
  g.lineWidth = 34
  g.beginPath(); g.arc(320, 320, 270, 0, Math.PI * 2); g.stroke()
  g.fillStyle = '#111'
  g.font = 'bold 150px Arial, Helvetica, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('NINJA', 320, 285)
  g.font = 'bold 62px Arial, Helvetica, sans-serif'
  g.fillText('PLOT', 320, 410)
  // ein Stern als Zierde
  g.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 24 : 54, a = (i / 10) * Math.PI * 2 - Math.PI / 2
    g.lineTo(320 + Math.cos(a) * r, 505 + Math.sin(a) * r)
  }
  g.closePath(); g.fill()
  return bytes(c, 'image/png')
}

/** Transparentes PNG: farbige Buchstaben und Formen mit kleinen Lücken (zeigt den Lückenschluss der Aufkleberkontur). */
export async function sampleTransparent(): Promise<Uint8Array> {
  const { c, g } = canvas(720, 480)
  g.clearRect(0, 0, 720, 480)
  g.fillStyle = '#e8423f'
  g.font = 'bold 230px Arial, Helvetica, sans-serif'
  g.textBaseline = 'alphabetic'
  g.fillText('Hi', 40, 300)
  g.fillStyle = '#2f7de1'
  g.beginPath(); g.arc(470, 190, 90, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#f2b632'
  g.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 42 : 105, a = (i / 10) * Math.PI * 2 - Math.PI / 2
    g.lineTo(580 + Math.cos(a) * r, 370 + Math.sin(a) * r)
  }
  g.closePath(); g.fill()
  g.fillStyle = '#2aa876'
  g.beginPath(); g.ellipse(250, 395, 150, 45, 0, 0, Math.PI * 2); g.fill()
  return bytes(c, 'image/png')
}

/** JPG mit zwei Farben (Pipette): rotes Herz und blauer Kreis auf hellem Grund. */
export async function sampleTwoColors(): Promise<Uint8Array> {
  const { c, g } = canvas(640, 400)
  g.fillStyle = '#f6f1e6'
  g.fillRect(0, 0, 640, 400)
  g.fillStyle = '#d62f3a'
  g.beginPath()
  g.moveTo(190, 340)
  g.bezierCurveTo(40, 230, 40, 90, 140, 70)
  g.bezierCurveTo(175, 65, 190, 85, 190, 105)
  g.bezierCurveTo(190, 85, 205, 65, 240, 70)
  g.bezierCurveTo(340, 90, 340, 230, 190, 340)
  g.fill()
  g.fillStyle = '#1f4fb2'
  g.beginPath(); g.arc(470, 200, 120, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#f6f1e6'
  g.beginPath(); g.arc(470, 200, 55, 0, Math.PI * 2); g.fill()
  return bytes(c, 'image/jpeg')
}
