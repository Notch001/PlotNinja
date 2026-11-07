import { create } from 'zustand'
import type { CutSettings, DeviceInfo, DeviceStatus, Part, PersistedSettings, Point, WorkArea } from '@shared/types'
import { DEFAULT_CUT, DEFAULT_WORK_AREAS } from '@shared/types'
import {
  cleanProfileName, deleteProfile, duplicateParts, expandToGroups, flipParts, groupParts, normalizeGroups, partScale, partSize,
  renameProfile, scalePartBy, splitPart, ungroupParts, upsertProfile, weldPart, withScale
} from './core'
import { normDeg, partCenter, rotateParts, scaleParts, translateParts, unionBounds, withCenter, type Box } from './lib/transform'

export interface Toast { id: number; kind: 'info' | 'success' | 'error' | 'warn'; text: string }
export interface Busy { label: string; done: number; total: number }
export interface View { zoom: number; panX: number; panY: number }

export type DialogState =
  | { type: 'confirm'; title: string; message: string; confirmLabel: string; danger?: boolean; resolve: (ok: boolean) => void }
  | { type: 'prompt'; title: string; label: string; initial: string; confirmLabel: string; resolve: (v: string | null) => void }
  | { type: 'unsaved'; title: string; message: string; resolve: (choice: 'save' | 'discard' | 'cancel') => void }

/** Aktuelles Projekt: Pfad (null = noch nie gespeichert), Anzeigename und ungespeicherte Änderungen. */
export interface ProjectInfo { path: string | null; name: string; dirty: boolean }

interface State {
  // Dokument
  parts: Part[]
  selection: string[]
  /** Gruppe, in der gerade einzelne Mitglieder bearbeitet werden (Doppelklick), sonst null. */
  memberGroup: string | null
  past: Part[][]
  future: Part[][]
  // Ansicht
  view: View
  viewport: { w: number; h: number }
  cursor: Point | null
  showGrid: boolean
  snapEnabled: boolean
  alignTarget: 'selection' | 'workarea'
  leftWidth: number
  autoFit: boolean
  // Einstellungen
  settings: PersistedSettings
  settingsLoaded: boolean
  // Geräte
  devices: DeviceInfo[]
  devicesLoading: boolean
  selectedDeviceId: string | null
  connectedId: string | null
  deviceStatus: DeviceStatus
  // UI
  toasts: Toast[]
  busy: Busy | null
  dialog: DialogState | null
  project: ProjectInfo
  cutOpen: boolean
  /** Dialog „Text einfügen“ offen? */
  textOpen: boolean
  /** Seitenverhältnis beim Skalieren sperren (Standard: ja). Entsperrt: Breite und Höhe unabhängig. */
  lockAspect: boolean
  /** 'test' = Testschnitt (kleines Muster statt Projekt) im Schneiden-Dialog */
  cutMode: 'project' | 'test'

  init(): () => void
  toast(kind: Toast['kind'], text: string): void
  dismissToast(id: number): void
  setBusy(b: Busy | null): void
  askConfirm(title: string, message: string, confirmLabel?: string, danger?: boolean): Promise<boolean>
  askText(title: string, label: string, initial?: string, confirmLabel?: string): Promise<string | null>
  closeDialog(): void
  askUnsaved(title: string, message: string): Promise<'save' | 'discard' | 'cancel'>
  setProject(patch: Partial<ProjectInfo>): void

  // Teile
  snapshot(): void
  setPartsLive(updater: (parts: Part[]) => Part[]): void
  addParts(parts: Part[], select?: boolean): void
  replaceParts(updated: Part[]): void
  /** Wählt Teile; berührte Gruppen werden komplett gewählt (beendet den Einzelteil-Modus). */
  select(ids: string[]): void
  /** Wählt nur diese Teile einer Gruppe (Einzelteil-Modus für `groupId`). */
  selectMembers(ids: string[], groupId: string): void
  groupSelected(): void
  ungroupSelected(): void
  selectAll(): void
  deleteSelected(): void
  duplicateSelected(): void
  splitSelected(): void
  weldSelected(): void
  clearAll(): void
  undo(): void
  redo(): void
  nudge(dx: number, dy: number): void
  moveSelectionTo(x?: number, y?: number): void
  resizeSelection(dim: 'width' | 'height', value: number): void
  setSelectedRotation(deg: number): void
  setSelectedScalePct(pct: number): void
  /** Maßstab nur in einer Achse (Breite/Höhe) setzen; nur für genau ein Bauteil (freies Skalieren). */
  setSelectedScaleAxisPct(axis: 'x' | 'y', pct: number): void
  /** Auswahl (Teil oder Gruppe) an ihrer Mitte spiegeln: 'h' = links/rechts, 'v' = oben/unten. */
  flipSelection(axis: 'h' | 'v'): void
  setLockAspect(lock: boolean): void
  setTextOpen(open: boolean): void
  rotateSelectionBy(deg: number): void
  centerAll(): void

