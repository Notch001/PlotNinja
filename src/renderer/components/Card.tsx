import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export function Card({ id, title, icon, children, defaultOpen = true, right }: {
  id: string; title: string; icon?: ReactNode; children: ReactNode; defaultOpen?: boolean; right?: ReactNode
}): JSX.Element {
  const key = 'pn.card.' + id
  const [open, setOpen] = useState<boolean>(() => {
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === '1' } catch { return defaultOpen }
  })
  const toggle = (): void => {
    setOpen(!open)
    try { localStorage.setItem(key, !open ? '1' : '0') } catch { /* ignorieren */ }
  }
  return (
    <section className={'card' + (open ? '' : ' collapsed')}>
      <header className="card-head" onClick={toggle} title={open ? 'Einklappen' : 'Ausklappen'}>
        <ChevronDown size={14} className="card-chevron" />
        {icon && <span className="card-icon">{icon}</span>}
        <h3>{title}</h3>
        <span className="card-right" onClick={(e) => e.stopPropagation()}>{right}</span>
      </header>
      {open && <div className="card-body">{children}</div>}
    </section>
  )
}
