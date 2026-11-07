# PlotNinja

PlotNinja ist eine Windows-Desktop-App (Electron, TypeScript, React) zum Ansteuern eines
**Silhouette Cameo** Schneideplotters per USB. SVG-Dateien werden per Drag & Drop auf eine Arbeitsfläche
gezogen, angeordnet, ausgerichtet und direkt geschnitten – ganz ohne Silhouette Studio.

Funktionen:

- **Import von SVG, DXF und PDF** (Drag & Drop, Doppelklick, ganze Ordner); jede Datei wird als **ein** Bauteil importiert. Details siehe „Dateiformate“
- **Projekte**: Arbeitsfläche speichern und wieder öffnen (`.plotninja`), mit Datei-Menü, Kürzeln, Zuletzt-geöffnet-Liste, Ungespeichert-Abfrage und automatischer Sicherung. Siehe „Projekte“
- SVG-Import (Pfade, Formen, Transformationen, `<use>`, einfache CSS-Klassen, Einheiten); jede Datei wird als **ein** Bauteil mit der originalen Anordnung importiert – mehrere Dateien oder ganze Ordner auf einmal ziehen ergibt je Datei ein Bauteil, überlappungsfrei platziert
- Beim Import werden überlappende, gefüllte Konturen vereinigt („Weld“, wie in Silhouette Studio): Linien innerhalb von Buchstaben verschwinden, echte Löcher (P, A, 0 …) bleiben. Ungefüllte (`fill="none"`) und offene Pfade bleiben unverändert. Schalter „Überlappungen vereinen“ in der Kopfzeile, nachträglich per „Konturen vereinen (Weld)“ im Auswahl-Panel
- Bauteil bei Bedarf mit „In Einzelteile zerlegen“ (Auswahl-Panel oder Kopfzeile) in zusammengehörige Einzelteile trennen; die Anordnung bleibt erhalten, Strg+Z macht es rückgängig
- Anordnen: Ausrichten, Verteilen, automatische Platzierung, Skalieren und Drehen
- **Gruppen**: mehrere Teile wählen und mit „Gruppieren“ (Strg+G, Kopfzeile oder Auswahl-Panel) zu einer Einheit verbinden; „Gruppierung aufheben“ mit Strg+Umschalt+G. Ein Klick wählt die ganze Gruppe; Verschieben, Skalieren, Drehen, Pfeiltasten, Duplizieren (Kopie = neue Gruppe), Löschen, Ausrichten, Verteilen, Einrasten, „Automatisch anordnen“ und die Außerhalb-Markierung behandeln sie als **eine** Einheit (Gruppen-Bounding-Box, relative Lage der Mitglieder bleibt exakt erhalten). Doppelklick auf eine Gruppe wählt vorübergehend nur das angeklickte Teil (Klick daneben beendet das). Der Schnitt läuft Gruppe für Gruppe, Mitglieder werden zusammenhängend geschnitten. Gruppen sind flach (keine Gruppen in Gruppen) und werden in Projektdateien mitgespeichert
- „In Einzelteile zerlegen“ erzeugt Einzelteile **ohne** Gruppe (danach direkt mit Strg+G wieder zusammenfassbar). Auf einer Gruppe oder einem Gruppenmitglied ist die Funktion bewusst deaktiviert: erst die Gruppierung aufheben
- „Automatisch anordnen“ ändert nur die Position (x/y); Pfade, Maßstab und Drehung bleiben unverändert. Einzelteile (z. B. nach dem Zerlegen) werden dabei einzeln gepackt – wer will, dass sie zusammenbleiben, gruppiert sie vorher
- Schnittparameter: Druck, Geschwindigkeit, Durchgänge, Überschnitt
- Eingebauter **Simulator**, um ohne Plotter zu testen; **Testschnitt**-Button zum Prüfen von Druck und Klinge; AutoBlade-Klingentiefe bei unterstützten Modellen

## Dateiformate

