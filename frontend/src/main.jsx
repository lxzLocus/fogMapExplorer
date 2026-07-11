import 'leaflet/dist/leaflet.css'
import './styles.css'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// Set --app-h to the real screen height. In a standalone iOS PWA this is the
// full screen (incl. the home-indicator area); it's more reliable than 100dvh,
// which can stop short of the bottom on some devices.
const setAppHeight = () => {
  document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px')
}
setAppHeight()
window.addEventListener('resize', setAppHeight)
window.addEventListener('orientationchange', setAppHeight)
if (window.visualViewport) window.visualViewport.addEventListener('resize', setAppHeight)

// No StrictMode: it double-invokes effects in dev, which would create the
// Leaflet map twice. The map lifecycle is guarded in App instead.
createRoot(document.getElementById('root')).render(<App />)
