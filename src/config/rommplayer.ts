import type { RommEmulation, RommStreamingConfig, RommPlayers } from '@shared/types'

/**
 * The RomM platforms its in-browser player runs, by slug.
 *
 * Transcribed from `_EJS_CORES_MAP` in RomM's `frontend/src/utils/index.ts`,
 * which is what decides whether RomM's own interface offers to play a game in
 * the browser. Only the stable map: RomM adds its nightly cores only where
 * netplay is switched on, which the heartbeat does not say.
 */
const BROWSER_PLATFORMS: ReadonlySet<string> = new Set([
  '3do',
  'acpc',
  'amiga',
  'amiga-cd32',
  'arcade',
  'neogeoaes',
  'neogeomvs',
  'atari2600',
  'atari-2600-plus',
  'atari5200',
  'atari7800',
  'c-plus-4',
  'c64',
  'cpet',
  'commodore-64c',
  'c128',
  'commmodore-128',
  'colecovision',
  'doom',
  'dos',
  'jaguar',
  'lynx',
  'atari-lynx-mkii',
  'neo-geo-pocket',
  'neo-geo-pocket-color',
  'nes',
  'famicom',
  'fds',
  'game-televisison',
  'new-style-nes',
  'n64',
  'ique-player',
  'nds',
  'nintendo-ds-lite',
  'nintendo-dsi',
  'nintendo-dsi-xl',
  'gb',
  'game-boy-pocket',
  'game-boy-light',
  'gba',
  'game-boy-adavance-sp',
  'game-boy-micro',
  'gbc',
  'pc-fx',
  'psx',
  'philips-cd-i',
  'psp',
  'segacd',
  'sega32',
  'gamegear',
  'sms',
  'sega-mark-iii',
  'sega-game-box-9',
  'sega-master-system-ii',
  'master-system-super-compact',
  'master-system-girl',
  'genesis',
  'sega-mega-drive-2-slash-genesis',
  'sega-mega-jet',
  'mega-pc',
  'tera-drive',
  'sega-nomad',
  'saturn',
  'snes',
  'sfam',
  'super-nintendo-original-european-version',
  'super-famicom-shvc-001',
  'super-famicom-jr-model-shvc-101',
  'new-style-super-nes-model-sns-101',
  'tg16',
  'turbografx-cd',
  'supergrafx',
  'vic-20',
  'virtualboy',
  'wonderswan',
  'swancrystal',
  'wonderswan-color',
  'zxs'
])

/**
 * Which of RomM's own ways to play this platform the server offers.
 *
 * The same two questions RomM's interface asks before it shows either action:
 * the in-browser player is on and has a core for the platform, and a streaming
 * setup lists the platform. `null` for either is a server that did not answer
 * it, which offers nothing.
 */
export function rommPlayers(
  platformSlug: string,
  emulation: RommEmulation | null,
  streaming: RommStreamingConfig | null
): RommPlayers {
  const slug = platformSlug.toLowerCase()
  return {
    browser: emulation !== null && !emulation.DISABLE_EMULATOR_JS && BROWSER_PLATFORMS.has(slug),
    stream:
      streaming !== null &&
      streaming.enabled &&
      streaming.containers.some((container) => container.platform.toLowerCase() === slug)
  }
}