| Format | Was wird gelesen | Hinweise |
| --- | --- | --- |
| SVG | Pfade, Formen, Transformationen, `<use>`, einfache CSS-Klassen | Text und Bilder werden ignoriert; Weld beim Import je nach Schalter |
| DXF (ASCII) | LINE, LWPOLYLINE/POLYLINE (inkl. Bulge-Bögen), CIRCLE, ARC, ELLIPSE, SPLINE (als Polylinie angenähert), INSERT/Blöcke (mit Verschiebung, Drehung, Maßstab, Reihen/Spalten) | Einheit aus `$INSUNITS` (mm, cm, m, Zoll, Fuß u. a.; ohne Angabe mm), y-Achse wird umgedreht. Lose Linien/Bögen werden bei Endpunktabstand ≤ 0,01 mm zu Konturen verbunden, geschlossen wenn Start = Ende. Ausgeblendete/eingefrorene Layer und Papierbereich werden übersprungen. Konturen bleiben unverändert (kein automatisches Weld). Text, Schraffuren, Bemaßungen und Bilder werden ignoriert (mit Hinweis) |
| PDF | Vektorpfade der **ersten Seite** (Füll- und Strichpfade, Kurven, Rechtecke, Transformationen, Form-XObjects) | 1 pt = 0,3528 mm, y-Achse wird umgedreht, Farben werden nicht beachtet. Seitenfüllendes Hintergrundrechteck und Clip-Pfade werden ignoriert. Hat das PDF mehrere Seiten oder enthält es Text/Bilder, erscheint ein Hinweis; Text vorher in Pfade umwandeln. Weld wie bei SVG für gefüllte Formen |
| `.plotninja` | Projektdatei | siehe „Projekte“ |

Der Dateibaum zeigt `.svg`, `.dxf`, `.pdf` und `.plotninja`; DXF und PDF haben dort ein Symbol statt einer Vorschau. Nicht lesbare Dateien melden „Datei X konnte nicht gelesen werden: …“, die übrigen Dateien werden trotzdem importiert.

## Projekte

- **Datei-Menü** in der Kopfzeile: Neu (Strg+N), Öffnen … (Strg+O), Speichern (Strg+S), Speichern unter … (Strg+Umschalt+S), Zuletzt geöffnet (die letzten 10, nicht mehr vorhandene Dateien verschwinden aus der Liste).
- Eine Projektdatei (`.plotninja`, JSON mit `format: "plotninja-project"` und `version: 1`) enthält alle Bauteile samt Pfaden, Position, Drehung, Maßstab und Gruppen, die Arbeitsfläche, die Schnitteinstellungen und den Schalter „Überlappungen vereinen“. Fehlende Felder werden mit Standardwerten ergänzt; Dateien aus einer neueren Version, Nicht-Projekt-Dateien und beschädigte Dateien werden mit einer verständlichen Meldung abgelehnt.
- Der Fenstertitel zeigt „PlotNinja – Name“, ein `*` weist auf ungespeicherte Änderungen hin. Bei Neu, Öffnen und Schließen des Fensters fragt PlotNinja nach, ob gespeichert werden soll. Beim Öffnen wird der Rückgängig-Verlauf geleert.
- Öffnen geht auch per Drag & Drop einer `.plotninja`-Datei auf das Fenster und per Doppelklick im Explorer (der Installer ordnet `.plotninja` PlotNinja zu; läuft die App schon, öffnet sich die Datei im vorhandenen Fenster).
- **Automatische Sicherung**: Gibt es ungespeicherte Änderungen, legt PlotNinja alle 60 Sekunden eine Sicherung `autosave.plotninja` im Datenordner der App an (Windows: `%APPDATA%\PlotNinja`). Wurde die App nicht ordnungsgemäß beendet, bietet sie beim nächsten Start „Letzte Sitzung wiederherstellen?“ an. Die Sicherung wird nach Speichern, Neu, Öffnen und sauberem Beenden gelöscht.

## Entwicklung

Voraussetzung: Node.js 22.

