/**
 * Baut ein minimales, gültiges PDF (eine oder mehrere Seiten, nur Inhaltsstrom, optional eine Standardschrift)
 * für Tests und die Browser-Demo. Maße in PDF-Punkten (1 pt = 0,3528 mm), Ursprung unten links.
 */
export interface SamplePdfPage { width: number; height: number; content: string }

export function buildPdf(pages: SamplePdfPage[], opts: { withFont?: boolean } = {}): Uint8Array {
  const objs: string[] = []
  // 1 Katalog, 2 Seitenbaum, 3 Schrift, danach je Seite: Seite + Inhalt
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  pages.forEach((p, i) => {
    const pageNo = 4 + i * 2, contentNo = pageNo + 1
    objs[pageNo] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.width} ${p.height}] /Contents ${contentNo} 0 R /Resources << ${opts.withFont ? '/Font << /F1 3 0 R >>' : ''} >> >>`
    objs[contentNo] = `<< /Length ${p.content.length} >>\nstream\n${p.content}\nendstream`
  })
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const bytes = new Uint8Array(out.length)
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
  return bytes
}

/** Demo-PDF (A6 quer, 297 × 210 pt): gefüllter Stern-Umriss aus zwei überlappenden Rechtecken, Kreis (Bézier), Linie, weißer Seitenhintergrund. */
export function sampleLogoPdf(): Uint8Array {
  const k = 0.5523
  const cx = 220, cy = 105, r = 50
  const circle = [
    `${cx + r} ${cy} m`,
    `${cx + r} ${cy + r * k} ${cx + r * k} ${cy + r} ${cx} ${cy + r} c`,
    `${cx - r * k} ${cy + r} ${cx - r} ${cy + r * k} ${cx - r} ${cy} c`,
    `${cx - r} ${cy - r * k} ${cx - r * k} ${cy - r} ${cx} ${cy - r} c`,
    `${cx + r * k} ${cy - r} ${cx + r} ${cy - r * k} ${cx + r} ${cy} c`, 'h'
  ].join('\n')
  const content = [
    '1 1 1 rg 0 0 297 210 re f', // weißer Hintergrund (wird ignoriert)
    '0 g 30 60 100 80 re f', '0 g 80 100 100 70 re f', // zwei überlappende, gefüllte Rechtecke
    `${circle} S`,
    '30 20 m 270 20 l S'
  ].join('\n')
  return buildPdf([{ width: 297, height: 210, content }])
}
