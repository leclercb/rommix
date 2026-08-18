import type { RomMixBridge } from '@shared/api'

declare global {
  interface Window {
    rommix: RomMixBridge
  }
}

export {}