  // Ansicht
  setView(v: View): void
  setViewport(w: number, h: number): void
  fit(): void
  setCursor(p: Point | null): void
  toggleGrid(): void
  toggleSnap(): void
  setAlignTarget(t: 'selection' | 'workarea'): void
  setLeftWidth(w: number): void

  // Einstellungen
  patchSettings(patch: Partial<PersistedSettings>): void
  setWorkArea(w: WorkArea): void
  setCut(patch: Partial<CutSettings>): void
  saveWorkAreaPreset(name: string): void
  deleteWorkAreaPreset(name: string): void
  /** Eigene Materialprofile: speichern (Name per Dialog), umbenennen, löschen. */
  saveMaterialProfile(): Promise<void>
  renameMaterialProfile(name: string): Promise<void>
  deleteMaterialProfile(name: string): Promise<void>
  addRootFolder(path: string): void
  removeRootFolder(path: string): void

  // Geräte
  refreshDevices(): Promise<void>
  selectDevice(id: string): void
  connect(): Promise<void>
  disconnect(): Promise<void>
  setCutOpen(open: boolean): void
  openTestCut(): void
}

let toastSeq = 1
let saveTimer: ReturnType<typeof setTimeout> | null = null
let lastNudge = 0
/** true, solange die App selbst trennt (dann kein "Verbindung verloren"-Hinweis) */
let expectDisconnect = false

function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch { return fallback }
}
export function lsSet(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignorieren */ }
}

const defaultSettings = (): PersistedSettings => ({
  workAreas: DEFAULT_WORK_AREAS.map((w) => ({ ...w })),
  activeWorkArea: { ...DEFAULT_WORK_AREAS[0] },
  cut: { ...DEFAULT_CUT },
  rootFolders: [],
  weldOnImport: true
})

