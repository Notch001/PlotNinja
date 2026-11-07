import type { Part, Polyline } from '@shared/types'
import { PathBuilder } from './pathdata'
import { applyM, mul, pathsBox, type Matrix } from './geom'
import { finishVectorImport, type VectorImportOptions } from './importCommon'

/** 1 PDF-Punkt (1/72 Zoll) in Millimetern. */
export const MM_PER_PT = 25.4 / 72
/** Dateien über dieser Größe werden nicht gelesen (Schutz vor Speicherproblemen). */
const MAX_PDF_BYTES = 100 * 1024 * 1024
/** Obergrenze für Pfadoperationen einer Seite (Schutz vor extrem komplexen Seiten). */
const MAX_PATH_OPS = 2_000_000

export interface PdfImportOptions extends VectorImportOptions {
  /** Seite (ab 1), Standard 1. */
  page?: number
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjsPromise: Promise<PdfJs> | null = null
let workerSrc: string | null = null

/** Setzt die URL des pdf.js-Workers (Renderer: per Vite `?url`-Import; in Node-Tests nicht nötig). */
export function setPdfWorkerSrc(url: string): void {
  workerSrc = url
  void pdfjsPromise?.then((m) => { m.GlobalWorkerOptions.workerSrc = url })
}

function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
      if (workerSrc) m.GlobalWorkerOptions.workerSrc = workerSrc
      return m
    })
  }
  return pdfjsPromise
}

const TEXT_OPS = new Set([44, 45, 46, 47])
const IMAGE_OPS = new Set([83, 84, 85, 86, 87, 88, 89, 90])

/**
 * Liest die Vektorpfade einer PDF-Seite (Standard: Seite 1) als Bauteil. Farben, Text und Bilder werden nicht
 * beachtet; Füll- und Strichpfade werden gleich behandelt (gefüllt = geschlossen und für Weld geeignet,
 * nur gestrichelt/gestrichen = offen bleibt unverändert). Ein seitenfüllendes Hintergrundrechteck wird ignoriert.
 */
