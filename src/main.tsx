import React from 'react'
import { createRoot } from 'react-dom/client'
// Leaflet's base styles load first so the app's map styles can override them.
import 'leaflet/dist/leaflet.css'
import App from './App'
import './styles.css'
import './refresh.css'

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
