import { describe, expect, it } from 'vitest'
import type { CutSettings, WorkArea } from '@shared/types'
import { DEFAULT_CUT } from '@shared/types'
import {
  GRID_MAX_COUNT, GRID_MIN_COUNT, VERDICTS, WIZARD_CELL_H_MM, WIZARD_CELL_W_MM, WIZARD_MARGIN_MM, buildGridJobs, buildWizardJob,
  gridDefaults, gridVariants, slotCount, slotPosition, slotRows, slotsPerRow, suggestAdjustment
} from './materialWizard'
import { RANGES, MAX_PROFILE_NOTE, sanitizeProfiles, updateProfile, upsertProfile, renameProfile } from './materials'
import { pointsBox } from './geom'
import { testCutPart } from './testcut'

const wa: WorkArea = { name: 'x', width: 305, height: 305 }
const KEYS: (keyof CutSettings)[] = ['blade', 'force', 'speed', 'passes', 'overcut']
const inRange = (c: CutSettings): boolean => KEYS.every((k) => c[k] >= RANGES[k][0] && c[k] <= RANGES[k][1])

describe('Testplatz-Raster', () => {
  it('12x12-Matte: 4 Spalten, 7 Zeilen, Plätze zeilenweise von links nach rechts', () => {
    expect(slotsPerRow(wa)).toBe(4)
    expect(slotRows(wa)).toBe(7)
    expect(slotCount(wa)).toBe(28)
    expect(slotPosition(wa, 0)).toEqual({ x: WIZARD_MARGIN_MM, y: WIZARD_MARGIN_MM })
    expect(slotPosition(wa, 1)).toEqual({ x: WIZARD_MARGIN_MM + WIZARD_CELL_W_MM, y: WIZARD_MARGIN_MM })
    expect(slotPosition(wa, 4)).toEqual({ x: WIZARD_MARGIN_MM, y: WIZARD_MARGIN_MM + WIZARD_CELL_H_MM })
  })

  it('kein Platz mehr: null; ungültige Plätze und zu kleine Flächen ebenfalls', () => {
    expect(slotPosition(wa, 28)).toBeNull()
    expect(slotPosition(wa, -1)).toBeNull()
    expect(slotPosition(wa, 1.5)).toBeNull()
    const tiny = { name: 't', width: 50, height: 305 }
    expect(slotCount(tiny)).toBe(0)
    expect(slotPosition(tiny, 0)).toBeNull()
    expect(buildWizardJob(tiny, DEFAULT_CUT, 0, 1)).toBeNull()
  })

  it('alle Plätze liegen vollständig auf der Arbeitsfläche, ohne einander zu überlappen', () => {
    const boxes = Array.from({ length: slotCount(wa) }, (_, s) => {
      const job = buildWizardJob(wa, DEFAULT_CUT, s, (s % 9) + 1)!
      const b = pointsBox(job.paths.flatMap((p) => p.points))!
      expect(b.x).toBeGreaterThanOrEqual(WIZARD_MARGIN_MM - 1e-6)
      expect(b.y).toBeGreaterThanOrEqual(WIZARD_MARGIN_MM - 1e-6)
      expect(b.x + b.width).toBeLessThanOrEqual(wa.width - WIZARD_MARGIN_MM + 1e-6)
      expect(b.y + b.height).toBeLessThanOrEqual(wa.height - WIZARD_MARGIN_MM + 1e-6)
      return b
    })
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
      expect(overlap, `${i}/${j}`).toBe(false)
    }
  })
})