```bash
npm install
npm run dev        # Entwicklungsmodus mit Hot Reload
npm test           # Unit-Tests (vitest)
npm run typecheck  # TypeScript-Prüfung
npm run build      # main, preload und renderer nach out/ bauen
npm run dist       # Windows-Installer (NSIS) nach release/ bauen
```

Projektstruktur:

- `src/core` – reine TypeScript-Logik (SVG-Import, Layout, Jobaufbau, GP-GL), läuft auch im Renderer
- `src/main` – Electron-Hauptprozess, Dateizugriff, Einstellungen, Plotter-Anbindung (USB und Simulator)
- `src/preload` – sichere Brücke (`window.api`)
- `src/renderer` – Benutzeroberfläche
- `src/shared` – gemeinsame Typen und IPC-Kanäle

## Updates

Die installierte App sucht drei Sekunden nach dem Start und danach alle 4 Stunden auf GitHub (Releases) nach einer neuen Version, lädt sie automatisch herunter und fragt dann, ob neu gestartet werden soll (sonst wird beim nächsten Beenden aktualisiert). Versionen ab 0.1.7 aktualisieren sich selbst; ältere müssen einmalig von Hand neu installiert werden.

Rechts in der Kopfzeile stehen die Versionsnummer und der Update-Status. Ein Klick darauf sucht sofort nach Updates und meldet das Ergebnis; ist ein Update bereit, startet der Klick die Installation. In der Entwicklungsumgebung (`npm run dev`) sind Updates deaktiviert.

Jedes Update-Ereignis wird mit Zeitstempel in `update.log` im Datenordner der App protokolliert (Windows: `%APPDATA%\PlotNinja\update.log`).

## AutoBlade, Testschnitt und Fehlermeldungen

**AutoBlade.** Modelle mit AutoBlade (Cameo 3, Cameo 4 / 4 Plus / 4 Pro, Portrait 3) stellen die Klingentiefe selbst ein. PlotNinja sendet dafür den Wert aus „Klinge“ (1–10) als Tool-Depth-Befehl `TF<Tiefe>,1`, direkt nach dem Messer-Offset (`FC`) im Setup, also vor dem Schneiden – so wie in inkscape-silhouette (`Graphtec.py`, Wertebereich 0–10, 1:1 übernommen). In der Karte „Schnitteinstellungen“ steht dann „Klingentiefe (automatisch eingestellt)“. Bei Modellen ohne AutoBlade (Cameo 1/2, Portrait 1/2, Curio) wird nichts gesendet; die Karte zeigt „Klinge – bitte am Messer manuell einstellen auf Stufe N“. Beim Simulator ist das Modell unbekannt, es erscheint kein Hinweis. Die App prüft nicht, ob wirklich eine AutoBlade eingesetzt ist (die Referenz fragt dafür die Werkzeugbestückung ab).

**Testschnitt.** Der Button „Testschnitt“ in der Karte „Schnitteinstellungen“ schneidet ein kleines Muster (Quadrat 20 × 20 mm mit Dreieck innen, daneben ein Kreis mit 25 mm) in die obere linke Mattenecke (ab x = 10 mm, y = 10 mm) mit den aktuellen Schnitteinstellungen – ohne dein Projekt. Er läuft durch denselben Schneiden-Dialog mit Live-Ansicht und funktioniert auch im Simulator. Auch dafür gilt: Abfallmaterial auflegen.

**Fehlermeldungen und Robustheit.**

