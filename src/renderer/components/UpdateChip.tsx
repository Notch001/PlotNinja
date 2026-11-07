import { CheckCircle2, AlertTriangle, Download, Loader2, RefreshCw, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { UpdateStatus } from '@shared/types'
import { useStore } from '../store'
import { t, formatNumber } from '@shared/i18n'
import { useT } from '../lib/useT'

/** Version + Update-Status in der Kopfzeile. Klick = jetzt nach Updates suchen (bzw. Neustart, wenn bereit). */
export function UpdateChip(): JSX.Element {
  const toast = useStore((s) => s.toast)
  const tr = useT()
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
      if (s.state === 'none') toast('success', t('updateChip.toast.latest'))
      else if (s.state === 'available' || s.state === 'downloading') toast('info', t('updateChip.toast.found', { version: s.version ?? '' }).replace('  ', ' '))
      else if (s.state === 'downloaded') toast('success', t('updateChip.toast.ready', { version: s.version ?? '' }).replace('  ', ' '))
      else if (s.state === 'error') toast('error', s.message ?? t('updateChip.toast.errorDefault'))
      else if (s.state === 'dev') toast('info', s.message ?? t('updateChip.devOnly'))
      else return // 'checking'
      manual.current = false
    })
    return off
  }, [toast])

  const click = (): void => {
    const cur = stRef.current
    if (cur.state === 'downloaded') { void window.api.restartForUpdate(); return }
    if (cur.state === 'checking') { toast('info', t('updateChip.toast.alreadyChecking')); return }
    if (cur.state === 'downloading' || cur.state === 'available') { toast('info', t('updateChip.toast.alreadyLoading', { version: cur.version ?? '' })); return }
    manual.current = true
    void window.api.checkForUpdates().catch((e) => { manual.current = false; toast('error', String(e?.message ?? e)) })
  }

  let label = tr('updateChip.label.latest')
  let icon = <CheckCircle2 size={14} />
  let cls = ''
  let title = tr('updateChip.tooltip.check')
  switch (st.state) {
    case 'checking': label = tr('updateChip.label.checking'); icon = <Loader2 size={14} className="spin" />; break
    case 'available': label = tr('updateChip.label.available', { version: st.version ?? '' }); icon = <Download size={14} />; cls = 'busy'; break
    case 'downloading': label = tr('updateChip.label.downloading', { version: st.version ?? '', percent: formatNumber(Math.round(st.percent ?? 0)) }); icon = <Download size={14} />; cls = 'busy'; break
    case 'downloaded': label = tr('updateChip.label.ready'); icon = <RotateCw size={14} />; cls = 'ready'; title = tr('updateChip.tooltip.ready'); break
    case 'error': label = tr('updateChip.label.error'); icon = <AlertTriangle size={14} />; cls = 'err'; title = tr('updateChip.tooltip.error', { message: st.message ?? tr('updateChip.error.default') }); break
    case 'dev': label = tr('updateChip.label.dev'); icon = <RefreshCw size={14} />; title = st.message ?? tr('updateChip.devOnly'); break
    case 'idle': label = tr('updateChip.label.idle'); icon = <RefreshCw size={14} />; break
    case 'none': title = tr('updateChip.tooltip.none'); break
  }
  return (
    <>
      <span className="app-version" title={tr('updateChip.version.tooltip')}>{version ? `v${version}` : ''}</span>
      <button className={'update-chip ' + cls} onClick={click} title={title} aria-label={label}>{icon}<span className={'uc-label' + (cls === '' || st.state === 'dev' || st.state === 'idle' ? ' quiet' : '')}> {label}</span></button>
    </>
  )
}