describe('buildWizardJob', () => {
  it('Testmuster (3 geschlossene Pfade) plus n Strichmarken (offene Zweipunkt-Linien) darüber', () => {
    for (const n of [1, 3, 9]) {
      const job = buildWizardJob(wa, DEFAULT_CUT, 5, n)!
      const closed = job.paths.filter((p) => p.closed)
      const marks = job.paths.filter((p) => !p.closed)
      expect(closed).toHaveLength(3)
      expect(marks).toHaveLength(n)
      expect(marks.every((m) => m.points.length === 2)).toBe(true)
      const patternTop = Math.min(...closed.flatMap((p) => p.points.map((q) => q.y)))
      const marksBottom = Math.max(...marks.flatMap((p) => p.points.map((q) => q.y)))
      expect(marksBottom).toBeLessThan(patternTop)
    }
  })

  it('mehr als 9 Striche werden auf 9 begrenzt; Einstellungen und Ausfahren werden übernommen', () => {
    const cut = { ...DEFAULT_CUT, force: 22 }
    const job = buildWizardJob(wa, cut, 0, 15, 40)!
    expect(job.paths.filter((p) => !p.closed)).toHaveLength(9)
    expect(job.settings).toEqual(cut)
    expect(job.ejectExtraMm).toBe(40)
    expect(buildWizardJob(wa, cut, 0, 1)!.ejectExtraMm).toBeUndefined()
  })

  it('Muster hat die Größe des Testschnitts (55 x 25) an der Platzposition', () => {
    const job = buildWizardJob(wa, DEFAULT_CUT, 1, 2)!
    const pos = slotPosition(wa, 1)!
    const b = pointsBox(job.paths.filter((p) => p.closed).flatMap((p) => p.points))!
    expect(b.width).toBeCloseTo(55, 1)
    expect(b.height).toBeCloseTo(25, 1)
    expect(b.x).toBeCloseTo(pos.x, 6)
  })

  it('testCutPart() ohne Argument bleibt an der alten Position (10/10)', () => {
    const p = testCutPart()
    expect([p.x, p.y]).toEqual([10, 10])
    expect(testCutPart({ x: 3, y: 4 }).x).toBe(3)
  })
})

describe('gridVariants', () => {
  it('Schrittfolge für Druck; übrige Werte bleiben', () => {
    const v = gridVariants(DEFAULT_CUT, 'force', 8, 2, 5)
    expect(v.map((c) => c.force)).toEqual([8, 10, 12, 14, 16])
    expect(v.every((c) => c.speed === DEFAULT_CUT.speed && c.blade === DEFAULT_CUT.blade)).toBe(true)
  })

  it('Anzahl 3..7, Klemmen auf den Bereich, Duplikate entfallen', () => {
    expect(gridVariants(DEFAULT_CUT, 'force', 1, 1, 1)).toHaveLength(GRID_MIN_COUNT)
    expect(gridVariants(DEFAULT_CUT, 'force', 1, 1, 99)).toHaveLength(GRID_MAX_COUNT)
    const hi = gridVariants(DEFAULT_CUT, 'force', 30, 2, 5)
    expect(hi.map((c) => c.force)).toEqual([30, 32, 33])
    const speed = gridVariants(DEFAULT_CUT, 'speed', 9, 1, 5)
    expect(speed.map((c) => c.speed)).toEqual([9, 10])
    expect(gridVariants(DEFAULT_CUT, 'blade', 4, 0, 4)).toHaveLength(1)
    expect(gridVariants(DEFAULT_CUT, 'blade', 2, 1.4, 3).every(inRange)).toBe(true)
  })
})

describe('gridDefaults', () => {
  it('aktueller Wert liegt in der Mitte, Start bleibt im Bereich', () => {
    expect(gridDefaults(DEFAULT_CUT, 'force', 5)).toEqual({ start: 6, step: 2 })
    expect(gridDefaults({ ...DEFAULT_CUT, force: 2 }, 'force', 7)).toEqual({ start: 1, step: 2 })
    expect(gridDefaults(DEFAULT_CUT, 'speed', 5)).toEqual({ start: 3, step: 1 })
  })
})

