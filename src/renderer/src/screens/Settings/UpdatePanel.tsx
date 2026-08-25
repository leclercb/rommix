import { type JSX, useState } from 'react'
import type { MessageKey } from '@shared/i18n'
import type { UpdatePolicy } from '@shared/types'
import { Choice, FocusButton, Spinner } from '../../components'
import { useApp, useI18n } from '../../state'

/**
 * RomMix's own version, and what is being done about a newer one.
 *
 * The panel is written around one fact: an AppImage has nobody to update it.
 * Nothing on the machine knows this program exists, so unless RomMix looks for
 * itself, a copy stays on the version it was downloaded at forever. What the
 * three settings choose between is therefore not "updates on or off" but how
 * much of it happens without being asked — and the last step, the restart, is
 * never one of them.
 */

const POLICIES = [
  { value: 'auto', label: 'update.policyAuto' },
  { value: 'notify', label: 'update.policyNotify' },
  { value: 'off', label: 'update.policyOff' }
] as const satisfies readonly { value: UpdatePolicy; label: MessageKey }[]

const POLICY_HINT: Record<UpdatePolicy, MessageKey> = {
  auto: 'update.hintAuto',
  notify: 'update.hintNotify',
  off: 'update.hintOff'
}

export function UpdatePanel(): JSX.Element {
  const { t, formatBytes, formatDateTime } = useI18n()
  const { settings, saveSettings, update, notify } = useApp()
  const [busy, setBusy] = useState(false)

  const policy = settings?.updates ?? 'auto'
  const state = update?.state ?? 'idle'
  const checking = state === 'checking'
  const downloading = state === 'downloading'

  /**
   * Check now, and say so either way.
   *
   * A check that finds nothing changes nothing on screen, which from a button is
   * indistinguishable from a button that does not work. The other outcomes
   * announce themselves — a new version through the notification every screen
   * gets, a failure through the notice below.
   */
  const check = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await window.rommix.updates.check()
      if (next.state === 'idle') notify(t('update.newest', { version: next.current }))
    } catch {
      // Reported centrally on `app:error`.
    } finally {
      setBusy(false)
    }
  }

  const download = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.rommix.updates.download()
    } catch {
      // Reported centrally on `app:error`, and left standing in the notice.
    } finally {
      setBusy(false)
    }
  }

  const percent =
    update && update.totalBytes > 0
      ? Math.round((update.receivedBytes / update.totalBytes) * 100)
      : null

  return (
    <>
      <Choice<UpdatePolicy>
        label={t('update.label')}
        hint={t(POLICY_HINT[policy])}
        value={policy}
        options={POLICIES.map((option) => ({ value: option.value, label: t(option.label) }))}
        onChange={(next) => void saveSettings({ updates: next })}
      />

      <dl className="kv">
        <dt>{t('update.installed')}</dt>
        <dd>{update?.current ?? '—'}</dd>
        <dt>{t('update.newestPublished')}</dt>
        {/* Never checked and checked-and-current are different answers, and the
            second one is the reassuring one. */}
        <dd>{update?.latest ?? (checking ? t('update.checking') : t('update.notCheckedYet'))}</dd>
        <dt>{t('update.lastChecked')}</dt>
        <dd>{update?.checkedAt ? formatDateTime(update.checkedAt) : t('value.never')}</dd>
      </dl>

      {/* Why this copy cannot replace itself, said whether or not there is a
          new version: it is a fact about the installation, and finding it out
          for the first time in the middle of an update is too late. */}
      {update?.blockedReason ? (
        <div className="notice notice--warn">{update.blockedReason}</div>
      ) : null}

      {state === 'error' && update?.error ? (
        <div className="notice notice--error">{update.error}</div>
      ) : null}

      {state === 'available' && update?.latest ? (
        <div className="notice notice--warn">
          <div>
            <strong>{t('update.available', { version: update.latest })}</strong>{' '}
            {update.blockedReason
              ? t('update.availableBlocked')
              : policy === 'auto'
                ? t('update.availableAuto')
                : t('update.availableManual')}
          </div>
          {update.notes ? <div className="update__notes">{update.notes}</div> : null}
        </div>
      ) : null}

      {downloading ? (
        <div className="notice notice--ok">
          <div>
            {t('update.downloadingLine', {
              version: update?.latest ?? '',
              size: formatBytes(update?.receivedBytes ?? 0)
            })}
            {percent != null ? ` · ${percent}%` : ''}
          </div>
          <Spinner />
        </div>
      ) : null}

      {state === 'ready' && update?.latest ? (
        <div className="notice notice--ok">
          <div>
            <strong>{t('update.ready', { version: update.latest })}</strong>{' '}
            {/* Where Steam owns the process, "restart" is quit and press Play,
                and saying so is the difference between one press and a session
                that ends with nothing coming back. */}
            {update.restartBlocked ?? t('update.readyDefault')}
          </div>
          {/* The path, which is the same one RomMix was started from. */}
          {update.readyPath ? <div className="update__notes">{update.readyPath}</div> : null}
        </div>
      ) : null}

      {state === 'idle' && update?.checkedAt ? (
        <div className="notice notice--ok">{t('update.upToDate')}</div>
      ) : null}

      <div className="btn-row">
        <FocusButton
          icon="refresh"
          // Nothing to look for once an image is staged: the answer cannot
          // change until RomMix restarts into it.
          disabled={busy || checking || downloading || state === 'ready'}
          onSelect={() => void check()}
        >
          {checking ? t('action.checking') : t('update.checkNow')}
        </FocusButton>

        {state === 'available' && !update?.blockedReason ? (
          <FocusButton
            icon="download"
            // The label is a string and a value, so the hint bar has to be told
            // in words what A does here.
            actionLabel={t('update.downloadAction')}
            disabled={busy}
            onSelect={() => void download()}
          >
            {t('update.downloadVersion', { version: update?.latest ?? '' })}
          </FocusButton>
        ) : null}

        {state === 'ready' && !update?.restartBlocked ? (
          <FocusButton icon="restart" onSelect={() => void window.rommix.updates.restart()}>
            {t('update.restartNow')}
          </FocusButton>
        ) : null}

        {/* Under Steam the same intention is a quit: Steam brings RomMix back,
            and it is the only thing that can. */}
        {state === 'ready' && update?.restartBlocked ? (
          <FocusButton
            icon="quit"
            variant="danger"
            onSelect={() => void window.rommix.system.quit()}
          >
            {t('app.quitRomMix')}
          </FocusButton>
        ) : null}

        {/* The way out for a copy RomMix cannot replace — and, on a machine with
            no browser to open into, at least the address to type. */}
        {update?.url && update.blockedReason ? (
          <FocusButton
            icon="homepage"
            variant="ghost"
            onSelect={() => void window.rommix.system.openExternal(update.url as string)}
          >
            {t('update.releasesPage')}
          </FocusButton>
        ) : null}
      </div>
    </>
  )
}
