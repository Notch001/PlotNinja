import { create } from 'zustand'
import type { Point } from '@shared/types'

/** Ein Bild, das im Dialog „Bild nachzeichnen“ geöffnet werden soll. */
export interface TraceJob {
  id: number
  name: string
  path: string
  /** Dateigröße in Bytes, falls vorher bekannt (OS-Drop). */
  size?: number
  /** Liefert den Dateiinhalt (Bytes). */
  read: () => Promise<Uint8Array>
  /** Ablageort (mm) bei Drag & Drop auf die Matte, sonst freie Stelle. */
  drop?: Point
}

interface TraceState {
  /** Wartende Bilder; das erste ist im Dialog geöffnet. */
  queue: TraceJob[]
  push(jobs: Omit<TraceJob, 'id'>[]): void
  /** Aktuelles Bild abschließen (übernommen oder abgebrochen). */
  next(): void
  /** Alle wartenden Bilder verwerfen. */
  clear(): void
}

let seq = 1
export const useTraceStore = create<TraceState>((set) => ({
  queue: [],
  push(jobs) { set((s) => ({ queue: [...s.queue, ...jobs.map((j) => ({ ...j, id: seq++ }))] })) },
  next() { set((s) => ({ queue: s.queue.slice(1) })) },
  clear() { set({ queue: [] }) }
}))
