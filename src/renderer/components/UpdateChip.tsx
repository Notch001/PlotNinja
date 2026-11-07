import { CheckCircle2, AlertTriangle, Download, Loader2, RefreshCw, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { UpdateStatus } from '@shared/types'
import { useStore } from '../store'

/** Version + Update-Status in der Kopfzeile. Klick = jetzt nach Updates suchen (bzw. Neustart, wenn bereit). */
export function UpdateChip(): JSX.Element {
  const toast = useStore((s) => s.toast)
  const [version, setVersion] = useState('')
  const [st, setSt] = useState<UpdateStatus>({ state: 'idle' })
  const manual = useRef(false)
  const stRef = useRef(st)
  stRef.current = st

  useEffect(() => {
    let off = (): void => undefined
    void window.api.getAppVersion().then(setVersion).catch(() => undefined)
    void window.api.getUpdateStatus().then(setSt).catch(() => undefined)
    off = window.api.onUpdateStatus((s) => {
      setSt(s)
      if (!manual.current) return
      if (s.state === 'none') toast('success', 'Du hast die neueste Version')
      else if (s.state === 'available' || s.state === 'downloading') toast('info', `Neue Version ${s.version ?? ''} gefunden, wird geladen`.replace('  ', ' '))
      else if (s.state === 'downloaded') toast('success', `Version ${s.version ?? ''} ist bereit – Neustart zum Installieren`.replace('  ', ' '))
      else if (s.state === 'error') toast('error', s.message ?? 'Update-Prüfung fehlgeschlagen')
      else if (s.state === 'dev') toast('info', s.message ?? 'Updates nur in der installierten App')
      else return // 'checking'
      manual.current = false
    })
    return off
  }, [toast])

  const click = (): void => {
    const cur = stRef.current
    if (cur.state === 'downloaded') { void window.api.restartForUpdate(); return }
    if (cur.state === 'checking') { toast('info', 'Suche läuft bereits …'); return }
    if (cur.state === 'downloading' || cur.state === 'available') { toast('info', `Neue Version ${cur.version ?? ''} wird bereits geladen`); return }
    manual.current = true
    void window.api.checkForUpdates().catch((e) => { manual.current = false; toast('error', String(e?.message ?? e)) })
  }

  let label = 'Auf dem neuesten Stand'
  let icon = <CheckCircle2 size={14} />
  let cls = ''
  let title = 'Klicken, um jetzt nach Updates zu suchen'
  switch (st.state) {
    case 'checking': label = 'Suche Updates …'; icon = <Loader2 size={14} className="spin" />; break
    case 'available': label = `Update ${st.version ?? ''} wird geladen`; icon = <Download size={14} />; cls = 'busy'; break
    case 'downloading': label = `Update ${st.version ?? ''} wird geladen ${Math.round(st.percent ?? 0)} %`; icon = <Download size={14} />; cls = 'busy'; break
    case 'downloaded': label = 'Update bereit – Neustart'; icon = <RotateCw size={14} />; cls = 'ready'; title = 'Klicken: PlotNinja neu starten und aktualisieren'; break
    case 'error': label = 'Update-Fehler (Details)'; icon = <AlertTriangle size={14} />; cls = 'err'; title = (st.message ?? 'Fehler') + ' – klicken, um es erneut zu versuchen'; break
    case 'dev': label = 'Entwicklungsversion'; icon = <RefreshCw size={14} />; title = st.message ?? 'Updates nur in der installierten App'; break
    case 'idle': label = 'Updates prüfen'; icon = <RefreshCw size={14} />; break
    case 'none': title = 'Du hast die neueste Version – klicken, um erneut zu suchen'; break
  }
  return (
    <>
      <span className="app-version" title="Installierte Version">{version ? `v${version}` : ''}</span>
      <button className={'update-chip ' + cls} onClick={click} title={title}>{icon} {label}</button>
    </>
  )
}
