import { createRoot } from 'react-dom/client'
// Bundled variable fonts, identical on every OS (Vite ships the woff2 files).
// Inter and Literata use their optical-size builds so headings and small UI text
// each get the right cut.
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/inter/opsz-italic.css'
import '@fontsource-variable/literata/opsz.css'
import '@fontsource-variable/literata/opsz-italic.css'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/jetbrains-mono/wght-italic.css'
import '@fontsource-variable/atkinson-hyperlegible-next'
import '@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css'
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
