import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { FocusProvider } from './input/focus'
import { AppProvider } from './state'
import './styles.css'

// In a browser there is no preload script and so no `window.rommix`. The flag
// is set only by `vite.web.config.ts`, and being a compile-time constant
// everywhere else, this branch and the module behind it are dropped from the
// bundle the app actually ships.
if (import.meta.env.VITE_WEB_PREVIEW) {
  const { installPreviewBridge } = await import('./dev/bridge')
  installPreviewBridge()
}

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <AppProvider>
      <FocusProvider>
        <App />
      </FocusProvider>
    </AppProvider>
  </StrictMode>
)
