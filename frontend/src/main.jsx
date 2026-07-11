import 'leaflet/dist/leaflet.css'
import './styles.css'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// No StrictMode: it double-invokes effects in dev, which would create the
// Leaflet map twice. The map lifecycle is guarded in App instead.
createRoot(document.getElementById('root')).render(<App />)
