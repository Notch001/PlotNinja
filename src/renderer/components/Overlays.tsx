import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react'
import { useStore, type DialogState } from '../store'

export function Toasts(): JSX.Element {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind} onClick={() => dismiss(t.id)}>
          {t.kind === 'success' ? <CheckCircle2 size={16} /> : t.kind === 'error' ? <XCircle size={16} /> : t.kind === 'warn' ? <AlertTriangle size={16} /> : <Info size={16} />}
          <span>{t.text}</span>
          {t.action && <button className="toast-action" onClick={(e) => { e.stopPropagation(); t.action!.run(); dismiss(t.id) }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  )
}

export function BusyBar(): JSX.Element | null {
  const busy = useStore((s) => s.busy)
  if (!busy) return null
  const pct = busy.total > 0 ? (busy.done / busy.total) * 100 : null
  return (
    <div className="busy">
      <Loader2 size={16} className="spin" />
      <div className="busy-text">
        <span>{busy.label}</span>
        {busy.total > 0 && <small>{busy.done} von {busy.total}</small>}
      </div>
      <div className="progress thin"><div className={'progress-bar' + (pct === null ? ' indeterminate' : '')} style={{ width: pct === null ? '40%' : pct + '%' }} /></div>
    </div>
  )
}

function dismiss(d: NonNullable<DialogState>): void {
  if (d.type === 'confirm') d.resolve(false)
  else if (d.type === 'unsaved') d.resolve('cancel')
  else d.resolve(null)
}

export function DialogHost(): JSX.Element | null {
  const dialog = useStore((s) => s.dialog)
  const close = useStore((s) => s.closeDialog)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (dialog?.type === 'prompt') { setText(dialog.initial); setTimeout(() => inputRef.current?.select(), 30) }
  }, [dialog])
  useEffect(() => {
    if (!dialog) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { dismiss(dialog); close() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, close])
  if (!dialog) return null
  const cancel = (): void => { dismiss(dialog); close() }
  const ok = (): void => {
    if (dialog.type === 'confirm') dialog.resolve(true)
    else if (dialog.type === 'unsaved') dialog.resolve('save')
    else { if (!text.trim()) return; dialog.resolve(text.trim()) }
    close()
  }
  return (
    <div className="modal-backdrop" onMouseDown={cancel}>
      <div className="modal small" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{dialog.title}</h2>
          <button className="icon-btn" onClick={cancel} title="Schließen"><X size={16} /></button>
        </div>
        <div className="modal-body">
          {dialog.type === 'confirm' || dialog.type === 'unsaved' ? <p>{dialog.message}</p> : (
            <label className="field stacked">
              <span className="field-label">{dialog.label}</span>
              <input ref={inputRef} className="text-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ok() }} autoFocus />
            </label>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={cancel}>Abbrechen</button>
          {dialog.type === 'unsaved' && <button className="btn danger" onClick={() => { dialog.resolve('discard'); close() }}>Nicht speichern</button>}
          <button className={'btn ' + (dialog.type === 'confirm' && dialog.danger ? 'danger' : 'primary')} onClick={ok} autoFocus={dialog.type !== 'prompt'}>{dialog.type === 'unsaved' ? 'Speichern' : dialog.confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
