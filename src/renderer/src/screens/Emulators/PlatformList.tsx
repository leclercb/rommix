import { type JSX, useEffect, useState } from 'react'
import { emulatorById, emulatorsForSystem } from '@config/emulators'
import { resolveSystem, systemLabel } from '@config/systems'
import type { DiagnosticsReport, EmulatorId, RommPlatform } from '@shared/types'
import { FocusButton, PlatformIcon, Spinner, StatusPill } from '../../components'
import { useApp, useI18n } from '../../state'
import { EmulatorDialog } from './EmulatorDialog'
import { Status } from './EmulatorList'

/**
 * Platform -> emulator, one row per platform in the user's RomM library.
 *
 * Only the library's platforms are listed. There are ~200 ES-DE systems and a
 * screen of rows for consoles the user does not own would bury the handful
 * that matter.
 *
 * The control opens a list rather than cycling through the candidates: a
 * platform both frontends and a standalone cover has five of them, and a button
 * that advances by one is five presses, a question at every step and no way
 * back. See `EmulatorDialog`.
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
  /**
   * What the emulator button says, as one phrase.
   *
   * Built from a single catalogue entry rather than a name with `(default)`
   * appended: the two do not go in that order in every language, and a
   * translator handed the bracket on its own cannot see what it attaches to.
   */
  const label = (effective: EmulatorId | undefined, byDefault: boolean): string => {
    if (!effective) return t('value.none')
    const name = emulatorById(effective)?.name ?? effective
    return byDefault ? t('platforms.defaultNamed', { name }) : name
  }
  const { settings } = useApp()
  const priority = settings?.emulatorPriority ?? []
  /** Null until the server has answered, which is not the same as none. */
  const [platforms, setPlatforms] = useState<RommPlatform[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  /** The platform whose emulator is being picked, with nothing chosen yet. */
  const [picking, setPicking] = useState<{ platform: RommPlatform; system: string } | null>(null)

  useEffect(() => {
    void window.rommix.library
      .platforms()
      .then((list) => {
        setFailed(null)
        setPlatforms(list.filter((platform) => platform.rom_count > 0))
      })
      .catch((cause: unknown) => {
        setFailed(cause instanceof Error ? cause.message : String(cause))
        setPlatforms([])
      })
  }, [])

  // Three answers, not two. A request still out is a spinner — on a slow server
  // this sat reading "connect to RomM first" for seconds on a connected machine
  // — and one that failed says so, rather than reporting a server error as a
  // configuration problem the player has already solved. `Library` does the same.
  if (platforms === null) return <Spinner />
  if (failed) return <p className="notice notice--error">{failed}</p>
  if (platforms.length === 0) {
    return <p className="faint">{t('platforms.connectFirst')}</p>
  }

  const rows = platforms
    .map((platform) => ({
      platform,
      system: resolveSystem(platform.slug, platform.fs_slug, overrides)
    }))
    .filter((row): row is { platform: RommPlatform; system: string } => row.system !== null)

  /**
   * The default is the first *installed* emulator that covers the platform,
   * which is what the launcher will pick too.
   *
   * Naming one that is not installed describes an arrangement that cannot
   * happen: RomMix would fall through to the next available emulator and put
   * the games in a different folder than the row claims. With none of them
   * installed there is no default to name, and the row says so instead of
   * pointing at an emulator that is not there.
   */
  const installed = new Set(
    (diagnostics?.emulators ?? []).filter((e) => e.available).map((e) => e.id)
  )
  const defaultFor = (system: string): EmulatorId | null =>
    emulatorsForSystem(system, priority).find((c) => installed.has(c.id))?.id ?? null

  /**
   * Give a platform to one emulator, or hand it back to the default.
   *
   * Asked about first, and only where the answer moves the platform: choosing
   * the emulator the default already resolves to writes a preference and moves
   * no files, which is nothing to warn anybody about.
   */
  const pick = async (system: string, next: EmulatorId | null): Promise<void> => {
    setPicking(null)
    const updated = { ...chosen }
    if (next === null) delete updated[system]
    else updated[system] = next

    const fallback = defaultFor(system)
    const after = next ?? fallback
    if (after !== (chosen[system] ?? fallback) && !(await confirmChange())) return
    onChoose(updated)
  }

  return (
    <div>
      {rows.map(({ platform, system }) => {
        const candidates = emulatorsForSystem(system, priority)
        const effective = chosen[system] ?? defaultFor(system)
        const state = diagnostics?.emulators.find((emulator) => emulator.id === effective)

        return (
          <div className="emulator" data-platform={system} key={platform.id}>
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
                  <StatusPill tone="warn">
                    {candidates.length === 0
                      ? t('platforms.noneCovers')
                      : t('platforms.noneInstalled')}
                  </StatusPill>
                )}
              </div>
              <div className="emulator__meta">
                {t('platforms.meta', { system: systemLabel(system), count: platform.rom_count })}
              </div>
            </div>
            <div className="emulator__actions">
              <FocusButton
                icon="emulator"
                action="choose-emulator"
                variant="ghost"
                disabled={candidates.length === 0}
                onSelect={() => setPicking({ platform, system })}
              >
                {label(effective, chosen[system] == null)}
              </FocusButton>
            </div>
          </div>
        )
      })}

      {picking ? (
        <EmulatorDialog
          platformName={picking.platform.display_name}
          candidates={emulatorsForSystem(picking.system, priority)}
          chosen={chosen[picking.system]}
          fallback={defaultFor(picking.system)}
          diagnostics={diagnostics}
          onPick={(next) => void pick(picking.system, next)}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </div>
  )
}
