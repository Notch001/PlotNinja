import type { deCut } from './de.cut'

/** English texts of the cut dialog (cut.*) and overlays (overlay.*); included in en.ts. */
export const enCut: Record<keyof typeof deCut, string> = {
  // ---- Cut dialog: title and header
  'cut.dialog.aria': 'Cut',
  'cut.title.summary': 'Prepare cut',
  'cut.title.summaryTest': 'Prepare test cut',
  'cut.title.running': 'Cutting …',
  'cut.title.runningTest': 'Test cut running …',
  'cut.title.paused': 'Paused – check media',
  'cut.title.done': 'Done',
  'cut.title.cancelled': 'Cancelled',
  'cut.title.error': 'Error',
  'cut.close': 'Close',
  'cut.close.disabled': 'Not possible while cutting – please cancel first',
  'cut.mirrored': 'mirrored',

  // ---- Time formats
  'cut.duration.s': '{s} s',
  'cut.duration.minS': '{m} min {s} s',
  'cut.duration.hMin': '{h} h {m} min',
  'cut.approx': '~{value}',

  // ---- Summary
  'cut.sum.content': 'Content',
  'cut.sum.contentTest': 'Test cut',
  'cut.sum.parts': 'Parts',
  'cut.sum.partsOf': '{n} of {total}',
  'cut.sum.length': 'Cut length',
  'cut.sum.lengthValue': '{cm} cm',
  'cut.sum.lengthPasses': '{cm} cm × {passes}',
  'cut.sum.workArea': 'Work area',
  'cut.sum.workAreaValue': '{w} × {h} mm',
  'cut.sum.device': 'Device',
  'cut.sum.estimate': 'Estimated time',
  'cut.blade.auto': 'Blade depth',
  'cut.blade.autoSuffix': '(auto)',
  'cut.blade.auto.tooltip': 'The Cameo sets the blade itself',
  'cut.blade.manual': 'Blade manual',
  'cut.blade.manual.tooltip': 'Please set this by hand on the blade holder',
  'cut.setting.force': 'Force',
  'cut.setting.speed': 'Speed',
  'cut.setting.passes': 'Passes',
  'cut.setting.overcut': 'Overcut',

  // ---- Options
  'cut.scope.aria': 'What to cut',
  'cut.scope.all': 'All parts ({n})',
  'cut.scope.all.tooltip': 'Cut all parts on the work area',
  'cut.scope.selection': 'Selection only ({n})',
  'cut.scope.selection.tooltip': 'Cut only the selected parts – everything else is left untouched',
  'cut.scope.selection.empty': 'To cut a selection, first select parts on the work area',
  'cut.optimize': 'Optimize cut order',
  'cut.optimize.tooltip': 'Nearest contours first, inner before outer. Off: order of the parts in the list.',
  'cut.mirror': 'Mirror entire job (back-side cut)',
  'cut.mirror.tooltip': 'Mirrors the entire job at the center of the mat – for film lying with its back side up. The document stays unchanged.',
  'cut.mirror.hint': 'The job is mirrored left/right at the center of the mat (see preview). Only the cut is mirrored, not your document.',
  'cut.eject': 'Eject material after cutting',
  'cut.eject.tooltip': 'Feeds the material out of the back of the plotter after cutting so it can be cut off there. Roll material only, not with a mat.',
  'cut.crossCut': 'Then cut off (cross cutter) – manual only',
  'cut.crossCut.tooltip': 'No command for automatic cutting off is known: after ejecting, pull the cross cutter through by hand (Cameo 4: slider at the back, Cameo 2/3: accessory).',

  // ---- Hints
  'cut.hint.test': 'A small pattern (20 × 20 mm square with a triangle and a circle, approx. 25 mm) is cut in the top left corner of the mat, starting at x = 10 mm, y = 10 mm. Place scrap material there and check afterwards whether force and blade are right. Your project is not cut.',
  'cut.hint.prepare': 'Load the material, insert the mat and check the blade. Cutting can be cancelled at any time. Tip: use "Test cut" in the cut settings to check force and blade on scrap material first.',
  'cut.hint.noMedia': 'No media is loaded in the plotter. Insert the mat and press the load button on the plotter.',
  'cut.hint.disconnected': 'The plotter is not connected.',
  'cut.hint.deviceError': 'The plotter reports an error or is not responding.',
  'cut.paused.next': 'Then click "Resume" here. Nothing has been cut yet.',

  // ---- Progress
  'cut.progress.cut': 'Cut',
  'cut.progress.cutValue': '{done} of {total} cm',
  'cut.progress.paths': 'Paths',
  'cut.progress.pathsValue': '{done} of {total}',
  'cut.progress.remaining': 'Time left',
  'cut.progress.duration': 'Duration',
  'cut.running.cancelling': 'Cancelling …',
  'cut.running.ejecting': 'Ejecting material …',
  'cut.running.warn': 'Please do not switch off the plotter or touch the mat.',
  'cut.done.ejected': 'Cut finished, material ejected. Pull a cross cutter through by hand now, if you have one.',
  'cut.done.plain': 'Cut finished. You can remove the material now.',
  'cut.cancelled': 'The cut was cancelled.',

  // ---- Errors
  'cut.error.lost': 'Connection to the plotter lost.',
  'cut.error.failedTest': 'The test cut failed.',
  'cut.error.failed': 'The cut failed.',
  'cut.error.lostHint': 'The app stays usable; after reconnecting you can start again.',
  'cut.error.startFailed': 'The cut could not be started.',
  'cut.error.cancelFailed': 'Cancelling failed: {message}',
  'cut.error.resumeFailed': 'Resuming failed: {message}',

  // ---- Footer
  'cut.btn.cancel': 'Cancel',
  'cut.btn.cancelling': 'Cancelling …',
  'cut.btn.start': 'Start cutting',
  'cut.btn.startTest': 'Start test cut',
  'cut.btn.notReady': 'The plotter is not ready',
  'cut.btn.nothing': 'There is nothing to cut',
  'cut.btn.resume': 'Resume',
  'cut.btn.back': 'Back to summary',

  // ---- Overlays
  'overlay.busy.progress': '{done} of {total}',
  'overlay.dialog.close': 'Close',
  'overlay.dialog.cancel': 'Cancel',
  'overlay.dialog.discard': "Don't save"
}
