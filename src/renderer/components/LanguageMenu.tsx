import { useEffect, useRef, useState } from 'react'
import { Check, Languages } from 'lucide-react'
import type { LanguagePref } from '@shared/i18n'
import { useStore } from '../store'
import { useLanguage, useT } from '../lib/useT'

const OPTIONS: LanguagePref[] = ['auto', 'de', 'en']

/** Sprachumschalter der Kopfzeile: Chip mit Kürzel (DE/EN) und Menü Auto / Deutsch / English. */
export function LanguageMenu(): JSX.Element {
  const t = useT()
  const lang = useLanguage()
  const pref = useStore((s) => s.settings.language ?? 'auto')
  const setPref = useStore((s) => s.setLanguagePref)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const label = (p: LanguagePref): string => (p === 'auto' ? t('language.auto') : p === 'de' ? t('language.de') : t('language.en'))

  return (
    <div className="file-menu lang-menu" ref={ref}>
      <button
        className={'update-chip lang-chip' + (open ? ' open' : '')}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('language.menu.tooltip')}
        data-testid="lang-btn"
      >
        <Languages size={14} /> {lang.toUpperCase()}
      </button>
      {open && (
        <div className="menu menu-right lang-popup" role="menu" aria-label={t('language.menu.title')}>
          <div className="menu-title">{t('language.menu.title')}</div>
          {OPTIONS.map((p) => (
            <button
              key={p}
              className="menu-item"
              role="menuitemradio"
              aria-checked={pref === p}
              data-testid={'lang-' + p}
              onClick={() => { setPref(p); setOpen(false) }}
            >
              {pref === p ? <Check size={15} /> : <span style={{ width: 15 }} />} {label(p)}
              {p === 'auto' ? <small>{lang.toUpperCase()}</small> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
