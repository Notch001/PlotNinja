/**
 * Geräteprotokoll (plotter.log im Datenordner der App, wie update.log). Das Modul selbst ist frei von Electron,
 * damit es in Tests nutzbar ist; der Hauptprozess setzt per `setPlotterLogger` die Datei-Ausgabe.
 */
type Sink = (line: string) => void

let sink: Sink | null = null

export function setPlotterLogger(fn: Sink | null): void {
  sink = fn
}

export function plotterLog(line: string): void {
  try { sink?.(`${new Date().toISOString()} ${line}`) } catch { /* Log ist nur Zusatz */ }
}

/** Roh-Fehler (inkl. libusb-errno) als eine Logzeile. */
export function describeRawError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const errno = (e as { errno?: number } | null)?.errno
  return errno !== undefined ? `${msg} (errno ${errno})` : msg
}
