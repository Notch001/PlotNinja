import { describe, expect, it } from 'vitest'
import { setLanguage } from './index'
import { assertImportSize, BUILTIN_MATERIALS, findBuiltin, importDxf, importSvg, isBuiltinName, materialLabel, parseProject, renameProfile, upsertProfile, workAreaLabel } from '@core/index'
import { importPdf } from '@core/pdf'
import { DEFAULT_CUT, DEFAULT_WORK_AREAS } from '@shared/types'
import { buildDxf } from '@core/sampleDxf'
import { describeUpdateError } from '../../main/updateError'
import { usbErrorMessage, msgDeviceLost, runGpglEject, type UsbTransport } from '../../main/plotter/usbDevice'
import { SimulatorDevice } from '../../main/plotter/simulator'

/** Englische Varianten der wichtigsten Fehlermeldungen: Sprache wird zur Zeit der Erzeugung ausgewertet. */
describe('Englische Meldungen', () => {
  it('Import-Fehler (SVG, DXF, PDF, Größe)', async () => {
    setLanguage('en')
    expect(() => importSvg('', 'a.svg', 'a.svg')).toThrow(/is empty/)
    expect(() => importSvg('hello', 'a.svg', 'a.svg')).toThrow(/not a valid SVG file/)
    expect(() => importSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'e.svg', 'e')).toThrow(/no cuttable paths/)
    expect(() => importDxf('', 'x.dxf', 'x')).toThrow(/not a valid DXF/)
    expect(() => importDxf(buildDxf([]), 'x.dxf', 'x')).toThrow(/no cuttable outlines/)
    expect(() => assertImportSize(21 * 1024 * 1024, 'The file')).toThrow(/too large at 21 MB \(maximum 20 MB\)/)
    await expect(importPdf(new TextEncoder().encode('not a pdf'), 'k.pdf', 'k')).rejects.toThrow(/not a valid PDF file/)
  })

  it('Projektdatei-Fehler', () => {
    setLanguage('en')
    expect(() => parseProject('{broken')).toThrow(/not a valid PlotNinja project file/)
    expect(() => parseProject('[]')).toThrow(/not a PlotNinja project file/)
    expect(() => parseProject('{"format":"plotninja-project","version":2}')).toThrow(/newer version of PlotNinja \(file format 2, supported: 1\)/)
    expect(() => parseProject('{"format":"plotninja-project","version":1,"parts":[7]}')).toThrow(/Part 1 is damaged/)
  })

  it('Materialprofile: Fehlermeldungen und Anzeigenamen; eingebaute Namen sind in jeder Sprache geschützt', () => {
    setLanguage('en')
    expect(upsertProfile([], '  ', DEFAULT_CUT).error).toBe('Please enter a name.')
    expect(upsertProfile([], 'Cardboard', DEFAULT_CUT).error).toMatch(/built-in material/)
    expect(upsertProfile([], 'Karton', DEFAULT_CUT).error).toMatch(/built-in material/)
    expect(renameProfile([{ name: 'A', cut: DEFAULT_CUT }, { name: 'B', cut: DEFAULT_CUT }], 'A', 'b').error).toMatch(/already exists/)
    expect(BUILTIN_MATERIALS.map(materialLabel)).toEqual(['Paper 80 gsm', 'Cardboard', 'Vinyl', 'Heat transfer vinyl', 'Fabric/felt'])
    expect(isBuiltinName('Heat transfer vinyl')).toBe(true)
    expect(findBuiltin('Flexfolie')?.id).toBe('flex') // stabiler deutscher Schlüsselname
    expect(findBuiltin('flex')?.id).toBe('flex')       // stabile Id
    setLanguage('de')
    expect(materialLabel(BUILTIN_MATERIALS[3])).toBe('Flexfolie')
    expect(materialLabel({ name: 'Mein Vinyl', cut: DEFAULT_CUT })).toBe('Mein Vinyl')
  })

  it('Standard-Arbeitsflächen werden übersetzt angezeigt, eigene Namen nicht', () => {
    setLanguage('en')
    expect(workAreaLabel(DEFAULT_WORK_AREAS[2])).toBe('Cameo – 305 mm roll')
    expect(workAreaLabel('Mein Zuschnitt')).toBe('Mein Zuschnitt')
    setLanguage('de')
    expect(workAreaLabel(DEFAULT_WORK_AREAS[2])).toBe('Cameo – Rolle 305 mm')
  })

  it('Plotter-Fehler mit LIBUSB/Zadig-Hinweis und Updater-Fehler', () => {
    setLanguage('en')
    expect(usbErrorMessage(new Error('LIBUSB_ERROR_NOT_SUPPORTED'))).toMatch(/WinUSB driver.*Zadig/s)
    expect(usbErrorMessage(new Error('LIBUSB_ERROR_BUSY'))).toMatch(/another program/)
    expect(usbErrorMessage(new Error('LIBUSB_ERROR_TIMEOUT'))).toMatch(/not responding/)
    expect(usbErrorMessage(new Error('weird'))).toBe('USB error: weird')
    expect(msgDeviceLost()).toMatch(/connection to the plotter was lost/)
    expect(describeUpdateError(new Error('getaddrinfo ENOTFOUND github.com'))).toMatch(/^No connection to GitHub \(/)
    expect(describeUpdateError(new Error('HttpError: 403 rate limit'))).toMatch(/limit reached/)
    expect(describeUpdateError(new Error('something'))).toMatch(/^Update check failed/)
    setLanguage('de')
    expect(describeUpdateError(new Error('ENOTFOUND'))).toMatch(/^Keine Verbindung zu GitHub/)
  })

  it('Ausfahren ohne Material und Simulator-Name in Englisch', async () => {
    setLanguage('en')
    const noMedia: UsbTransport = {
      write: async () => undefined,
      read: async () => new Uint8Array([0x32, 0x03]) // Status "kein Medium"
    }
    const timing = { pollMs: 1, settleMs: 1, confirmReady: 1, readyTimeoutMs: 50, initDelayMs: 1 }
    await expect(runGpglEject(noMedia, 10, new AbortController().signal, timing)).rejects.toThrow(/no material in the plotter/)
    expect(new SimulatorDevice().info.name).toMatch(/Simulator \(test without a plotter\)/)
  })
})