export const useStore = create<State>((set, get) => {
  const selected = (): Part[] => {
    const { parts, selection } = get()
    const ids = new Set(selection)
    return parts.filter((p) => ids.has(p.id))
  }
  const applyToSelection = (fn: (sel: Part[]) => Part[]): void => {
    const sel = selected()
    if (!sel.length) return
    get().snapshot()
    const updated = new Map(fn(sel).map((p) => [p.id, p]))
    set((s) => ({ parts: s.parts.map((p) => updated.get(p.id) ?? p) }))
  }

  return {
    parts: [],
    selection: [],
    memberGroup: null,
    past: [],
    future: [],
    view: { zoom: 1, panX: 40, panY: 40 },
    viewport: { w: 0, h: 0 },
    cursor: null,
    showGrid: lsGet('pn.grid', true),
    snapEnabled: lsGet('pn.snap', true),
    alignTarget: 'selection',
    autoFit: true,
    leftWidth: Math.min(480, Math.max(200, lsGet('pn.leftWidth', 280))),
    settings: defaultSettings(),
    settingsLoaded: false,
    devices: [],
    devicesLoading: false,
    selectedDeviceId: null,
    connectedId: null,
    deviceStatus: 'disconnected',
    toasts: [],
    busy: null,
    dialog: null,
    project: { path: null, name: 'Unbenannt', dirty: false },
    cutOpen: false,
    textOpen: false,
    lockAspect: true,
    cutMode: 'project',

    init() {
      const unsub = window.api.onDeviceStatus((st) => {
        const prev = get()
        if (prev.connectedId) {
          if (st === 'disconnected' && !expectDisconnect) get().toast('error', 'Die Verbindung zum Plotter ist verloren gegangen. Prüfe USB-Kabel und Stromversorgung und verbinde ihn im Panel „Plotter“ erneut.')
          else if (st === 'no-media' && prev.deviceStatus !== 'no-media') get().toast('warn', 'Kein Medium erkannt. Matte einlegen und am Plotter die Lade-Taste drücken.')
          else if (st === 'error' && prev.deviceStatus !== 'error') get().toast('error', 'Der Plotter meldet einen Fehler oder antwortet nicht. Prüfe Kabel, Strom und ob er bereit ist.')
        }
        set((s) => ({ deviceStatus: st, connectedId: st === 'disconnected' ? null : s.connectedId }))
        if (st === 'disconnected') void get().refreshDevices()
      })
      window.api.loadSettings().then((st) => {
        const merged = { ...defaultSettings(), ...st }
        set({ settings: merged, settingsLoaded: true })
        get().fit()
      }).catch((e) => {
        set({ settingsLoaded: true })
        get().toast('error', 'Einstellungen konnten nicht geladen werden: ' + String(e?.message ?? e))
      })
      void get().refreshDevices()
      return unsub
    },

    toast(kind, text) {
      const id = toastSeq++
      set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, text }] }))
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 4000)
    },
    dismissToast(id) { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })) },
    setBusy(b) { set({ busy: b }) },
    askConfirm(title, message, confirmLabel = 'OK', danger = false) {
      return new Promise<boolean>((resolve) => set({ dialog: { type: 'confirm', title, message, confirmLabel, danger, resolve } }))
    },
    askText(title, label, initial = '', confirmLabel = 'Speichern') {
      return new Promise<string | null>((resolve) => set({ dialog: { type: 'prompt', title, label, initial, confirmLabel, resolve } }))
    },
    closeDialog() { set({ dialog: null }) },
    askUnsaved(title, message) {
      return new Promise<'save' | 'discard' | 'cancel'>((resolve) => set({ dialog: { type: 'unsaved', title, message, resolve } }))
    },
    setProject(patch) { set((s) => ({ project: { ...s.project, ...patch } })) },

    snapshot() {
      set((s) => ({ past: [...s.past.slice(-99), s.parts], future: [] }))
    },
    setPartsLive(updater) { set((s) => ({ parts: updater(s.parts) })) },
    addParts(parts, sel = true) {
      if (!parts.length) return
      get().snapshot()
      set((s) => ({ parts: [...s.parts, ...parts], selection: sel ? parts.map((p) => p.id) : s.selection }))
    },
    replaceParts(updated) {
      if (!updated.length) return
      get().snapshot()
      const m = new Map(updated.map((p) => [p.id, p]))
      set((s) => ({ parts: s.parts.map((p) => m.get(p.id) ?? p) }))
    },
    select(ids) { set((s) => ({ selection: expandToGroups(s.parts, ids), memberGroup: null })) },
    selectMembers(ids, groupId) { set({ selection: ids, memberGroup: groupId }) },
    selectAll() { set((s) => ({ selection: s.parts.map((p) => p.id), memberGroup: null })) },
    groupSelected() {
      const sel = selected()
      const gids = new Set(sel.map((p) => p.groupId ?? ''))
      if (sel.length < 2) { get().toast('info', 'Zum Gruppieren mindestens zwei Teile wählen'); return }
      if (gids.size === 1 && !gids.has('')) { get().toast('info', 'Diese Teile sind bereits gruppiert'); return }
      get().snapshot()
      const next = groupParts(get().parts, sel.map((p) => p.id))
      set({ parts: next, selection: expandToGroups(next, sel.map((p) => p.id)), memberGroup: null })
      get().toast('success', `${sel.length} Teile gruppiert – sie lassen sich nun gemeinsam bewegen, skalieren und anordnen`)
    },
    ungroupSelected() {
      const sel = selected()
      if (!sel.some((p) => p.groupId)) { get().toast('info', 'Die Auswahl enthält keine Gruppe'); return }
      get().snapshot()
      const ids = sel.map((p) => p.id)
      set((s) => ({ parts: ungroupParts(s.parts, ids), selection: expandToGroups(s.parts, ids), memberGroup: null }))
      get().toast('success', 'Gruppierung aufgehoben')
    },
    deleteSelected() {
      const { selection } = get()
      if (!selection.length) return
      get().snapshot()
      const ids = new Set(selection)
      set((s) => ({ parts: normalizeGroups(s.parts.filter((p) => !ids.has(p.id))), selection: [], memberGroup: null }))
    },
    duplicateSelected() {
      const sel = selected()
      if (!sel.length) return
      get().snapshot()
      const copies = duplicateParts(sel, 8, 8) // Gruppen: Kopien bekommen eine eigene neue groupId
      set((s) => ({ parts: [...s.parts, ...copies], selection: copies.map((c) => c.id), memberGroup: null }))
    },
    splitSelected() {
      const sel = selected()
      if (sel.length !== 1) return
      const orig = sel[0]
      if (orig.groupId) { get().toast('info', 'Das Teil gehört zu einer Gruppe – zuerst die Gruppierung aufheben (Strg+Umschalt+G)'); return }
      const pieces = splitPart(orig)
      if (pieces.length < 2) { get().toast('info', `„${orig.name}“ besteht nur aus einem zusammenhängenden Stück und lässt sich nicht weiter zerlegen`); return }
      get().snapshot() // ein einziger Undo-Schritt: Original weg, Einzelteile da
      set((s) => ({ parts: s.parts.flatMap((p) => (p.id === orig.id ? pieces : [p])), selection: pieces.map((p) => p.id), memberGroup: null }))
      get().toast('success', `In ${pieces.length} Einzelteile zerlegt – mit Strg+G wieder gruppieren`)
    },
    weldSelected() {
      const sel = selected()
      if (sel.length !== 1) return
      const orig = sel[0]
      const welded = weldPart(orig)
      const count = (p: Part): number => p.paths.length
      if (welded === orig || count(welded) === count(orig)) {
        get().toast('info', `„${orig.name}“ enthält keine überlappenden Konturen`)
        return
      }
      get().snapshot() // ein Undo-Schritt
      set((s) => ({ parts: s.parts.map((p) => (p.id === orig.id ? welded : p)) }))
      get().toast('success', `Konturen vereint: ${count(orig)} → ${count(welded)}`)
    },
    clearAll() {
      if (!get().parts.length) return
      get().snapshot()
      set({ parts: [], selection: [], memberGroup: null })
    },
    undo() {
      const { past, parts, future } = get()
      if (!past.length) return
      const prev = past[past.length - 1]
      const ids = new Set(prev.map((p) => p.id))
      set((s) => ({ past: past.slice(0, -1), future: [parts, ...future].slice(0, 100), parts: prev, selection: s.selection.filter((i) => ids.has(i)), memberGroup: null }))
    },
    redo() {
      const { past, parts, future } = get()
      if (!future.length) return
      const next = future[0]
      const ids = new Set(next.map((p) => p.id))
      set((s) => ({ future: future.slice(1), past: [...past, parts], parts: next, selection: s.selection.filter((i) => ids.has(i)), memberGroup: null }))
    },
    nudge(dx, dy) {
      const sel = selected()
      if (!sel.length) return
      const now = Date.now()
      if (now - lastNudge > 700) get().snapshot()
      lastNudge = now
      const ids = new Set(get().selection)
      set((s) => ({ parts: s.parts.map((p) => (ids.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p)) }))
    },
    moveSelectionTo(x, y) {
      const b = unionBounds(selected())
      if (!b) return
      const dx = x === undefined ? 0 : x - b.x
      const dy = y === undefined ? 0 : y - b.y
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return
      applyToSelection((sel) => translateParts(sel, dx, dy))
    },
    resizeSelection(dim, value) {
      const sel = selected()
      const b = unionBounds(sel)
      if (!b || !(value > 0)) return
      if (sel.length === 1) {
        // Ein Teil: Breite/Höhe sind die Maße im Teilsystem (vor der Drehung); sie stimmen bei 0° mit der Bounding-Box überein.
        const p = sel[0]
        const size = partSize(p)
        const cur = dim === 'width' ? size.w : size.h
        const f = value / cur
        if (!isFinite(f) || Math.abs(f - 1) < 1e-9) return
        const sc = partScale(p)
        let next: Part
        if (get().lockAspect) next = scalePartBy(p, f)
        else next = dim === 'width' ? withScale(p, sc.x * f, sc.y) : withScale(p, sc.x, sc.y * f)
        // Obere linke Ecke der Bounding-Box bleibt stehen (wie beim proportionalen Skalieren um diese Ecke)
        next = withCenter(next, partCenter(p))
        const nb = unionBounds([next]) as Box
        applyToSelection(() => translateParts([next], b.x - nb.x, b.y - nb.y))
        return
      }
      const f = value / (dim === 'width' ? b.width : b.height)
      if (!isFinite(f) || Math.abs(f - 1) < 1e-9) return
      applyToSelection((s2) => scaleParts(s2, { x: b.x, y: b.y }, f))
    },
    setSelectedRotation(deg) {
      applyToSelection((sel) => sel.map((p) => ({ ...p, rotation: normDeg(deg) })))
    },
    setSelectedScalePct(pct) {
      if (!(pct > 0)) return
      // Einheitlicher Prozentwert (Breite): das Seitenverhältnis des Teils bleibt erhalten
      applyToSelection((sel) => sel.map((p) => withCenter(scalePartBy(p, pct / 100 / partScale(p).x), partCenter(p))))
    },
    setSelectedScaleAxisPct(axis, pct) {
      if (!(pct > 0)) return
      const sel = selected()
      if (sel.length !== 1) return
      applyToSelection((s2) => s2.map((p) => {
        const sc = partScale(p)
        return withCenter(axis === 'x' ? withScale(p, pct / 100, sc.y) : withScale(p, sc.x, pct / 100), partCenter(p))
      }))
    },
    flipSelection(axis) {
      const sel = selected()
      if (!sel.length) return
      applyToSelection((s2) => flipParts(s2, axis))
    },
    setLockAspect(lock) { set({ lockAspect: lock }) },
    setTextOpen(open) { set({ textOpen: open }) },
    rotateSelectionBy(deg) {
      const b = unionBounds(selected())
      if (!b) return
      applyToSelection((sel) => rotateParts(sel, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, deg))
    },
    centerAll() {
      const { parts, settings } = get()
      const b = unionBounds(parts)
      if (!b) return
      const dx = settings.activeWorkArea.width / 2 - (b.x + b.width / 2)
      const dy = settings.activeWorkArea.height / 2 - (b.y + b.height / 2)
      get().snapshot()
      set((s) => ({ parts: translateParts(s.parts, dx, dy) }))
    },

    setView(v) { set({ view: v, autoFit: false }) },
    setViewport(w, h) { set({ viewport: { w, h } }) },
    fit() {
      const { viewport, settings } = get()
      if (viewport.w < 50 || viewport.h < 50) return
      const wa = settings.activeWorkArea
      const pad = 24
      const availW = viewport.w - 22 - pad * 2
      const availH = viewport.h - 22 - pad * 2
      const zoom = Math.max(0.2, Math.min(availW / (wa.width + 20), availH / (wa.height + 20), 30))
      const panX = 22 + (viewport.w - 22 - wa.width * zoom) / 2
      const panY = 22 + (viewport.h - 22 - wa.height * zoom) / 2
      set({ view: { zoom, panX, panY }, autoFit: true })
    },
    setCursor(p) { set({ cursor: p }) },
    toggleGrid() { const v = !get().showGrid; lsSet('pn.grid', v); set({ showGrid: v }) },
    toggleSnap() { const v = !get().snapEnabled; lsSet('pn.snap', v); set({ snapEnabled: v }) },
    setAlignTarget(t) { set({ alignTarget: t }) },
    setLeftWidth(w) { const v = Math.min(480, Math.max(200, Math.round(w))); lsSet('pn.leftWidth', v); set({ leftWidth: v }) },

    patchSettings(patch) {
      const next = { ...get().settings, ...patch }
      set({ settings: next })
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        window.api.saveSettings(get().settings).catch((e) => get().toast('error', 'Einstellungen konnten nicht gespeichert werden: ' + String(e?.message ?? e)))
      }, 300)
    },
    setWorkArea(w) {
      const prev = get().settings.activeWorkArea
      get().patchSettings({ activeWorkArea: { name: w.name, width: Math.round(w.width), height: Math.round(w.height) } })
      if (prev.width !== w.width || prev.height !== w.height) setTimeout(() => get().fit(), 0)
    },
    setCut(patch) { get().patchSettings({ cut: { ...get().settings.cut, ...patch } }) },
    saveWorkAreaPreset(name) {
      const { settings } = get()
      const wa = { name, width: settings.activeWorkArea.width, height: settings.activeWorkArea.height }
      const list = settings.workAreas.filter((w) => w.name !== name)
      get().patchSettings({ workAreas: [...list, wa], activeWorkArea: wa })
      get().toast('success', `Vorlage „${name}“ gespeichert`)
    },
    deleteWorkAreaPreset(name) {
      const { settings } = get()
      get().patchSettings({ workAreas: settings.workAreas.filter((w) => w.name !== name) })
      get().toast('info', `Vorlage „${name}“ gelöscht`)
    },
    async saveMaterialProfile() {
      const st = get()
      const name = await st.askText('Als Materialprofil speichern', 'Name des Profils (z. B. „Vinyl glänzend“)', '', 'Speichern')
      if (name === null) return
      const list = get().settings.materialProfiles ?? []
      const clean = cleanProfileName(name)
      if (clean && list.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
        const ok = await get().askConfirm('Profil überschreiben?', `Das Profil „${clean}“ gibt es bereits. Es wird mit den aktuellen Werten überschrieben.`, 'Überschreiben')
        if (!ok) return
      }
      const r = upsertProfile(list, name, get().settings.cut)
      if (r.error) { get().toast('error', r.error); return }
      get().patchSettings({ materialProfiles: r.list })
      get().toast('success', `Profil „${cleanProfileName(name)}“ ${r.replaced ? 'aktualisiert' : 'gespeichert'}`)
    },
    async renameMaterialProfile(name) {
      const nn = await get().askText('Profil umbenennen', 'Neuer Name', name, 'Umbenennen')
      if (nn === null) return
      const r = renameProfile(get().settings.materialProfiles ?? [], name, nn)
      if (r.error) { get().toast('error', r.error); return }
      get().patchSettings({ materialProfiles: r.list })
    },
    async deleteMaterialProfile(name) {
      const ok = await get().askConfirm('Profil löschen?', `Das Materialprofil „${name}“ wird gelöscht.`, 'Löschen', true)
      if (!ok) return
      get().patchSettings({ materialProfiles: deleteProfile(get().settings.materialProfiles ?? [], name) })
      get().toast('info', `Profil „${name}“ gelöscht`)
    },
    addRootFolder(path) {
      const { settings } = get()
      if (settings.rootFolders.includes(path)) { get().toast('info', 'Dieser Ordner ist bereits vorhanden'); return }
      get().patchSettings({ rootFolders: [...settings.rootFolders, path], lastFolder: path })
    },
    removeRootFolder(path) {
      get().patchSettings({ rootFolders: get().settings.rootFolders.filter((p) => p !== path) })
    },

    async refreshDevices() {
      set({ devicesLoading: true })
      try {
        const devices = await window.api.listDevices()
        set((s) => ({
          devices,
          selectedDeviceId: devices.some((d) => d.id === s.selectedDeviceId) ? s.selectedDeviceId : (devices.find((d) => d.kind === 'usb') ?? devices[0])?.id ?? null
        }))
      } catch (e) {
        get().toast('error', 'Geräte konnten nicht gesucht werden: ' + String((e as Error)?.message ?? e))
      } finally { set({ devicesLoading: false }) }
    },
    selectDevice(id) { set({ selectedDeviceId: id }) },
    async connect() {
      const id = get().selectedDeviceId
      if (!id) return
      try {
        const r = await window.api.connect(id)
        if (r.ok) {
          set({ connectedId: id })
          if (get().deviceStatus === 'disconnected') set({ deviceStatus: 'ready' })
          get().toast('success', 'Verbunden mit ' + (get().devices.find((d) => d.id === id)?.name ?? id))
        } else get().toast('error', 'Verbindung fehlgeschlagen: ' + (r.error ?? 'unbekannter Fehler'))
      } catch (e) {
        get().toast('error', 'Verbindung fehlgeschlagen: ' + String((e as Error)?.message ?? e))
      }
    },
    async disconnect() {
      expectDisconnect = true
      try { await window.api.disconnect() } catch { /* ignorieren */ }
      expectDisconnect = false
      set({ connectedId: null, deviceStatus: 'disconnected' })
    },
    setCutOpen(open) { set({ cutOpen: open, cutMode: 'project' }) },
    openTestCut() { set({ cutOpen: true, cutMode: 'test' }) }
  }
})

export function selectedParts(parts: Part[], selection: string[]): Part[] {
  const ids = new Set(selection)
  return parts.filter((p) => ids.has(p.id))
}

