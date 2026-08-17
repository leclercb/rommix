import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { EmulationPaths, RunnerInfo, RunnerKind, Settings } from '@shared/types'

const execFileAsync = promisify(execFile)

export const RETRODECK_APP_ID = 'net.retrodeck.retrodeck'
export const RETROARCH_APP_ID = 'org.libretro.RetroArch'

/**
 * True when Rommix is itself running inside a flatpak sandbox. Flatpak always
 * writes /.flatpak-info into the sandbox, and sets FLATPAK_ID.
 */
export function inFlatpak(): boolean {
  return Boolean(process.env.FLATPAK_ID) || existsSync('/.flatpak-info')
}

/**
 * Wrap a command so it runs on the host rather than inside our sandbox.
 *
 * `flatpak run` cannot be nested, so a sandboxed Rommix has to hop out via
 * flatpak-spawn (which needs --talk-name=org.freedesktop.Flatpak in the
 * manifest). Outside a sandbox the command is returned untouched.
 */
export function hostCommand(argv: string[]): string[] {
  return inFlatpak() ? ['flatpak-spawn', '--host', ...argv] : argv
}

/** Real home directory, even from inside a sandbox where HOME is remapped. */
function realHome(): string {
  // Inside a flatpak, HOME points at the sandboxed home only when the app has
  // no home access; with --filesystem=home it is the actual user home.
  return process.env.HOME ?? homedir()
}

async function runHost(argv: string[], timeoutMs = 8000): Promise<string | null> {
  const [cmd, ...args] = hostCommand(argv)
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: timeoutMs })
    return stdout
  } catch {
    return null
  }
}

/** Is this flatpak application installed on the host? */
export async function flatpakInstalled(appId: string): Promise<boolean> {
  const out = await runHost(['flatpak', 'info', '--show-location', appId])
  return out != null && out.trim().length > 0
}

// ---------------------------------------------------------------------------
// RetroDECK
// ---------------------------------------------------------------------------

interface RetroDeckConfig {
  paths?: Record<string, string>
}

/** Where RetroDECK keeps its own configuration inside its flatpak data dir. */
export function retrodeckConfigDir(): string {
  return join(realHome(), '.var', 'app', RETRODECK_APP_ID, 'config', 'retrodeck')
}

/**
 * Discover RetroDECK's folder layout.
 *
 * Modern RetroDECK stores everything in retrodeck.json; older builds used a
 * flat `key=value` retrodeck.cfg. Both are read because a user's install may
 * predate the migration. The paths matter: the ROM root is user-selectable
 * (internal storage vs SD card), so hardcoding ~/retrodeck would silently put
 * ROMs where RetroDECK never looks.
 */
export function readRetroDeckPaths(): EmulationPaths {
  const configDir = retrodeckConfigDir()
  const empty: EmulationPaths = { home: null, roms: null, saves: null, states: null, bios: null }

  const jsonPath = join(configDir, 'retrodeck.json')
  if (existsSync(jsonPath)) {
    try {
      const cfg = JSON.parse(readFileSync(jsonPath, 'utf8')) as RetroDeckConfig
      const p = cfg.paths ?? {}
      if (p.roms_path) {
        return {
          home: p.rd_home_path ?? null,
          roms: p.roms_path,
          saves: p.saves_path ?? null,
          states: p.states_path ?? null,
          bios: p.bios_path ?? null
        }
      }
    } catch {
      // fall through to the legacy format
    }
  }

  const cfgPath = join(configDir, 'retrodeck.cfg')
  if (existsSync(cfgPath)) {
    try {
      const values = new Map<string, string>()
      for (const line of readFileSync(cfgPath, 'utf8').split('\n')) {
        const match = /^([a-z_]+)=(.*)$/.exec(line.trim())
        if (match) values.set(match[1], match[2])
      }
      const home = values.get('rdhome') ?? null
      if (home) {
        return {
          home,
          roms: values.get('roms_folder') ?? join(home, 'roms'),
          saves: values.get('saves_folder') ?? join(home, 'saves'),
          states: values.get('states_folder') ?? join(home, 'states'),
          bios: values.get('bios_folder') ?? join(home, 'bios')
        }
      }
    } catch {
      // fall through to the default layout
    }
  }

  // Last resort: RetroDECK's default location. Only usable if it really exists,
  // otherwise we would rather report "not configured" than invent a path.
  const fallback = join(realHome(), 'retrodeck')
  if (existsSync(fallback)) {
    return {
      home: fallback,
      roms: join(fallback, 'roms'),
      saves: join(fallback, 'saves'),
      states: join(fallback, 'states'),
      bios: join(fallback, 'bios')
    }
  }

  return empty
}

