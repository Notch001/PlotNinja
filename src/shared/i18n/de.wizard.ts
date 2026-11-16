/** Deutsche Texte des Einmess-Assistenten „Material einmessen“ (wizard.*); in de.ts eingebunden. */
export const deWizard = {
  // ---- Auslöser im Panel „Schnitteinstellungen“
  'wizard.open': 'Material einmessen',
  'wizard.open.tooltip': 'Schneidet kleine Testformen, bewertet sie mit dir und findet Schritt für Schritt passende Werte – am Ende als Materialprofil speichern',

  // ---- Dialog: Titel
  'wizard.aria': 'Material einmessen',
  'wizard.title.setup': 'Material einmessen – Startwerte',
  'wizard.title.rate': 'Material einmessen – Test bewerten',
  'wizard.title.adjust': 'Material einmessen – Werte anpassen',
  'wizard.title.save': 'Material einmessen – Profil speichern',
  'wizard.title.running': 'Testschnitt läuft …',
  'wizard.title.paused': 'Pausiert – Medium prüfen',
  'wizard.title.cancelled': 'Abgebrochen',
  'wizard.title.error': 'Fehler',
  'wizard.mat.aria': 'Vorschau der Testschnitte auf der Arbeitsfläche',
  'wizard.close.tooltip': 'Schließen – der Stand bleibt erhalten, bis die App beendet wird',

  // ---- Schritt 1: Startwerte und Testart
  'wizard.setup.intro': 'Der Assistent schneidet kleine Testformen mit deinen Startwerten. Du bewertest das Ergebnis, die Werte werden angepasst – so lange, bis der Schnitt passt. Am Ende speicherst du sie als Materialprofil. Die Werte hier ändern deine aktuellen Einstellungen nicht.',
  'wizard.setup.startFrom': 'Startwerte von',
  'wizard.setup.startCurrent': 'Aktuelle Einstellungen',
  'wizard.mode.aria': 'Testart',
  'wizard.mode.single': 'Einzeltests nacheinander',
  'wizard.mode.singleTooltip': 'Ein Testmuster nach dem anderen schneiden und jeweils bewerten',
  'wizard.mode.grid': 'Raster (Reihe)',
  'wizard.mode.gridTooltip': 'Eine Reihe kleiner Quadrate mit steigendem Druck, Tempo oder steigender Klinge in einem Zug schneiden',
  'wizard.mode.singleHint': 'Schneidet das Testmuster (Quadrat, Dreieck, Kreis) mit Strichmarken darüber, die die Versuchsnummer zeigen. Jeder Test kommt neben den vorherigen.',
  'wizard.grid.param.aria': 'Variierter Wert',
  'wizard.grid.bladeManual': 'Bei von Hand eingestellter Klinge nicht möglich – das Programm kann sie nicht verstellen',
  'wizard.grid.start': 'Start',
  'wizard.grid.step': 'Schritt',
  'wizard.grid.count': 'Anzahl',
  'wizard.grid.variants': 'Varianten ({param}): {list}',
  'wizard.grid.hint': 'Schneidet eine Reihe kleiner Quadrate nacheinander, jedes mit seiner Nummer als Strichmarken darüber. Danach wählst du die Nummer, die am besten geschnitten hat.',
  'wizard.grid.variantLabel': 'Nr. {n} · {param} {value}',
  'wizard.note.label': 'Notiz (z. B. Klinge, Matte)',
  'wizard.note.placeholder': 'z. B. rote Klinge, neue Matte',

  // ---- Ausfahren (nur Assistent)
  'wizard.eject.label': 'Material nach dem Test genau passend ausfahren',
  'wizard.eject.tooltip': 'Fährt nach dem Schnitt so weit vor, dass du den Test abziehen kannst. Gilt nur für den Assistenten und ändert die Einstellung „Nach dem Schneiden“ nicht.',
  'wizard.eject.distance': 'Zusatz',
  'wizard.eject.hint': 'Nach dem Ausfahren das Material wieder an dieselbe Stelle einlegen, wenn die Platzzählung weiterlaufen soll. Bei einem neuen Stück unten „Neues Materialstück eingelegt“ wählen.',

  // ---- Platz auf dem Material
  'wizard.slots.status': '{used} von {total} Testplätzen belegt',
  'wizard.slots.full': 'Material voll – neues Stück einlegen',
  'wizard.slots.fullGrid': 'Für das Raster ist keine freie Zeile mehr oder die Fläche zu schmal – neues Stück einlegen',
  'wizard.slots.newPiece': 'Neues Materialstück eingelegt',
  'wizard.slots.newPieceTooltip': 'Setzt die Platzzählung zurück: der nächste Test wird wieder oben links geschnitten',

  // ---- Schneiden
  'wizard.running.gridStep': 'Schnitt {n} von {total}',

  // ---- Schritt 2: Bewerten
  'wizard.rate.intro': 'Versuch {n} ist geschnitten. Folie vorsichtig abziehen und den Schnitt prüfen.',
  'wizard.rate.question': 'Wie ist der Schnitt?',
  'wizard.rate.good': 'Passt – speichern',
  'wizard.rate.gridIntro': 'Raster geschnitten. Welche Nummer (Strichmarken) hat am besten geschnitten? Die Werte dieser Variante werden übernommen.',
  'wizard.rate.gridNone': 'Keine passt – Raster neu einstellen',
  'wizard.verdict.good': 'Passt',
  'wizard.verdict.notThrough': 'Nicht durchgeschnitten',
  'wizard.verdict.tooDeep': 'Zu tief',
  'wizard.verdict.cornersTorn': 'Ecken ausgerissen',
  'wizard.verdict.liftsOff': 'Folie hebt sich ab',
  'wizard.verdict.tip.notThrough': 'Die Folie hängt noch zusammen oder lässt sich nur mit Mühe lösen',
  'wizard.verdict.tip.tooDeep': 'Trägerpapier oder Matte sind stark eingeschnitten',
  'wizard.verdict.tip.cornersTorn': 'An Ecken und Kurven reißt oder verzieht sich die Folie',
  'wizard.verdict.tip.liftsOff': 'Die Folie verrutscht oder löst sich beim Schneiden vom Träger',

  // ---- Schritt 3: Anpassen
  'wizard.adjust.verdict': 'Urteil: {verdict}',
  'wizard.adjust.suggestion': 'Vorschlag',
  'wizard.adjust.suggestionTooltip': 'Die vorgeschlagenen Werte wiederherstellen',
  'wizard.adjust.rerate': 'Bewertung ändern',
  'wizard.adjust.toGrid': 'Stattdessen als Raster testen',
  'wizard.adjust.toGridTooltip': 'Mehrere Varianten in einer Reihe schneiden und die beste wählen',
  'wizard.reason.good': 'Die Werte bleiben unverändert.',
  'wizard.reason.notThrough': 'Mehr Druck (+2), damit das Messer ganz durchschneidet.',
  'wizard.reason.notThroughPasses': 'Der Druck ist schon hoch – stattdessen ein Durchgang mehr, damit das Messer ganz durchschneidet.',
  'wizard.reason.tooDeep': 'Weniger Druck (−2), damit Träger und Matte geschont werden.',
  'wizard.reason.tooDeepBlade': 'Weniger Druck (−2) und eine flachere Klingentiefe (−1), damit Träger und Matte geschont werden.',
  'wizard.reason.tooDeepBladeManual': 'Weniger Druck (−2) und die Klinge am Messer eine Stufe zurückdrehen (−1), damit Träger und Matte geschont werden.',
  'wizard.reason.cornersTorn': 'Langsamer (−1) und etwas weniger Druck (−1): so folgt das Messer Ecken sauberer und reißt die Folie nicht aus.',
  'wizard.reason.liftsOff': 'Langsamer (−1): weniger Zug an der Folie, sie bleibt besser am Träger.',
  'wizard.reason.limit': 'Die Werte sind schon am Rand des möglichen Bereichs – bitte anders anpassen (z. B. Klinge oder Material prüfen).',

  // ---- Schritt 4: Speichern
  'wizard.save.intro': '{n, plural, one {Nach # Test passen die Werte.} other {Nach # Tests passen die Werte.}} Speichere sie als Materialprofil.',
  'wizard.save.back': 'Zurück zur Bewertung',
  'wizard.save.history': 'Wizard: {n, plural, one {# Versuch} other {# Versuche}}, Druck {force}, Geschwindigkeit {speed}',
  'wizard.save.historyNote': 'Wird an die Notiz angehängt: {history}',
  'wizard.save.done': 'Profil „{name}“ gespeichert – die Werte sind jetzt aktiv.',
  'wizard.save.applied': 'Werte übernommen (noch nicht als Profil gespeichert).',

  // ---- Schaltflächen
  'wizard.btn.cutSingle': 'Testschnitt starten',
  'wizard.btn.cutGrid': 'Raster schneiden',
  'wizard.btn.cutNext': 'Nächsten Test schneiden',
  'wizard.btn.cutSame': 'Gleiche Werte nochmal',
  'wizard.btn.cutSameTooltip': 'Noch einmal mit den Werten des letzten Tests schneiden',
  'wizard.btn.cutConfirm': 'Zur Bestätigung nochmal schneiden',
  'wizard.btn.cutConfirmTooltip': 'Einen weiteren Einzeltest mit diesen Werten schneiden, bevor du speicherst',
  'wizard.btn.apply': 'Nur Werte übernehmen',
  'wizard.btn.applyTooltip': 'Die Werte in die Schnitteinstellungen übernehmen, ohne ein Profil zu speichern',
  'wizard.btn.save': 'Als Profil speichern',
  'wizard.btn.back': 'Zurück',
  'wizard.btn.reset': 'Neu beginnen',
  'wizard.reset.tooltip': 'Alle Versuche und Einstellungen des Assistenten verwerfen',
  'wizard.reset.title': 'Assistent zurücksetzen',
  'wizard.reset.message': 'Alle bisherigen Versuche und Einstellungen des Assistenten verwerfen?',
  'wizard.reset.confirm': 'Verwerfen',

  // ---- Tabelle der Versuche
  'wizard.table.title': 'Bisherige Versuche',
  'wizard.table.no': 'Nr.',
  'wizard.table.verdict': 'Urteil',
  'wizard.table.open': 'offen',
  'wizard.table.grid': 'Raster {n}'
}
