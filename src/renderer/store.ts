import { create } from 'zustand'
import type { AfterCutSettings, BorderSettings, CutSettings, NestSettings, DeviceInfo, DeviceStatus, Part, PersistedSettings, Point, WorkArea } from '@shared/types'
import { DEFAULT_AFTER_CUT, DEFAULT_BORDER, DEFAULT_CUT, DEFAULT_NEST, MAX_EJECT_MM, DEFAULT_WORK_AREAS } from '@shared/types'
import {
  addBorderToParts, findBuiltin, borderOptionsFrom, cleanProfileName, deleteProfile, isModified, updateProfile, resolveActiveProfile, type ActiveProfileRef, duplicateParts, expandToGroups, flipParts, groupParts, normalizeGroups, partScale, partSize,
  removeBorderFromParts, renameProfile, sanitizeBorder, sanitizeNest, scalePartBy, splitPart, ungroupParts, upsertProfile, weldPart, withScale
} from './core'
import { LANGUAGES, onLanguageChange, t, tIn, type LanguagePref } from '@shared/i18n'
import { applyLanguagePref } from './lib/language'
import { normDeg, partCenter, rotateParts, scaleParts, translateParts, unionBounds, withCenter, type Box } from './lib/transform'

export interface Toast { id: number; kind: 'info' | 'success' | 'error' | 'warn'; text: string; action?: { label: string; run: () => void } }
export interface Busy { label: string; done: number; total: number }
export interface View { zoom: number; panX: number; panY: number }

export type DialogState =
  | { type: 'confirm'; title: string; message: string; confirmLabel: string; danger?: boolean; resolve: (ok: boolean) => void }
  | { type: 'prompt'; title: string; label: string; initial: string; confirmLabel: string; resolve: (v: string | null) => void }
  | { type: 'unsaved'; title: string; message: string; resolve: (choice: 'save' | 'discard' | 'cancel') => void }

/** Aktuelles Projekt: Pfad (null = noch nie gespeichert), Anzeigename und ungespeicherte Änderungen. */
export interface ProjectInfo { path: string | null; name: string; dirty: boolean }

