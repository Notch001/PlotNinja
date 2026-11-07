/** Deutsche Texte des Schneiden-Dialogs (cut.*) und der Overlays (overlay.*); in de.ts eingebunden. */
export const deCut = {
  // ---- Schneiden-Dialog: Titel und Kopf
  'cut.dialog.aria': 'Schneiden',
  'cut.title.summary': 'Schnitt vorbereiten',
  'cut.title.summaryTest': 'Testschnitt vorbereiten',
  'cut.title.running': 'Schneide …',
  'cut.title.runningTest': 'Testschnitt läuft …',
  'cut.title.paused': 'Pausiert – Medium prüfen',
  'cut.title.done': 'Fertig',
  'cut.title.cancelled': 'Abgebrochen',
  'cut.title.error': 'Fehler',
  'cut.close': 'Schließen',
  'cut.close.disabled': 'Während des Schneidens nicht möglich – bitte zuerst abbrechen',
  'cut.mirrored': 'gespiegelt',

  // ---- Zeitformate
  'cut.duration.s': '{s} s',
  'cut.duration.minS': '{m} min {s} s',
  'cut.duration.hMin': '{h} h {m} min',
  'cut.approx': 'ca. {value}',

  // ---- Zusammenfassung
  'cut.sum.content': 'Inhalt',
  'cut.sum.contentTest': 'Testschnitt',
  'cut.sum.parts': 'Bauteile',
  'cut.sum.partsOf': '{n} von {total}',
  'cut.sum.length': 'Schnittlänge',
  'cut.sum.lengthValue': '{cm} cm',
  'cut.sum.lengthPasses': '{cm} cm × {passes}',
  'cut.sum.workArea': 'Arbeitsfläche',
  'cut.sum.workAreaValue': '{w} × {h} mm',
  'cut.sum.device': 'Gerät',
  'cut.sum.estimate': 'Geschätzte Dauer',
  'cut.blade.auto': 'Klingentiefe',
  'cut.blade.autoSuffix': '(auto)',
  'cut.blade.auto.tooltip': 'Der Cameo stellt die Klinge selbst ein',
  'cut.blade.manual': 'Klinge manuell',
  'cut.blade.manual.tooltip': 'Bitte am Messer von Hand einstellen',
  'cut.setting.force': 'Druck',
  'cut.setting.speed': 'Tempo',
  'cut.setting.passes': 'Durchgänge',
  'cut.setting.overcut': 'Überschnitt',

  // ---- Optionen
  'cut.scope.aria': 'Was schneiden',
  'cut.scope.all': 'Alle Teile ({n})',
  'cut.scope.all.tooltip': 'Alle Bauteile der Arbeitsfläche schneiden',
  'cut.scope.selection': 'Nur Auswahl ({n})',
  'cut.scope.selection.tooltip': 'Nur die gewählten Bauteile schneiden – alles andere bleibt unberührt',
  'cut.scope.selection.empty': 'Zum Schneiden einer Auswahl zuerst Bauteile auf der Arbeitsfläche wählen',
  'cut.optimize': 'Schnittreihenfolge optimieren',
  'cut.optimize.tooltip': 'Nächstgelegene Konturen zuerst, innere vor äußeren. Aus: Reihenfolge der Bauteile in der Liste.',
  'cut.mirror': 'Gesamten Auftrag spiegeln (Rückseiten-Schnitt)',
  'cut.mirror.tooltip': 'Spiegelt den gesamten Auftrag an der Mitte der Matte – für Folie, die mit der Rückseite nach oben liegt. Das Dokument bleibt unverändert.',
  'cut.mirror.hint': 'Der Auftrag wird links/rechts an der Mattenmitte gespiegelt (siehe Vorschau). Nur der Schnitt ist gespiegelt, nicht dein Dokument.',
  'cut.eject': 'Material nach dem Schneiden ausfahren',
  'cut.eject.tooltip': 'Fährt das Material nach dem Schneiden hinten aus dem Plotter, damit es dort abgeschnitten werden kann. Nur bei Rollenmaterial, nicht mit Matte.',
  'cut.crossCut': 'Anschließend abschneiden (Quermesser) – nur von Hand',
  'cut.crossCut.tooltip': 'Ein Befehl zum automatischen Abschneiden ist nicht bekannt: Das Quermesser (Cameo 4: Schieber hinten, Cameo 2/3: Zubehör) wird nach dem Ausfahren von Hand durchgezogen.',

  // ---- Hinweise
  'cut.hint.test': 'Geschnitten wird ein kleines Muster (Quadrat 20 × 20 mm mit Dreieck und ein Kreis, ca. 25 mm) in der oberen linken Ecke der Matte, ab x = 10 mm, y = 10 mm. Lege dafür Abfallmaterial auf diese Stelle und prüfe danach, ob Druck und Klinge passen. Dein Projekt wird nicht geschnitten.',
  'cut.hint.prepare': 'Material auflegen, Matte einlegen und Klinge prüfen. Das Schneiden kann jederzeit abgebrochen werden. Tipp: Mit „Testschnitt“ in den Schnitteinstellungen lassen sich Druck und Klinge vorher an Abfallmaterial prüfen.',
  'cut.hint.noMedia': 'Im Plotter ist kein Medium eingelegt. Matte einlegen und am Plotter die Lade-Taste drücken.',
  'cut.hint.disconnected': 'Der Plotter ist nicht verbunden.',
  'cut.hint.deviceError': 'Der Plotter meldet einen Fehler oder antwortet nicht.',
  'cut.paused.next': 'Danach hier auf „Weiter“ klicken. Es wurde noch nichts geschnitten.',

  // ---- Fortschritt
  'cut.progress.cut': 'Geschnitten',
  'cut.progress.cutValue': '{done} von {total} cm',
  'cut.progress.paths': 'Pfade',
  'cut.progress.pathsValue': '{done} von {total}',
  'cut.progress.remaining': 'Restzeit',
  'cut.progress.duration': 'Dauer',
  'cut.running.cancelling': 'Wird abgebrochen …',
  'cut.running.ejecting': 'Material wird ausgefahren …',
  'cut.running.warn': 'Bitte den Plotter nicht ausschalten und die Matte nicht berühren.',
  'cut.done.ejected': 'Schnitt abgeschlossen, Material ausgefahren. Ein vorhandenes Quermesser jetzt von Hand durchziehen.',
  'cut.done.plain': 'Schnitt abgeschlossen. Du kannst das Material jetzt entnehmen.',
  'cut.cancelled': 'Der Schnitt wurde abgebrochen.',

  // ---- Fehler
  'cut.error.lost': 'Verbindung zum Plotter verloren.',
  'cut.error.failedTest': 'Der Testschnitt ist fehlgeschlagen.',
  'cut.error.failed': 'Der Schnitt ist fehlgeschlagen.',
  'cut.error.lostHint': 'Die App bleibt benutzbar; nach dem Wiederverbinden kannst du erneut starten.',
  'cut.error.startFailed': 'Der Schnitt konnte nicht gestartet werden.',
  'cut.error.cancelFailed': 'Abbrechen fehlgeschlagen: {message}',
  'cut.error.resumeFailed': 'Fortsetzen fehlgeschlagen: {message}',

  // ---- Fußzeile
  'cut.btn.cancel': 'Abbrechen',
  'cut.btn.cancelling': 'Breche ab …',
  'cut.btn.start': 'Jetzt schneiden',
  'cut.btn.startTest': 'Testschnitt starten',
  'cut.btn.notReady': 'Der Plotter ist nicht bereit',
  'cut.btn.nothing': 'Es gibt nichts zu schneiden',
  'cut.btn.resume': 'Weiter',
  'cut.btn.back': 'Zurück zur Übersicht',

  // ---- Overlays (Toasts, Fortschrittsleiste, Dialoge)
  'overlay.busy.progress': '{done} von {total}',
  'overlay.dialog.close': 'Schließen',
  'overlay.dialog.cancel': 'Abbrechen',
  'overlay.dialog.discard': 'Nicht speichern'
}
