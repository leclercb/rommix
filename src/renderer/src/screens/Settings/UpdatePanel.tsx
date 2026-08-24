import { type JSX, useState } from 'react'
import type { UpdatePolicy } from '@shared/types'
import { Choice, FocusButton, Spinner, formatBytes, formatDateTime } from '../../components'
import { useApp } from '../../state'

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

const POLICIES: { value: UpdatePolicy; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'notify', label: 'Tell me' },
  { value: 'off', label: 'Off' }
]

const POLICY_HINT: Record<UpdatePolicy, string> = {
  auto: 'New versions are downloaded in the background and used the next time RomMix starts.',
  notify: 'RomMix says when a new version is published and waits for you to fetch it.',
  off: 'RomMix never looks on its own. The button below still does.'
}

export function UpdatePanel(): JSX.Element {
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
      if (next.state === 'idle') notify(`RomMix ${next.current} is the newest version`)
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
        label="New versions of RomMix"
        hint={POLICY_HINT[policy]}
        value={policy}
        options={POLICIES}
        onChange={(next) => void saveSettings({ updates: next })}
      />

      <dl className="kv">
        <dt>Installed</dt>
        <dd>{update?.current ?? '—'}</dd>
        <dt>Newest published</dt>
        {/* Never checked and checked-and-current are different answers, and the
            second one is the reassuring one. */}
        <dd>{update?.latest ?? (checking ? 'checking…' : 'not checked yet')}</dd>
        <dt>Last checked</dt>
        <dd>{update?.checkedAt ? formatDateTime(update.checkedAt) : 'never'}</dd>
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
            <strong>RomMix {update.latest} is available.</strong>{' '}
            {update.blockedReason
              ? 'Download it from the releases page.'
              : policy === 'auto'
                ? 'It is being fetched now.'
                : 'Fetch it whenever suits you — nothing is downloaded until you do.'}
          </div>
          {update.notes ? <div className="update__notes">{update.notes}</div> : null}
        </div>
      ) : null}

      {downloading ? (
        <div className="notice notice--ok">
          <div>
            Downloading RomMix {update?.latest}: {formatBytes(update?.receivedBytes ?? 0)}
            {percent != null ? ` · ${percent}%` : ''}
          </div>
          <Spinner />
        </div>
      ) : null}

      {state === 'ready' && update?.latest ? (
        <div className="notice notice--ok">
          <div>
            <strong>RomMix {update.latest} is ready.</strong>{' '}
            {/* Where Steam owns the process, "restart" is quit and press Play,
                and saying so is the difference between one press and a session
                that ends with nothing coming back. */}
            {update.restartBlocked ?? 'It runs the next time RomMix starts, or now if you restart.'}
          </div>
          {/* The path, which is the same one RomMix was started from. */}
          {update.readyPath ? <div className="update__notes">{update.readyPath}</div> : null}
        </div>
      ) : null}

      {state === 'idle' && update?.checkedAt ? (
        <div className="notice notice--ok">RomMix is up to date.</div>
      ) : null}

      <div className="btn-row">
        <FocusButton
          icon="refresh"
          // Nothing to look for once an image is staged: the answer cannot
          // change until RomMix restarts into it.
          disabled={busy || checking || downloading || state === 'ready'}
          onSelect={() => void check()}
        >
          {checking ? 'Checking…' : 'Check now'}
        </FocusButton>

        {state === 'available' && !update?.blockedReason ? (
          <FocusButton
            icon="download"
            // The label is a string and a value, so the hint bar has to be told
            // in words what A does here.
            actionLabel="Download the new version"
            disabled={busy}
            onSelect={() => void download()}
          >
            Download {update?.latest}
          </FocusButton>
        ) : null}

        {state === 'ready' && !update?.restartBlocked ? (
          <FocusButton icon="restart" onSelect={() => void window.rommix.updates.restart()}>
            Restart now
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
            Quit RomMix
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
            Releases page
          </FocusButton>
        ) : null}
      </div>
    </>
  )
}