describe('buildGridJobs', () => {
  const cuts = gridVariants(DEFAULT_CUT, 'force', 6, 2, 5)

  it('ein Auftrag je Variante mit der jeweiligen Einstellung und 1..N Strichmarken', () => {
    const plan = buildGridJobs(wa, cuts, 0)!
    expect(plan.jobs).toHaveLength(5)
    plan.jobs.forEach((job, i) => {
      expect(job.settings).toEqual(cuts[i])
      expect(job.paths.filter((p) => p.closed)).toHaveLength(1)
      expect(job.paths.filter((p) => !p.closed)).toHaveLength(i + 1)
    })
  })

  it('belegt eine ganze Zeile; mitten in einer Zeile beginnt das Raster in der nächsten', () => {
    const cols = slotsPerRow(wa)
    const a = buildGridJobs(wa, cuts, 0)!
    expect(a.firstSlot).toBe(0)
    expect(a.nextSlot).toBe(cols)
    expect(a.slotsUsed).toBe(cols)
    const b = buildGridJobs(wa, cuts, 2)!
    expect(b.firstSlot).toBe(cols)
    expect(b.nextSlot).toBe(2 * cols)
    expect(b.slotsUsed).toBe(2 * cols - 2)
    const rowY = (plan: NonNullable<typeof a>): number => Math.min(...plan.jobs.flatMap((j) => j.paths.flatMap((p) => p.points.map((q) => q.y))))
    expect(rowY(b)).toBeCloseTo(rowY(a) + WIZARD_CELL_H_MM, 6)
  })

  it('Quadrate 15 mm im Abstand 22 mm, nur der letzte Auftrag fährt aus', () => {
    const plan = buildGridJobs(wa, cuts, 0, 25)!
    const xs = plan.jobs.map((j) => pointsBox(j.paths.find((p) => p.closed)!.points)!)
    xs.forEach((b, i) => {
      expect(b.width).toBeCloseTo(15, 6)
      expect(b.x).toBeCloseTo(WIZARD_MARGIN_MM + i * 22, 6)
    })
    expect(plan.jobs.map((j) => j.ejectExtraMm)).toEqual([undefined, undefined, undefined, undefined, 25])
  })

  it('null bei voller Matte, zu schmaler Fläche oder leerer Variantenliste', () => {
    const last = slotCount(wa) - slotsPerRow(wa) + 1
    expect(buildGridJobs(wa, cuts, last)).toBeNull()
    expect(buildGridJobs({ name: 'n', width: 100, height: 305 }, cuts, 0)).toBeNull()
    expect(buildGridJobs(wa, [], 0)).toBeNull()
  })
})

