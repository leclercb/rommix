import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { FocusProvider } from './input/focus'
import { AppProvider } from './state'
import './styles.css'

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