- Kein Medium eingelegt: Im Leerlauf erscheint ein Hinweis und „Schneiden“/„Testschnitt“ sind gesperrt. Wird das Medium erst nach dem Start vor dem ersten Schnitt vermisst, zeigt der Dialog „Pausiert – Medium prüfen“ mit Anleitung (Matte einlegen, Lade-Taste drücken) und den Knöpfen „Weiter“ / „Abbrechen“. Verschwindet das Medium **während** des Schneidens, wird sicher abgebrochen und erklärt, warum ein Fortsetzen nicht möglich ist (die Matte kann ihre Position verloren haben).
- Plotter getrennt (Kabel gezogen, ausgeschaltet): Der Auftrag wird abgebrochen, der Status wechselt auf „Getrennt“, eine Meldung erklärt es; die App bleibt benutzbar und der Plotter lässt sich neu verbinden. Das gilt auch im Leerlauf.
- Zeitüberschreitungen und USB-Fehler werden mit verständlichen deutschen Texten gemeldet. Alle Gerätefehler (inkl. LIBUSB-Fehlercodes) stehen mit Zeitstempel in `plotter.log` im Datenordner der App (Windows: `%APPDATA%\PlotNinja\plotter.log`).
- Fehlerpfade testen ohne Hardware: Der Simulator versteht die Umgebungsvariable `PLOTNINJA_SIM_FAULT` (`no-media`, `media-lost`, `disconnect`), z. B. `PLOTNINJA_SIM_FAULT=disconnect npm run dev`. Im reinen Browser-Modus (Mock) geht das über `?fault=no-media` an der URL.

## Windows: Treiber für den Plotter

Windows verwendet für den Silhouette-Plotter standardmäßig keinen Treiber, den PlotNinja nutzen kann.
Einmalig einrichten:

1. Plotter per USB anschließen und einschalten.
2. [Zadig](https://zadig.akeo.ie) starten, im Menü *Options → List All Devices* aktivieren.
3. Das Gerät **„Silhouette Cameo“** (bzw. das passende Modell) auswählen.
4. Als Ziel-Treiber **WinUSB** wählen und auf *Replace Driver* / *Install Driver* klicken.

Hinweise:

- **Silhouette Studio muss geschlossen sein**, solange PlotNinja den Plotter benutzt (der Plotter erlaubt nur einen Zugriff).
- Nach dem Ersetzen des Treibers funktioniert der Plotter nicht mehr mit Silhouette Studio, bis der
  ursprüngliche Treiber über den Windows-Geräte-Manager wiederhergestellt wird.
- Meldungen wie `LIBUSB_ERROR_NOT_SUPPORTED`, `ACCESS` oder `NOT_FOUND` beim Verbinden deuten auf einen fehlenden WinUSB-Treiber hin.

Unterstützte Modelle (USB-Vendor 0x0b4d): Cameo 1 bis 4 (inkl. 4 Plus/Pro), Portrait 1 bis 3, Curio.

## Bekannte Grenzen

- Importiert werden SVG, DXF (ASCII) und PDF (erste Seite), keine Studio-Dateien; Text und Bilder werden ignoriert – Text vorher in Pfade umwandeln. Binäre DXF-Dateien, DXF-Schraffuren/SOLID und PDF-Schraffurmuster/Verläufe werden nicht gelesen.
- Die GP-GL-Ansteuerung (nach dem Vorbild von [inkscape-silhouette](https://github.com/fablabnbg/inkscape-silhouette))
  ist **an echter Hardware ungetestet**. Bitte zuerst mit dem Simulator und dann mit Probeschnitten auf Abfallmaterial testen.
- Klingentiefe: nur Modelle mit AutoBlade (Cameo 3, Cameo 4-Familie, Portrait 3) bekommen sie per `TF` gesendet; bei allen anderen muss die Klinge von Hand am Messer eingestellt werden (siehe unten). Die Befehlsreihenfolge ist an echter Hardware ungetestet.
- Keine Registriermarken (Print & Cut).
- Beim Zerlegen gelten geschlossene Konturen als zusammengehörig, wenn sie ineinander liegen (Löcher) oder sich überlappen; offene Linien kommen zum umschließenden Teil. Getrennte Teile eines Buchstabens (z. B. i-Punkt) werden beim Zerlegen zu eigenen Bauteilen.
- Fortschritt am echten Plotter: PlotNinja fragt den Status (ESC 0x05) ab und meldet einen Pfad erst als geschnitten, wenn der Plotter wieder bereit ist; die Anzeige zwischen den Meldungen ist eine Schätzung.