export async function importPdf(data: Uint8Array, fileName: string, sourcePath: string, opts?: PdfImportOptions): Promise<Part[]> {
  if (data.byteLength > MAX_PDF_BYTES) throw new Error('Die PDF-Datei ist zu groß (über 100 MB).')
  const pdfjs = await loadPdfJs()
  const OPS = pdfjs.OPS as Record<string, number>
  let doc
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(data), // Kopie: pdf.js reicht den Puffer an den Worker weiter
      isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0
    }).promise
  } catch (e) {
    const name = (e as { name?: string })?.name
    if (name === 'PasswordException') throw new Error('Die PDF-Datei ist passwortgeschützt.')
    throw new Error('Die Datei ist keine gültige PDF-Datei' + (e instanceof Error && e.message ? ` (${e.message})` : '') + '.')
  }
  try {
    const pageNo = Math.min(Math.max(1, Math.round(opts?.page ?? 1)), doc.numPages)
    if (doc.numPages > 1) opts?.onNotice?.(`„${fileName}“ hat ${doc.numPages} Seiten – importiert wird Seite ${pageNo}`)
    const page = await doc.getPage(pageNo)
    const viewport = page.getViewport({ scale: 1 })
    const vp = viewport.transform as Matrix // PDF-Punkte -> y-nach-unten (berücksichtigt /Rotate)
    const pageW = viewport.width, pageH = viewport.height
    const list = await page.getOperatorList()

    const scaleMm: Matrix = [MM_PER_PT, 0, 0, MM_PER_PT, 0, 0]
    let ctm: Matrix = [1, 0, 0, 1, 0, 0]
    const stack: Matrix[] = []
    let pending: { ops: number[]; coords: number[]; m: Matrix } | null = null
    const out: Polyline[] = []
    let src = 0
    let texts = 0, images = 0, ops = 0, background = false

    const fillOps = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])
    const evenOddOps = new Set([OPS.eoFill, OPS.eoFillStroke, OPS.closeEOFillStroke])
    const closeOps = new Set([OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])
    const strokeOnly = new Set([OPS.stroke, OPS.closeStroke])

    const paint = (fn: number): void => {
      if (!pending) return
      const { ops: pops, coords, m } = pending
      pending = null
      const full = mul(scaleMm, mul(vp, m))
      const b = new PathBuilder(full)
      let ci = 0
      for (const op of pops) {
        if (op === OPS.moveTo) { b.moveTo(coords[ci], coords[ci + 1]); ci += 2 }
        else if (op === OPS.lineTo) { b.lineTo(coords[ci], coords[ci + 1]); ci += 2 }
        else if (op === OPS.curveTo) { b.cubicTo(coords[ci], coords[ci + 1], coords[ci + 2], coords[ci + 3], coords[ci + 4], coords[ci + 5]); ci += 6 }
        else if (op === OPS.curveTo2) { const c = b.current; b.cubicTo(c.x, c.y, coords[ci], coords[ci + 1], coords[ci + 2], coords[ci + 3]); ci += 4 }
        else if (op === OPS.curveTo3) { b.cubicTo(coords[ci], coords[ci + 1], coords[ci + 2], coords[ci + 3], coords[ci + 2], coords[ci + 3]); ci += 4 }
        else if (op === OPS.closePath) b.close()
        else if (op === OPS.rectangle) {
          const [x, y, w, h] = [coords[ci], coords[ci + 1], coords[ci + 2], coords[ci + 3]]
          b.moveTo(x, y); b.lineTo(x + w, y); b.lineTo(x + w, y + h); b.lineTo(x, y + h); b.close(); ci += 4
        }
      }
      if (closeOps.has(fn)) b.close()
      const filled = !strokeOnly.has(fn) && fillOps.has(fn)
      const id = src++
      for (const pl of b.finish()) {
        if (pl.points.length < 2 || !pl.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) continue
        if (filled) {
          if (pl.points.length < 3) { out.push({ points: pl.points, closed: false, filled: false, src: id }); continue }
          // Seitenfüllendes Rechteck = Hintergrund
          const bx = pathsBox([pl])
          if (bx && pl.points.length <= 5 && bx.width >= pageW * MM_PER_PT * 0.98 && bx.height >= pageH * MM_PER_PT * 0.98) { background = true; continue }
          out.push({ points: pl.points, closed: true, filled: true, evenOdd: evenOddOps.has(fn), src: id })
        } else {
          out.push({ points: pl.points, closed: pl.closed, filled: false, src: id })
        }
      }
    }

    for (let i = 0; i < list.fnArray.length; i++) {
      const fn = list.fnArray[i]
      const args = list.argsArray[i] as any
      if (fn === OPS.save || fn === OPS.beginGroup) stack.push(ctm)
      else if (fn === OPS.restore || fn === OPS.endGroup) { const m = stack.pop(); if (m) ctm = m }
      else if (fn === OPS.transform) ctm = mul(ctm, args as Matrix)
      else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args?.[0])) ctm = mul(ctm, args[0] as Matrix) }
      else if (fn === OPS.paintFormXObjectEnd) { const m = stack.pop(); if (m) ctm = m }
      else if (fn === OPS.constructPath) {
        ops += (args[0] as number[]).length
        if (ops > MAX_PATH_OPS) throw new Error('Die PDF-Seite ist zu komplex (zu viele Pfadelemente).')
        pending = { ops: args[0] as number[], coords: args[1] as number[], m: ctm }
      } else if (fn === OPS.endPath || fn === OPS.clip || fn === OPS.eoClip) {
        if (fn === OPS.endPath) pending = null // Clip-Pfade und verworfene Pfade werden nicht geschnitten
      } else if (fn === OPS.stroke || fn === OPS.closeStroke || fillOps.has(fn) ) paint(fn)
      else if (TEXT_OPS.has(fn)) texts++
      else if (IMAGE_OPS.has(fn)) images++
    }

    if (opts?.onNotice) {
      if (texts || images) opts.onNotice(`„${fileName}“: PDF enthält Text oder Bilder, die nicht geschnitten werden können (Text vorher in Pfade umwandeln)`)
      if (background) opts.onNotice(`„${fileName}“: das seitenfüllende Hintergrundrechteck wurde ignoriert`)
    }
    const empty = texts || images
      ? 'Die PDF-Seite enthält nur Text oder Bilder, aber keine schneidbaren Vektorpfade (Text vorher in Pfade/Konturen umwandeln).'
      : 'Die PDF-Seite enthält keine Vektorpfade.'
    return finishVectorImport(out, fileName, sourcePath, { split: opts?.split, weld: opts?.weld ?? true }, empty)
  } finally {
    void doc.destroy()
  }
}
