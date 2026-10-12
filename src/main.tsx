import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// one-time move of data saved under the project's old name (SeismoShield)
try {
  for (const k of ['alert-settings', 'alert-history', 'bench-v1']) {
    const old = localStorage.getItem(`seismoshield-${k}`)
    if (old !== null && localStorage.getItem(`lithotechno-${k}`) === null) localStorage.setItem(`lithotechno-${k}`, old)
    localStorage.removeItem(`seismoshield-${k}`)
  }
} catch { /* storage unavailable */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
