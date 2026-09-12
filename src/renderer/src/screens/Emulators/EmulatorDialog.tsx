import type { JSX, Ref } from 'react'
import type { DiagnosticsReport, EmulatorDescriptor, EmulatorId } from '@shared/types'
import { FocusButton, Overlay, StatusBadge } from '../../components'
import { useFocusable } from '../../input/focus'
import { useI18n } from '../../state'
import { Status } from './EmulatorList'

/**
 * Which emulator runs one platform, asked as a list.
 *
 * The row used to cycle: one press advanced to the next candidate, which for
 * two of them is the cheapest control there is and for five is a walk with no
 * way back. Every step of it was also a write and a re-probe, and a change of
 * emulator to be agreed to — so passing an emulator on the way to the one
 * wanted cost a question about a move nobody was making.
 *
 * Listed instead, what a platform can run is readable before anything is
 * pressed, each with whether it is actually here, and one press makes one
 * change.
 */
export function EmulatorDialog({
  platformName,
  candidates,
  chosen,
  fallback,
  diagnostics,
  onPick,
  onClose
}: {
  platformName: string
  /** Every emulator that covers this platform, in preference order. */
  candidates: readonly EmulatorDescriptor[]
  /** The emulator this platform has been given, or undefined for the default. */
  chosen: EmulatorId | undefined
  /** What the default resolves to: the first installed candidate, if any. */
  fallback: EmulatorId | null
  diagnostics: DiagnosticsReport | null
  onPick: (next: EmulatorId | null) => void
  onClose: () => void
}): JSX.Element {
  const { t } = useI18n()
  const named = candidates.find((candidate) => candidate.id === fallback)

  return (
    <Overlay
      title={t('platforms.dialogTitle', { platform: platformName })}
      icon="emulator"
      onDismiss={onClose}
    >
      <ul className="asset-list">
        {/* First, and what a platform is on until somebody says otherwise. It
            names the emulator it comes out as, since "default" on its own is
            the one answer that does not say what will run the game. */}
        <Choice
          id="default"
          name={t('platforms.useDefault')}
          meta={named?.name ?? t('platforms.noneInstalled')}
          current={chosen === undefined}
          onSelect={() => onPick(null)}
        />
        {candidates.map((candidate) => (
          <Choice
            key={candidate.id}
            id={candidate.id}
            name={candidate.name}
            state={diagnostics?.emulators.find((emulator) => emulator.id === candidate.id)}
            current={chosen === candidate.id}
            fallback={candidate.id === fallback}
            onSelect={() => onPick(candidate.id)}
          />
        ))}
      </ul>

      <div className="btn-row">
        <FocusButton icon="back" action="close-emulator-choice" onSelect={onClose}>
          {t('action.close')}
        </FocusButton>
      </div>
    </Overlay>
  )
}

/** One emulator the platform could be given, or the default it has now. */
function Choice({
  id,
  name,
  meta,
  state,
  current,
  fallback = false,
  onSelect
}: {
  id: string
  name: string
  /** Said in words where there is no install to report on — the default row. */
  meta?: string
  state?: DiagnosticsReport['emulators'][number]
  current: boolean
  /** This is the emulator the default row resolves to. */
  fallback?: boolean
  onSelect: () => void
}): JSX.Element {
  const { t } = useI18n()
  const { ref, props } = useFocusable({ onSelect, actionLabel: t('action.select') })

  return (
    <li ref={ref as Ref<HTMLLIElement>} data-choice={id} data-current={current} {...props}>
      <span className="asset__name">{name}</span>
      {meta ? <span className="asset__meta">{meta}</span> : <Status state={state} />}
      {/* Quieter than the one above, and on the other end of the same fact: the
          default row names this emulator, and without a mark here the row of
          the emulator actually running the platform is the one row saying
          nothing about it. */}
      {fallback ? (
        <StatusBadge tone="off" icon="emulator" label={t('platforms.useDefault')} />
      ) : null}
      {/* Only on the one the platform is on now: a mark on every row is a list
          of five marks and no answer. */}
      {current ? <StatusBadge tone="ok" icon="confirm" label={t('platforms.inUse')} /> : null}
    </li>
  )
}
