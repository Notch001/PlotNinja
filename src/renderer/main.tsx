import React from 'react'
import { createRoot } from 'react-dom/client'
import { installMockApi } from './mockApi'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initLanguage } from './lib/language'
import './styles.css'

// Im reinen Browser (ohne Electron/Preload) simuliert mockApi das Backend.
installMockApi()
// Sprache vor dem ersten Rendern setzen (zuletzt gewählte bzw. Systemsprache); die gespeicherte Wahl folgt mit den Einstellungen
initLanguage()

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
