import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/article.css'
import './styles/app.css'

// In a plain browser (no Electron preload) during development, install a sample
// data shim so the UI can be previewed. Dead-code eliminated from prod builds.
if (import.meta.env.DEV && !window.api) {
  const { installDevApi } = await import('./lib/devApi')
  installDevApi()
}

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root not found')
createRoot(container).render(<App />)
