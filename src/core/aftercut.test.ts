import { describe, expect, it } from 'vitest'
import { DEFAULT_AFTER_CUT, MAX_EJECT_MM } from '@shared/types'
import { sanitizeAfterCut } from './aftercut'

describe('sanitizeAfterCut', () => {
  it('Standard: aus, 20 mm', () => {
    expect(sanitizeAfterCut(undefined)).toEqual({ eject: false, ejectExtraMm: 20 })
    expect(sanitizeAfterCut('x')).toEqual({ eject: false, ejectExtraMm: 20 })
  })
  it('übernimmt gültige Werte, begrenzt und verwirft Ungültiges', () => {
    expect(sanitizeAfterCut({ eject: true, ejectExtraMm: 150 })).toEqual({ eject: true, ejectExtraMm: 150 })
    expect(sanitizeAfterCut({ eject: 'ja', ejectExtraMm: -5 })).toEqual({ eject: false, ejectExtraMm: 0 })
    expect(sanitizeAfterCut({ eject: true, ejectExtraMm: 9999 }).ejectExtraMm).toBe(300)
    expect(sanitizeAfterCut({ eject: true, ejectExtraMm: NaN }).ejectExtraMm).toBe(20)
  })
  it('Standardwert und Grenzen sind dokumentiert: 20 mm, 0 bis 300 mm; ganze Millimeter', () => {
    expect(DEFAULT_AFTER_CUT).toEqual({ eject: false, ejectExtraMm: 20 })
    expect(MAX_EJECT_MM).toBe(300)
    expect(sanitizeAfterCut({ eject: true, ejectExtraMm: 12.6 }).ejectExtraMm).toBe(13)
  })
})
