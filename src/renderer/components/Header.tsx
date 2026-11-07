import { Copy, CopyPlus, FlipHorizontal2, FlipVertical2, Grid3x3, Group, Magnet, Maximize, Merge, Redo2, Scissors, Split, SquareDashed, Trash2, Type, Undo2, Ungroup, XOctagon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AlignTools, RotateButtons } from './HeaderTools'
import { UpdateChip } from './UpdateChip'
import { FileMenu } from './FileMenu'
import { LanguageMenu } from './LanguageMenu'
import { sanitizeBorder } from '../core'
import { selectedParts, useStore } from '../store'
import { useT } from '../lib/useT'
import { formatNumber } from '@shared/i18n'

/** Platzmangel: Ausrichten-Block wird zum Popover (Schwelle in px Fensterbreite). */
const COMPACT_BELOW = 1700

function useCompact(): boolean {
  const [c, setC] = useState(() => window.innerWidth < COMPACT_BELOW)
  useEffect(() => {
    const on = (): void => setC(window.innerWidth < COMPACT_BELOW)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return c
}

export function Header(): JSX.Element {
  const s = useStore()
  const t = useT()
  const compact = useCompact()
  const hasSel = s.selection.length > 0
  const sel = useMemo(() => selectedParts(s.parts, s.selection), [s.parts, s.selection])
  const canGroup = sel.length >= 2 && !(sel[0].groupId && sel.every((p) => p.groupId === sel[0].groupId))
  const bd = sanitizeBorder(s.settings.borderDefaults)
  const hasGroup = sel.some((p) => p.groupId)
  const splitBlocked = sel.length === 1 && !!sel[0].groupId
  const borderShape = bd.mode === 'offset' ? t('header.border.shape.contour') : bd.rounded ? t('header.border.shape.rounded') : t('header.border.shape.rect')
  return (
    <header className="header">
      <div className="logo">
        <span className="logo-mark"><Scissors size={16} strokeWidth={2.4} /></span>
        <span className="logo-name">Plot<b>Ninja</b></span>
      </div>
      <div className="header-sep" />
      <div className="hblock" title={t('fileMenu.title')}><FileMenu /></div>
      <div className="header-sep" />
      <div className="btn-group hblock" role="group" aria-label={t('header.edit.label')} title={t('header.edit.label')}>
        <button className="icon-btn" onClick={s.undo} disabled={!s.past.length} title={t('header.undo.tooltip')}><Undo2 size={17} /></button>
        <button className="icon-btn" onClick={s.redo} disabled={!s.future.length} title={t('header.redo.tooltip')}><Redo2 size={17} /></button>
        <button className="icon-btn" onClick={s.duplicateSelected} disabled={!hasSel} title={t('header.duplicate.tooltip')}><Copy size={17} /></button>
        <button className="icon-btn" onClick={() => s.setNestOpen('multi')} disabled={!hasSel} data-testid="multi-btn" title={hasSel ? t('header.multi.tooltip') : t('header.multi.disabled')}><CopyPlus size={17} /></button>
        <button className="icon-btn" onClick={s.deleteSelected} disabled={!hasSel} title={t('header.delete.tooltip')}><Trash2 size={17} /></button>
        <button
          className="icon-btn"
          disabled={!s.parts.length}
          title={t('header.clearAll.tooltip')}
          onClick={async () => {
            if (await s.askConfirm(t('header.clearAll.title'), t('header.clearAll.message', { n: formatNumber(s.parts.length) }), t('header.clearAll.confirm'), true)) s.clearAll()
          }}
        ><XOctagon size={17} /></button>
      </div>
      <div className="header-sep" />
      <div className="btn-group hblock" role="group" aria-label={t('header.rotateFlip.label')} title={t('header.rotateFlip.title')}>
        <RotateButtons />
        <button className="icon-btn" onClick={() => s.flipSelection('h')} disabled={!hasSel} title={t('header.flipH.tooltip')} data-testid="flip-h"><FlipHorizontal2 size={17} /></button>
        <button className="icon-btn" onClick={() => s.flipSelection('v')} disabled={!hasSel} title={t('header.flipV.tooltip')} data-testid="flip-v"><FlipVertical2 size={17} /></button>
      </div>
      <div className="header-sep" />
      <div className="hblock" title={t('headerTools.align.label')}><AlignTools compact={compact} /></div>
      <div className="header-sep" />
      <div className="hblock hview" role="group" aria-label={t('header.view.label')} title={t('header.view.label')}>
        <button className="btn ghost" onClick={s.fit} title={t('header.fit.tooltip')}><Maximize size={15} /><span className="lbl"> {t('header.fit.label')}</span></button>
        <button className={'toggle' + (s.showGrid ? ' on' : '')} onClick={s.toggleGrid} aria-pressed={s.showGrid} title={t('header.grid.tooltip')}><Grid3x3 size={15} /><span className="lbl"> {t('header.grid.label')}</span></button>
        <button className={'toggle' + (s.snapEnabled ? ' on' : '')} onClick={s.toggleSnap} aria-pressed={s.snapEnabled} title={t('header.snap.tooltip')}><Magnet size={15} /><span className="lbl"> {t('header.snap.label')}</span></button>
      </div>
      <div className="header-sep" />
      <div className="btn-group hblock" role="group" aria-label={t('header.textGroup.label')} title={t('header.textGroup.title')}>
        <button className="btn ghost" onClick={() => s.setTextOpen(true)} title={t('header.text.tooltip')}><Type size={15} /><span className="lbl"> {t('header.text.label')}</span></button>
        <button className="btn ghost" onClick={s.addBorder} disabled={!hasSel} data-testid="border-btn" title={t('header.border.tooltip', { shape: borderShape, mm: formatNumber(bd.offsetMm) })}><SquareDashed size={15} /><span className="lbl"> {t('header.border.label')}</span></button>
        <button className="icon-btn" onClick={s.splitSelected} disabled={s.selection.length !== 1 || splitBlocked} title={splitBlocked ? t('header.split.inGroup') : t('header.split.tooltip')}><Split size={17} /></button>
        <button className="icon-btn" onClick={s.groupSelected} disabled={!canGroup} title={t('header.group.tooltip')}><Group size={17} /></button>
        <button className="icon-btn" onClick={s.ungroupSelected} disabled={!hasGroup} title={t('header.ungroup.tooltip')}><Ungroup size={17} /></button>
      </div>
      <div className="spacer" />
      <button
        className={'toggle' + (s.settings.weldOnImport !== false ? ' on' : '')}
        onClick={() => s.patchSettings({ weldOnImport: s.settings.weldOnImport === false })}
        aria-pressed={s.settings.weldOnImport !== false}
        title={t('header.weld.tooltip')}
      ><Merge size={15} /><span className="lbl"> {t('header.weld.label')}</span></button>
      <div className="header-sep" />
      <LanguageMenu />
      <UpdateChip />
    </header>
  )
}