// ---------------------------------------------------------------------------
// Standalone RetroArch
// ---------------------------------------------------------------------------

/**
 * RetroArch's flatpak keeps its config tree under the app's config dir.
 * There is no ROM root of its own, so Rommix stores ROMs in a `roms` folder
 * beside the config and lets RetroArch's own history handle the rest.
 */
export function readRetroArchPaths(): EmulationPaths {
  const base = join(realHome(), '.var', 'app', RETROARCH_APP_ID)
  const config = join(base, 'config', 'retroarch')
  if (!existsSync(base)) {
    return { home: null, roms: null, saves: null, states: null, bios: null }
  }
  return {
    home: base,
    roms: join(realHome(), 'roms'),
    saves: join(config, 'saves'),
    states: join(config, 'states'),
    bios: join(config, 'system')
  }
}

// ---------------------------------------------------------------------------
// Runner selection
// ---------------------------------------------------------------------------

function applyOverrides(paths: EmulationPaths, overrides: Partial<EmulationPaths>): EmulationPaths {
  return {
    home: overrides.home ?? paths.home,
    roms: overrides.roms ?? paths.roms,
    saves: overrides.saves ?? paths.saves,
    states: overrides.states ?? paths.states,
    bios: overrides.bios ?? paths.bios
  }
}

/** Probe both supported runners and report what is usable right now. */
export async function detectRunners(settings: Settings): Promise<RunnerInfo[]> {
  const [retrodeckPresent, retroarchPresent] = await Promise.all([
    flatpakInstalled(RETRODECK_APP_ID),
    flatpakInstalled(RETROARCH_APP_ID)
  ])

  const retrodeckPaths = applyOverrides(readRetroDeckPaths(), settings.pathOverrides)
  const retroarchPaths = applyOverrides(readRetroArchPaths(), settings.pathOverrides)

  return [
    {
      kind: 'retrodeck',
      appId: RETRODECK_APP_ID,
      // RetroDECK is only useful once it has been run at least once and has a
      // ROM root; before that there is nowhere to install to.
      available: retrodeckPresent && retrodeckPaths.roms != null,
      paths: retrodeckPaths
    },
    {
      kind: 'retroarch',
      appId: RETROARCH_APP_ID,
      available: retroarchPresent,
      paths: retroarchPaths
    }
  ]
}

/**
 * Pick the runner to use: the preferred one when it is available, otherwise
 * whichever other runner is.
 */
export function chooseRunner(runners: RunnerInfo[], preferred: RunnerKind): RunnerInfo | null {
  const wanted = runners.find((r) => r.kind === preferred && r.available)
  if (wanted) return wanted
  return runners.find((r) => r.available) ?? null
}

/** Can we actually write ROMs into this directory tree? */
export async function isWritable(path: string | null): Promise<boolean> {
  if (!path) return false
  try {
    await access(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Verify flatpak-spawn works, so we can warn early instead of at launch time. */
export async function canSpawnHost(): Promise<boolean> {
  if (!inFlatpak()) return true
  const out = await runHost(['flatpak', '--version'], 5000)
  return out != null
}