describe('suggestAdjustment', () => {
  const base: CutSettings = { blade: 3, force: 10, speed: 5, passes: 1, overcut: 0.5 }

  it('good: unverändert', () => {
    const r = suggestAdjustment(base, 'good')
    expect(r.cut).toEqual(base)
    expect(r.changed).toEqual([])
  })

  it('notThrough: Druck +2, ab Druck 30 ein Durchgang mehr', () => {
    expect(suggestAdjustment(base, 'notThrough')).toMatchObject({ cut: { ...base, force: 12 }, changed: ['force'], reasonKey: 'wizard.reason.notThrough' })
    const r = suggestAdjustment({ ...base, force: 30 }, 'notThrough')
    expect(r.cut).toEqual({ ...base, force: 30, passes: 2 })
    expect(r.changed).toEqual(['passes'])
    expect(r.reasonKey).toBe('wizard.reason.notThroughPasses')
  })

  it('tooDeep: Druck -2 und Klinge -1 (nur wenn > 1); Hinweistext je nach Klingenart', () => {
    const r = suggestAdjustment(base, 'tooDeep')
    expect(r.cut).toEqual({ ...base, force: 8, blade: 2 })
    expect(r.changed.sort()).toEqual(['blade', 'force'])
    expect(r.reasonKey).toBe('wizard.reason.tooDeepBlade')
    expect(suggestAdjustment(base, 'tooDeep', false).reasonKey).toBe('wizard.reason.tooDeepBladeManual')
    const one = suggestAdjustment({ ...base, blade: 1 }, 'tooDeep')
    expect(one.cut).toEqual({ ...base, blade: 1, force: 8 })
    expect(one.reasonKey).toBe('wizard.reason.tooDeep')
  })

  it('cornersTorn: Tempo -1 und Druck -1; liftsOff: nur Tempo -1, Überschnitt bleibt', () => {
    expect(suggestAdjustment(base, 'cornersTorn').cut).toEqual({ ...base, speed: 4, force: 9 })
    const r = suggestAdjustment(base, 'liftsOff')
    expect(r.cut).toEqual({ ...base, speed: 4 })
    expect(r.cut.overcut).toBe(0.5)
    expect(r.changed).toEqual(['speed'])
  })

  it('klemmt an den Grenzen; ohne mögliche Änderung kommt der Grenz-Hinweis', () => {
    expect(suggestAdjustment({ ...base, force: 29 }, 'notThrough').cut.force).toBe(31)
    expect(suggestAdjustment({ ...base, force: 1, blade: 1, speed: 1 }, 'tooDeep').changed).toEqual([])
    expect(suggestAdjustment({ ...base, force: 1, blade: 1 }, 'tooDeep').reasonKey).toBe('wizard.reason.limit')
    expect(suggestAdjustment({ ...base, force: 33, passes: 5 }, 'notThrough').reasonKey).toBe('wizard.reason.limit')
    expect(suggestAdjustment({ ...base, speed: 1 }, 'liftsOff').reasonKey).toBe('wizard.reason.limit')
  })

  it('liefert für alle Urteile und Randwerte gültige Werte, ohne die Eingabe zu verändern', () => {
    for (const verdict of VERDICTS) for (const force of [1, 29, 30, 33]) for (const blade of [1, 10]) for (const speed of [1, 10]) for (const passes of [1, 5]) {
      const cut = { blade, force, speed, passes, overcut: 0 }
      const copy = { ...cut }
      const r = suggestAdjustment(cut, verdict)
      expect(inRange(r.cut)).toBe(true)
      expect(cut).toEqual(copy)
    }
  })
})

describe('Profilnotiz', () => {
  it('upsertProfile speichert die bereinigte, gekürzte Notiz; ohne Angabe bleibt eine vorhandene beim Überschreiben', () => {
    let r = upsertProfile([], 'Folie', DEFAULT_CUT, '  Klinge   rot\nMatte neu ')
    expect(r.list[0].note).toBe('Klinge rot Matte neu')
    r = upsertProfile(r.list, 'folie', { ...DEFAULT_CUT, force: 20 })
    expect(r.list[0].note).toBe('Klinge rot Matte neu')
    expect(r.list[0].cut.force).toBe(20)
    r = upsertProfile(r.list, 'Folie', DEFAULT_CUT, 'neu')
    expect(r.list[0].note).toBe('neu')
    r = upsertProfile(r.list, 'Folie', DEFAULT_CUT, '   ')
    expect(r.list[0]).not.toHaveProperty('note')
    expect(upsertProfile([], 'A', DEFAULT_CUT, 'x'.repeat(500)).list[0].note).toHaveLength(MAX_PROFILE_NOTE)
    expect(upsertProfile([], 'B', DEFAULT_CUT).list[0]).not.toHaveProperty('note')
  })

  it('sanitizeProfiles bereinigt Notizen; update/rename erhalten sie', () => {
    const out = sanitizeProfiles([
      { name: 'A', cut: DEFAULT_CUT, note: ' hallo  welt ' },
      { name: 'B', cut: DEFAULT_CUT, note: 42 },
      { name: 'C', cut: DEFAULT_CUT, note: 'y'.repeat(300) }
    ])
    expect(out[0].note).toBe('hallo welt')
    expect(out[1]).not.toHaveProperty('note')
    expect(out[2].note).toHaveLength(MAX_PROFILE_NOTE)
    const u = updateProfile(out, 'A', { ...DEFAULT_CUT, force: 15 })
    expect(u.list[0].note).toBe('hallo welt')
    expect(renameProfile(u.list, 'A', 'Neu').list[0].note).toBe('hallo welt')
  })
})
