# PlotNinja

PlotNinja ist eine Windows-Desktop-App (Electron, TypeScript, React) zum Ansteuern eines
**Silhouette Cameo** Schneideplotters per USB. SVG-Dateien werden per Drag & Drop auf eine Arbeitsfläche
gezogen, angeordnet, ausgerichtet und direkt geschnitten – ganz ohne Silhouette Studio.

Funktionen:

- SVG-Import (Pfade, Formen, Transformationen, Einheiten); mehrere Bauteile in einer Datei werden automatisch getrennt
- Anordnen: Ausrichten, Verteilen, automatische Platzierung, Skalieren und Drehen
- Schnittparameter: Druck, Geschwindigkeit, Durchgänge, Überschnitt
- Eingebauter **Simulator**, um ohne Plotter zu testen

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

- Nur **SVG** wird importiert (kein DXF, PDF, Studio-Dateien); Text und Bilder werden ignoriert – Text vorher in Pfade umwandeln.
- Die GP-GL-Ansteuerung (nach dem Vorbild von [inkscape-silhouette](https://github.com/fablabnbg/inkscape-silhouette))
  ist **an echter Hardware ungetestet**. Bitte zuerst mit dem Simulator und dann mit Probeschnitten auf Abfallmaterial testen.
- Klingentiefe wird nicht automatisch gesteuert (manuelles Messer); Druck und Geschwindigkeit werden gesendet.
- Keine Registriermarken (Print & Cut).
