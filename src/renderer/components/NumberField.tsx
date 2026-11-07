import { useEffect, useState } from 'react'
import { useLanguage } from '../lib/useT'
import { formatInput, parseNum as parse } from '../lib/numberInput'

export function NumberField({ label, value, onCommit, unit, min, max, step = 1, digits = 1, disabled, placeholder, title }: {
  label?: string; value: number | null; onCommit: (v: number) => void; unit?: string
  min?: number; max?: number; step?: number; digits?: number; disabled?: boolean; placeholder?: string; title?: string
}): JSX.Element {
  const lang = useLanguage()
  const parseNum = (raw: string): number | null => parse(raw, lang)
  const show = (v: number | null): string => formatInput(v, digits)
  const [text, setText] = useState(show(value))
  const [focus, setFocus] = useState(false)
  useEffect(() => { if (!focus) setText(show(value)) }, [value, focus, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (raw: string): void => {
    const n = parseNum(raw)
    if (n === null) { setText(show(value)); return }
    let v = n
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    onCommit(v)
    setText(show(v))
  }
  const bump = (dir: number, mult: number): void => {
    const base = parseNum(text) ?? value ?? 0
    commit(formatInput(Math.round((base + dir * step * mult) * 1000) / 1000, 3))
  }
  return (
    <label className={'field' + (disabled ? ' disabled' : '')} title={title}>
      {label && <span className="field-label">{label}</span>}
      <span className="field-input">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={(e) => { setFocus(true); e.currentTarget.select() }}
          onBlur={(e) => { setFocus(false); commit(e.currentTarget.value) }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commit(e.currentTarget.value); e.currentTarget.blur() }
            else if (e.key === 'Escape') { setText(show(value)); e.currentTarget.blur() }
            else if (e.key === 'ArrowUp') { e.preventDefault(); bump(1, e.shiftKey ? 10 : 1) }
            else if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1, e.shiftKey ? 10 : 1) }
          }}
        />
        {unit && <span className="field-unit">{unit}</span>}
      </span>
    </label>
  )
}
