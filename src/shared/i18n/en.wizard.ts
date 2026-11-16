import type { deWizard } from './de.wizard'

/** English texts of the “Calibrate material” wizard (wizard.*); included in en.ts. */
export const enWizard: Record<keyof typeof deWizard, string> = {
  // ---- Trigger in the cut settings panel
  'wizard.open': 'Calibrate material',
  'wizard.open.tooltip': 'Cuts small test shapes, you rate them and the wizard finds suitable values step by step – save them as a material profile at the end',

  // ---- Dialog: titles
  'wizard.aria': 'Calibrate material',
  'wizard.title.setup': 'Calibrate material – start values',
  'wizard.title.rate': 'Calibrate material – rate test',
  'wizard.title.adjust': 'Calibrate material – adjust values',
  'wizard.title.save': 'Calibrate material – save profile',
  'wizard.title.running': 'Test cut running …',
  'wizard.title.paused': 'Paused – check the media',
  'wizard.title.cancelled': 'Cancelled',
  'wizard.title.error': 'Error',
  'wizard.mat.aria': 'Preview of the test cuts on the work area',
  'wizard.close.tooltip': 'Close – your progress is kept until the app is closed',

  // ---- Step 1: start values and test type
  'wizard.setup.intro': 'The wizard cuts small test shapes with your start values. You rate the result and the values are adjusted – until the cut is right. At the end you save them as a material profile. The values here do not change your current settings.',
  'wizard.setup.startFrom': 'Start values from',
  'wizard.setup.startCurrent': 'Current settings',
  'wizard.mode.aria': 'Test type',
  'wizard.mode.single': 'Single tests in turn',
  'wizard.mode.singleTooltip': 'Cut one test pattern after the other and rate each',
  'wizard.mode.grid': 'Grid (row)',
  'wizard.mode.gridTooltip': 'Cut a row of small squares with increasing force, speed or blade in one go',
  'wizard.mode.singleHint': 'Cuts the test pattern (square, triangle, circle) with tick marks above it showing the trial number. Each test goes next to the previous ones.',
  'wizard.grid.param.aria': 'Varied value',
  'wizard.grid.bladeManual': 'Not possible with a manually set blade – the program cannot adjust it',
  'wizard.grid.start': 'Start',
  'wizard.grid.step': 'Step',
  'wizard.grid.count': 'Count',
  'wizard.grid.variants': 'Variants ({param}): {list}',
  'wizard.grid.hint': 'Cuts a row of small squares one after the other, each with its number as tick marks above it. Afterwards you pick the number that cut best.',
  'wizard.grid.variantLabel': 'No. {n} · {param} {value}',
  'wizard.note.label': 'Note (e.g. blade, mat)',
  'wizard.note.placeholder': 'e.g. red blade, new mat',

  // ---- Eject (wizard only)
  'wizard.eject.label': 'Feed out exactly the right amount of material after the test',
  'wizard.eject.tooltip': 'Advances the material after the cut so you can peel off the test. Applies to the wizard only and does not change the “After cutting” setting.',
  'wizard.eject.distance': 'Extra',
  'wizard.eject.hint': 'After ejecting, put the material back in the same place if the position counter should keep going. For a new piece, choose “New piece of material inserted” below.',

  // ---- Room on the material
  'wizard.slots.status': '{used} of {total} test positions used',
  'wizard.slots.full': 'Material full – insert a new piece',
  'wizard.slots.fullGrid': 'No free row left for the grid or the area is too narrow – insert a new piece',
  'wizard.slots.newPiece': 'New piece of material inserted',
  'wizard.slots.newPieceTooltip': 'Resets the position counter: the next test is cut at the top left again',

  // ---- Cutting
  'wizard.running.gridStep': 'Cut {n} of {total}',

  // ---- Step 2: rate
  'wizard.rate.intro': 'Trial {n} is cut. Carefully peel off the material and check the cut.',
  'wizard.rate.question': 'How is the cut?',
  'wizard.rate.good': 'Looks good – save',
  'wizard.rate.gridIntro': 'Grid cut. Which number (tick marks) cut best? The values of that variant are taken over.',
  'wizard.rate.gridNone': 'None fits – set up the grid again',
  'wizard.verdict.good': 'Good',
  'wizard.verdict.notThrough': 'Not cut through',
  'wizard.verdict.tooDeep': 'Too deep',
  'wizard.verdict.cornersTorn': 'Corners torn',
  'wizard.verdict.liftsOff': 'Material lifts off',
  'wizard.verdict.tip.notThrough': 'The material is still connected or hard to release',
  'wizard.verdict.tip.tooDeep': 'The backing or mat is cut deeply',
  'wizard.verdict.tip.cornersTorn': 'The material tears or distorts at corners and curves',
  'wizard.verdict.tip.liftsOff': 'The material shifts or comes off the backing while cutting',

  // ---- Step 3: adjust
  'wizard.adjust.verdict': 'Verdict: {verdict}',
  'wizard.adjust.suggestion': 'Suggestion',
  'wizard.adjust.changedLegend': 'Values marked in orange change compared with the last test (old → new).',
  'wizard.adjust.noChange': 'No change from the last test – it will be cut with the same values.',
  'wizard.adjust.suggestionTooltip': 'Restore the suggested values',
  'wizard.adjust.rerate': 'Change rating',
  'wizard.adjust.toGrid': 'Test as a grid instead',
  'wizard.adjust.toGridTooltip': 'Cut several variants in a row and pick the best one',
  'wizard.reason.good': 'The values stay unchanged.',
  'wizard.reason.notThrough': 'More force (+2) so the blade cuts all the way through.',
  'wizard.reason.notThroughPasses': 'Force is already high – one more pass instead, so the blade cuts all the way through.',
  'wizard.reason.tooDeep': 'Less force (−2) to spare the backing and mat.',
  'wizard.reason.tooDeepBlade': 'Less force (−2) and a shallower blade depth (−1) to spare the backing and mat.',
  'wizard.reason.tooDeepBladeManual': 'Less force (−2) and turn the blade back one step on the holder (−1) to spare the backing and mat.',
  'wizard.reason.cornersTorn': 'Slower (−1) and slightly less force (−1): the blade follows corners more cleanly and does not tear the material.',
  'wizard.reason.liftsOff': 'Slower (−1): less pull on the material, so it stays on the backing better.',
  'wizard.reason.limit': 'The values are already at the edge of the possible range – please adjust differently (e.g. check the blade or material).',

  // ---- Step 4: save
  'wizard.save.intro': '{n, plural, one {The values fit after # test.} other {The values fit after # tests.}} Save them as a material profile.',
  'wizard.save.back': 'Back to rating',
  'wizard.save.history': 'Wizard: {n, plural, one {# trial} other {# trials}}, force {force}, speed {speed}',
  'wizard.save.historyNote': 'Appended to the note: {history}',
  'wizard.save.done': 'Profile “{name}” saved – the values are now active.',
  'wizard.save.applied': 'Values applied (not saved as a profile yet).',

  // ---- Buttons
  'wizard.btn.cutSingle': 'Start test cut',
  'wizard.btn.cutGrid': 'Cut grid',
  'wizard.btn.cutNext': 'Cut next test',
  'wizard.btn.cutSame': 'Same values again',
  'wizard.btn.cutSameTooltip': 'Cut once more with the values of the last test',
  'wizard.btn.cutConfirm': 'Cut again to confirm',
  'wizard.btn.cutConfirmTooltip': 'Cut one more single test with these values before saving',
  'wizard.btn.apply': 'Only apply values',
  'wizard.btn.applyTooltip': 'Copy the values to the cut settings without saving a profile',
  'wizard.btn.save': 'Save as profile',
  'wizard.btn.back': 'Back',
  'wizard.btn.reset': 'Start over',
  'wizard.reset.tooltip': 'Discard all trials and settings of the wizard',
  'wizard.reset.title': 'Reset wizard',
  'wizard.reset.message': 'Discard all previous trials and settings of the wizard?',
  'wizard.reset.confirm': 'Discard',

  // ---- Table of trials
  'wizard.table.title': 'Trials so far',
  'wizard.table.no': 'No.',
  'wizard.table.verdict': 'Verdict',
  'wizard.table.open': 'open',
  'wizard.table.grid': 'Grid {n}'
}