/** Standardnamen ohne Datei: „Unbenannt“ (neues Projekt) bzw. „Wiederhergestellt“ (Sitzung aus der Sicherung). */
export const unnamedProjectName = (): string => t('project.unnamed')
export const restoredProjectName = (): string => t('project.restored')
/** Ist `name` einer der Standardnamen (in irgendeiner Sprache)? Diese folgen einem Sprachwechsel. */
const generatedNameKind = (name: string): 'unnamed' | 'restored' | null => {
  if (LANGUAGES.some((l) => tIn(l, 'project.unnamed') === name)) return 'unnamed'
  if (LANGUAGES.some((l) => tIn(l, 'project.restored') === name)) return 'restored'
  return null
}

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
  /** Nesting-Dialog: 'multi' = Mehrfach platzieren, 'arrange' = Kompakt anordnen, null = zu. */
  nestOpen: 'multi' | 'arrange' | null
  /** Dialog „Text einfügen“ offen? */
  textOpen: boolean
  /** Seitenverhältnis beim Skalieren sperren (Standard: ja). Entsperrt: Breite und Höhe unabhängig. */
  lockAspect: boolean
  /** 'test' = Testschnitt (kleines Muster statt Projekt) im Schneiden-Dialog */
  cutMode: 'project' | 'test'

  init(): () => void
  toast(kind: Toast['kind'], text: string, action?: Toast['action']): void
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
  /** Schnittrand (Entgitterrand) mit den gespeicherten Voreinstellungen um die Auswahl legen bzw. ersetzen (ein Undo-Schritt). */
  addBorder(): void
  /** Schnittränder der Auswahl (inkl. Gruppen) löschen (ein Undo-Schritt). */
  removeBorder(): void
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
  /** Sprache wählen ('auto' = Betriebssystem): wirkt sofort in Renderer und Hauptprozess und wird gespeichert. */
  setLanguagePref(pref: LanguagePref): void
  setWorkArea(w: WorkArea): void
  setCut(patch: Partial<CutSettings>): void
  setAfterCut(patch: Partial<AfterCutSettings>): void
  setBorderDefaults(patch: Partial<BorderSettings>): void
  setNestDefaults(patch: Partial<NestSettings>): void
  setNestOpen(mode: 'multi' | 'arrange' | null): void
  /** Ersetzt die Teileliste und die Auswahl in EINEM Undo-Schritt (z. B. Ergebnis von „Mehrfach platzieren“). */
  commitParts(next: Part[], selection: string[]): void
  /** Material ohne Auftrag ausfahren (Vorschub = ejectExtraMm ab aktueller Position). */
  ejectMedia(): Promise<void>
  ejecting: boolean
  saveWorkAreaPreset(name: string): void
  deleteWorkAreaPreset(name: string): void
  /** Eigene Materialprofile: speichern (Name per Dialog), umbenennen, löschen. */
  saveMaterialProfile(): Promise<void>
  renameMaterialProfile(name: string): Promise<void>
  /** Zuletzt gewähltes Material-/Profil-Chip (nicht gespeichert; ohne Wahl gilt das zu den Werten passende Profil). */
  activeProfile: ActiveProfileRef | null
  /** Wählt ein Profil (eingebaut oder eigen) und setzt dessen Werte; null = nur Wahl zurücksetzen. */
  selectProfile(ref: ActiveProfileRef): void
  /** Überschreibt die Werte des eigenen Profils mit den aktuellen (mit Rückgängig-Toast). confirm: bei Abweichung nachfragen. */
  updateMaterialProfile(name: string, confirm?: boolean): Promise<void>
  /** Verwirft Änderungen: setzt die Werte auf das aktive Profil zurück. */
  revertProfileChanges(): void
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
  afterCut: { ...DEFAULT_AFTER_CUT },
  borderDefaults: { ...DEFAULT_BORDER },
  nestDefaults: { ...DEFAULT_NEST },
  rootFolders: [],
  weldOnImport: true,
  language: 'auto'
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

  // Sprachwechsel: Standardnamen des Projekts folgen, Geräteliste (Anzeigename des Simulators) neu holen
  onLanguageChange(() => {
    const p = get().project
    if (p.path === null) {
      const kind = generatedNameKind(p.name)
      if (kind) set({ project: { ...p, name: kind === 'unnamed' ? unnamedProjectName() : restoredProjectName() } })
    }
    if (get().devices.length) void get().refreshDevices()
  })

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
    activeProfile: null,
    busy: null,
    dialog: null,
    project: { path: null, name: unnamedProjectName(), dirty: false },
    cutOpen: false,
    nestOpen: null,
    textOpen: false,
    lockAspect: true,
    cutMode: 'project',

    init() {
      const unsub = window.api.onDeviceStatus((st) => {
        const prev = get()
        if (prev.connectedId) {
          if (st === 'disconnected' && !expectDisconnect) get().toast('error', t('toast.device.lost'))
          else if (st === 'no-media' && prev.deviceStatus !== 'no-media') get().toast('warn', t('toast.device.noMedia'))
          else if (st === 'error' && prev.deviceStatus !== 'error') get().toast('error', t('toast.device.error'))
        }
        set((s) => ({ deviceStatus: st, connectedId: st === 'disconnected' ? null : s.connectedId }))
        if (st === 'disconnected') void get().refreshDevices()
      })
      window.api.loadSettings().then((st) => {
        const merged = { ...defaultSettings(), ...st }
        applyLanguagePref(merged.language ?? 'auto')
        set({ settings: merged, settingsLoaded: true })
        get().fit()
      }).catch((e) => {
        set({ settingsLoaded: true })
        get().toast('error', t('toast.settings.loadFailed', { reason: String(e?.message ?? e) }))
      })
      void get().refreshDevices()
      return unsub
    },

    toast(kind, text, action) {
      const id = toastSeq++
      set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, text, action }] }))
      setTimeout(() => get().dismissToast(id), kind === 'error' || action ? 7000 : 4000)
    },
    dismissToast(id) { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })) },
    setBusy(b) { set({ busy: b }) },
    askConfirm(title, message, confirmLabel = t('common.ok'), danger = false) {
      return new Promise<boolean>((resolve) => set({ dialog: { type: 'confirm', title, message, confirmLabel, danger, resolve } }))
    },
    askText(title, label, initial = '', confirmLabel = t('common.save')) {
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
      if (sel.length < 2) { get().toast('info', t('toast.group.needTwo')); return }
      if (gids.size === 1 && !gids.has('')) { get().toast('info', t('toast.group.already')); return }
      get().snapshot()
      const next = groupParts(get().parts, sel.map((p) => p.id))
      set({ parts: next, selection: expandToGroups(next, sel.map((p) => p.id)), memberGroup: null })
      get().toast('success', t('toast.group.done', { n: sel.length }))
    },
    ungroupSelected() {
      const sel = selected()
      if (!sel.some((p) => p.groupId)) { get().toast('info', t('toast.group.none')); return }
      get().snapshot()
      const ids = sel.map((p) => p.id)
      set((s) => ({ parts: ungroupParts(s.parts, ids), selection: expandToGroups(s.parts, ids), memberGroup: null }))
      get().toast('success', t('toast.group.undone'))
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
      if (orig.groupId) { get().toast('info', t('toast.split.inGroup')); return }
      const pieces = splitPart(orig)
      if (pieces.length < 2) { get().toast('info', t('toast.split.single', { name: orig.name })); return }
      get().snapshot() // ein einziger Undo-Schritt: Original weg, Einzelteile da
      set((s) => ({ parts: s.parts.flatMap((p) => (p.id === orig.id ? pieces : [p])), selection: pieces.map((p) => p.id), memberGroup: null }))
      get().toast('success', t('toast.split.done', { n: pieces.length }))
    },
    weldSelected() {
      const sel = selected()
      if (sel.length !== 1) return
      const orig = sel[0]
      const welded = weldPart(orig)
      const count = (p: Part): number => p.paths.length
      if (welded === orig || count(welded) === count(orig)) {
        get().toast('info', t('toast.weld.none', { name: orig.name }))
        return
      }
      get().snapshot() // ein Undo-Schritt
      set((s) => ({ parts: s.parts.map((p) => (p.id === orig.id ? welded : p)) }))
      get().toast('success', t('toast.weld.done', { before: count(orig), after: count(welded) }))
    },
    addBorder() {
      const { parts, selection, settings } = get()
      if (!selection.length) { get().toast('info', t('toast.border.selectFirst')); return }
      const cfg = sanitizeBorder(settings.borderDefaults)
      let r: ReturnType<typeof addBorderToParts>
      try { r = addBorderToParts(parts, selection, borderOptionsFrom(cfg)) } catch (e) {
        get().toast('error', t('toast.border.failed', { reason: String((e as Error)?.message ?? e) })); return
      }
      if (!r) { get().toast('info', t('toast.border.selectFirst')); return }
      get().snapshot() // ein Undo-Schritt (auch beim Ersetzen)
      set({ parts: r.parts, selection: r.selection, memberGroup: null })
      const what = t(r.fellBack ? 'toast.border.kind.rect' : cfg.mode === 'offset' ? 'toast.border.kind.contour' : cfg.rounded ? 'toast.border.kind.rounded' : 'toast.border.kind.rect')
      get().toast('success', t(r.grouped ? (r.replaced ? 'toast.border.replacedGrouped' : 'toast.border.addedGrouped') : (r.replaced ? 'toast.border.replaced' : 'toast.border.added'),
        { what, mm: cfg.offsetMm, n: r.selection.length - 1 }))
      if (r.fellBack) get().toast('warn', t('toast.border.fellBack'))
    },
    removeBorder() {
      const { parts, selection } = get()
      const r = removeBorderFromParts(parts, selection)
      if (!r.removed) { get().toast('info', t('toast.border.noneSelected')); return }
      get().snapshot()
      set({ parts: r.parts, selection: r.selection, memberGroup: null })
      get().toast('success', t('toast.border.removed', { n: r.removed }))
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
        window.api.saveSettings(get().settings).catch((e) => get().toast('error', t('toast.settings.saveFailed', { reason: String(e?.message ?? e) })))
      }, 300)
    },
    setLanguagePref(pref) {
      applyLanguagePref(pref)
      get().patchSettings({ language: pref })
    },
    setWorkArea(w) {
      const prev = get().settings.activeWorkArea
      get().patchSettings({ activeWorkArea: { name: w.name, width: Math.round(w.width), height: Math.round(w.height) } })
      if (prev.width !== w.width || prev.height !== w.height) setTimeout(() => get().fit(), 0)
    },
    ejecting: false,
    setAfterCut(patch) {
      const cur = get().settings.afterCut ?? DEFAULT_AFTER_CUT
      const next = { ...cur, ...patch }
      next.ejectExtraMm = Math.min(MAX_EJECT_MM, Math.max(0, Math.round(Number.isFinite(next.ejectExtraMm) ? next.ejectExtraMm : DEFAULT_AFTER_CUT.ejectExtraMm)))
      get().patchSettings({ afterCut: next })
    },
    setBorderDefaults(patch) {
      get().patchSettings({ borderDefaults: sanitizeBorder({ ...sanitizeBorder(get().settings.borderDefaults), ...patch }) })
    },
    setNestDefaults(patch) {
      get().patchSettings({ nestDefaults: sanitizeNest({ ...sanitizeNest(get().settings.nestDefaults), ...patch }) })
    },
    setNestOpen(mode) {
      if (mode && !get().selection.length && mode === 'multi') { get().toast('info', t('toast.nest.selectFirst')); return }
      if (mode && !get().parts.length) { get().toast('info', t('toast.nest.noParts')); return }
      set({ nestOpen: mode })
    },
    commitParts(next, selection) {
      get().snapshot()
      set({ parts: next, selection, memberGroup: null })
    },
    async ejectMedia() {
      if (get().ejecting) return
      set({ ejecting: true })
      try {
        await window.api.ejectMedia((get().settings.afterCut ?? DEFAULT_AFTER_CUT).ejectExtraMm)
        get().toast('success', t('toast.eject.done'))
      } catch (e) {
        get().toast('error', t('toast.eject.failed', { reason: String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '') }))
      } finally { set({ ejecting: false }) }
    },
    setCut(patch) { get().patchSettings({ cut: { ...get().settings.cut, ...patch } }) },
    saveWorkAreaPreset(name) {
      const { settings } = get()
      const wa = { name, width: settings.activeWorkArea.width, height: settings.activeWorkArea.height }
      const list = settings.workAreas.filter((w) => w.name !== name)
      get().patchSettings({ workAreas: [...list, wa], activeWorkArea: wa })
      get().toast('success', t('toast.preset.saved', { name }))
    },
    deleteWorkAreaPreset(name) {
      const { settings } = get()
      get().patchSettings({ workAreas: settings.workAreas.filter((w) => w.name !== name) })
      get().toast('info', t('toast.preset.deleted', { name }))
    },
    async saveMaterialProfile() {
      const st = get()
      const name = await st.askText(t('profile.save.title'), t('profile.save.label'), '', t('common.save'))
      if (name === null) return
      const list = get().settings.materialProfiles ?? []
      const clean = cleanProfileName(name)
      if (clean && list.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
        const ok = await get().askConfirm(t('profile.overwrite.title'), t('profile.overwrite.exists', { name: clean }), t('profile.overwrite.confirm'))
        if (!ok) return
      }
      const r = upsertProfile(list, name, get().settings.cut)
      if (r.error) { get().toast('error', r.error); return }
      get().patchSettings({ materialProfiles: r.list })
      const saved = r.list.find((p) => cleanProfileName(name) && p.name.toLowerCase() === cleanProfileName(name)!.toLowerCase())
      if (saved) set({ activeProfile: { name: saved.name, builtin: false } })
      get().toast('success', t(r.replaced ? 'toast.profile.updated' : 'toast.profile.saved', { name: cleanProfileName(name) ?? name }))
    },
    selectProfile(ref) {
      const p = ref.builtin ? findBuiltin(ref.name) : (get().settings.materialProfiles ?? []).find((m) => m.name === ref.name)
      if (!p) return
      set({ activeProfile: ref })
      get().setCut(p.cut)
    },
    async updateMaterialProfile(name, confirm = false) {
      const st = get()
      const list = st.settings.materialProfiles ?? []
      const profile = list.find((p) => p.name === name)
      if (!profile) return
      if (!isModified(profile, st.settings.cut)) { st.toast('info', t('toast.profile.unchanged')); return }
      if (confirm) {
        const ok = await st.askConfirm(t('profile.overwrite.title'), t('profile.overwrite.values', { name }), t('profile.overwrite.confirm'))
        if (!ok) return
      }
      const r = updateProfile(get().settings.materialProfiles ?? [], name, get().settings.cut)
      if (r.error) { get().toast('error', r.error); return }
      get().patchSettings({ materialProfiles: r.list })
      set({ activeProfile: { name, builtin: false } })
      const prev = r.previous
      get().toast('success', t('toast.profile.updated', { name }), prev ? { label: t('common.undo'), run: () => {
        const u = updateProfile(get().settings.materialProfiles ?? [], name, prev)
        if (u.changed) get().patchSettings({ materialProfiles: u.list })
        get().toast('info', t('toast.profile.reverted', { name }))
      } } : undefined)
    },
    revertProfileChanges() {
      const st = get()
      const a = resolveActiveProfile(st.settings.cut, st.settings.materialProfiles ?? [], st.activeProfile)
      if (a?.modified) st.setCut(a.profile.cut)
    },
    async renameMaterialProfile(name) {
      const nn = await get().askText(t('profile.rename.title'), t('profile.rename.label'), name, t('profile.rename.confirm'))
      if (nn === null) return
      const r = renameProfile(get().settings.materialProfiles ?? [], name, nn)
      if (r.error) { get().toast('error', r.error); return }
      get().patchSettings({ materialProfiles: r.list })
      const cur = get().activeProfile
      if (cur && !cur.builtin && cur.name === name) set({ activeProfile: { name: r.list.find((p) => p.name.toLowerCase() === (cleanProfileName(nn) ?? '').toLowerCase())?.name ?? cur.name, builtin: false } })
    },
    async deleteMaterialProfile(name) {
      const ok = await get().askConfirm(t('profile.delete.title'), t('profile.delete.message', { name }), t('profile.delete.confirm'), true)
      if (!ok) return
      get().patchSettings({ materialProfiles: deleteProfile(get().settings.materialProfiles ?? [], name) })
      const cur = get().activeProfile
      if (cur && !cur.builtin && cur.name === name) set({ activeProfile: null })
      get().toast('info', t('toast.profile.deleted', { name }))
    },
    addRootFolder(path) {
      const { settings } = get()
      if (settings.rootFolders.includes(path)) { get().toast('info', t('toast.folder.exists')); return }
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
        get().toast('error', t('toast.device.listFailed', { reason: String((e as Error)?.message ?? e) }))
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
          get().toast('success', t('toast.device.connected', { name: get().devices.find((d) => d.id === id)?.name ?? id }))
        } else get().toast('error', t('toast.device.connectFailed', { reason: r.error ?? t('toast.device.unknownError') }))
      } catch (e) {
        get().toast('error', t('toast.device.connectFailed', { reason: String((e as Error)?.message ?? e) }))
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

