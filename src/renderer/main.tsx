import React from 'react'
import { createRoot } from 'react-dom/client'
import { installMockApi } from './mockApi'
import { App } from './App'
import './styles.css'

// Im reinen Browser (ohne Electron/Preload) simuliert mockApi das Backend.
installMockApi()

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
