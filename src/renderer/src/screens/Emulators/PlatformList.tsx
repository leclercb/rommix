import { type JSX, useEffect, useState } from 'react'
import { emulatorById, emulatorsForSystem } from '@config/emulators'
import { resolveSystem, systemLabel } from '@config/systems'
import type { DiagnosticsReport, EmulatorId, RommPlatform } from '@shared/types'
import { FocusButton, PlatformIcon } from '../../components'
import { useApp, useI18n } from '../../state'
import { Status } from './EmulatorList'

/**
 * Platform -> emulator, one row per platform in the user's RomM library.
 *
 * Only the library's platforms are listed. There are ~200 ES-DE systems and a
 * screen of rows for consoles the user does not own would bury the handful
 * that matter.
 *
 * The control cycles rather than opening a menu: candidates are usually two or
 * three, and a single button that advances on A is the least awkward thing to
 * drive from a gamepad.
 */
export function PlatformList({
  chosen,
  diagnostics,
  overrides,
  confirmChange,
  onChoose
}: {
  chosen: Record<string, EmulatorId>
  diagnostics: DiagnosticsReport | null
  overrides: Record<string, string>
  /** Ask before a change that costs a re-download. Resolves false on cancel. */
  confirmChange: () => Promise<boolean>
  onChoose: (next: Record<string, EmulatorId>) => void
}): JSX.Element {
  // The same order the Emulators list is showing, so "Default" here names the
  // emulator that would actually run the platform.
  const { t } = useI18n()
  const { settings } = useApp()
  const priority = settings?.emulatorPriority ?? []
  const [platforms, setPlatforms] = useState<RommPlatform[]>([])

  useEffect(() => {
    void window.rommix.library
      .platforms()
      .then((list) => setPlatforms(list.filter((platform) => platform.rom_count > 0)))
      .catch(() => setPlatforms([]))
  }, [])

  if (platforms.length === 0) {
    return <p className="faint">{t('platforms.connectFirst')}</p>
  }

  const rows = platforms
    .map((platform) => ({
      platform,
      system: resolveSystem(platform.slug, platform.fs_slug, overrides)
    }))
    .filter((row): row is { platform: RommPlatform; system: string } => row.system !== null)

  return (
    <div>
      {rows.map(({ platform, system }) => {
        const candidates = emulatorsForSystem(system, priority)
        /**
         * The default is the first *installed* emulator that covers the
         * platform, which is what the launcher will pick too.
         *
         * Naming one that is not installed describes an arrangement that
         * cannot happen: RomMix would fall through to the next available
         * emulator and put the games in a different folder than this row
         * claims. With none of them installed there is no default to name, and
         * the row says so instead of pointing at an emulator that is not there.
         */
        const installed = new Set(
          (diagnostics?.emulators ?? []).filter((e) => e.available).map((e) => e.id)
        )
        const fallback = candidates.find((c) => installed.has(c.id))?.id ?? null
        const current = chosen[system]
        const effective = current ?? fallback
        const state = diagnostics?.emulators.find((emulator) => emulator.id === effective)

        // 'default' first, then every emulator that runs this system.
        const cycle: (EmulatorId | null)[] = [null, ...candidates.map((c) => c.id)]

        /**
         * Step to the next candidate, asking first.
         *
         * Only once per run of presses: the cycle is how this control is
         * driven, and a dialog between every step would make walking past
         * "Default" to the third emulator three confirmations of the same
         * change. The question is asked when the platform leaves the emulator
         * it is on now, and the answer holds for as long as the cycling lasts.
         */
        const advance = async (): Promise<void> => {
          const index = cycle.indexOf(current ?? null)
          const next = cycle[(index + 1) % cycle.length]
          const updated = { ...chosen }
          if (next === null) delete updated[system]
          else updated[system] = next

          // Nothing to warn about when the emulator does not actually change —
          // stepping from "Default" onto the emulator that was already the
          // default writes a preference and moves no files.
          const after = next ?? fallback
          if (after !== effective && !(await confirmChange())) return
          onChoose(updated)
        }

        return (
          <div className="emulator" key={platform.id}>
            <PlatformIcon
              slug={platform.slug}
              system={system}
              size={30}
              label={platform.display_name}
            />
            <div className="emulator__body">
              <div className="emulator__name">
                {platform.display_name}
                {effective ? (
                  <Status state={state} />
                ) : (
                  <span className="status" data-state="warn">
                    {candidates.length === 0
                      ? t('platforms.noneCovers')
                      : t('platforms.noneInstalled')}
                  </span>
                )}
              </div>
              <div className="emulator__meta">
                {t('platforms.meta', { system: systemLabel(system), count: platform.rom_count })}
              </div>
            </div>
            <div className="emulator__actions">
              <FocusButton
                icon="emulator"
                variant="ghost"
                disabled={candidates.length === 0}
                onSelect={() => void advance()}
              >
                {effective ? (emulatorById(effective)?.name ?? effective) : t('value.none')}
                {current == null && effective ? ` ${t('platforms.default')}` : ''}
              </FocusButton>
            </div>
          </div>
        )
      })}
    </div>
  )
}
