import type { RommixBridge } from '@shared/api'

declare global {
  interface Window {
    rommix: RommixBridge
  }
}

export {}
