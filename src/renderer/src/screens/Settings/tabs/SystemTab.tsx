import { type JSX, useState } from 'react'
import type { DiagnosticsReport, RootLocation } from '@shared/types'
import { FocusButton, Spinner, TextField } from '../../../components'
import { useGamepadName } from '../../../input/focus'
import { useApp } from '../../../state'
import { UpdatePanel } from '../UpdatePanel'

/**
 * The installation itself: where it keeps its files, how it keeps itself
 * current, and whether the machine around it is set up to play anything.
 *
 * The pre-flight check is the important part. Almost every failure in this app
 * is environmental — RetroDECK not installed, flatpak missing, the ROM folder
 * not writable — and each of those is far easier to fix when it is named
 * explicitly rather than surfacing as "launch failed".
 */
export function SystemTab({
  diagnostics,
  root,
  onRecheck
}: {
  diagnostics: DiagnosticsReport | null
  root: RootLocation | null
  /** Run the pre-flight check again; resolves with what it found. */
  onRecheck: () => Promise<DiagnosticsReport | null>
}): JSX.Element {
  const { notify } = useApp()
  const [rootDraft, setRootDraft] = useState<string | null>(null)
  const [rechecking, setRechecking] = useState(false)
  const controller = useGamepadName()

  // Null until the field is touched, so the value shown follows the folder RomMix
  // reports rather than a draft captured before it had answered.
  const draft = rootDraft ?? root?.current ?? ''

  /**
   * Repoint RomMix's folder. The restart is not optional: Electron fixes its
   * userData path before the app starts, so the running process is still
   * reading and writing the old location.
   */
  const moveRoot = async (): Promise<void> => {
    const value = draft.trim()
    if (!value) return
    try {
      await window.rommix.system.setRoot(value)
      notify('RomMix folder moved — restarting')
      await window.rommix.system.restart()
    } catch {
      // Reported centrally on `app:error`.
    }
  }

  /**
   * Run the pre-flight check again, and say what it found.
   *
   * The button used to replace the report silently, which on a machine where
   * nothing had changed was indistinguishable from a button that does nothing —
   * the same list of notes, redrawn. The count is the part that answers "did
   * that do anything", so the notification leads with it.
   */
  const recheck = async (): Promise<void> => {
    setRechecking(true)
    try {
      const report = await onRecheck()
      if (!report) return
      const problems = report.notes.length
      notify(
        problems === 0
          ? 'Checked — everything looks ready to play'
          : `Checked — ${problems} thing${problems === 1 ? '' : 's'} to sort out`,
        problems === 0 ? 'ok' : 'warn'
      )
    } finally {
      setRechecking(false)
    }
  }

  return (
    <>
      <h2 className="section-title">Updates</h2>
      <UpdatePanel />

      <h2 className="section-title">RomMix folder</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        Settings, credentials, the download index, and any emulator RomMix installed. Move this
        folder to move the whole installation.
      </p>
      <div className="form">
        <TextField
          label="Folder"
          value={draft}
          onChange={setRootDraft}
          placeholder={root?.fallback ?? '/home/you/rommix'}
          hint={
            root?.fromEnvironment
              ? 'Set by ROMMIX_HOME, which wins over anything chosen here.'
              : 'Settings are copied to the new folder; emulators and ROMs stay where they are.'
          }
        />
        <div className="btn-row">
          <FocusButton
            icon="folder"
            disabled={root?.fromEnvironment || draft.trim() === root?.current}
            onSelect={() => void moveRoot()}
          >
            Move and restart
          </FocusButton>
        </div>
      </div>

      <h2 className="section-title">Pre-flight check</h2>
      {!diagnostics ? (
        <Spinner />
      ) : (
        <>
          <dl className="kv">
            {/* Not about RomMix, which is an AppImage: it is about the
                emulators, most of which are flatpaks and none of which can be
                found without the command. */}
            <dt>Flatpak available</dt>
            <dd>{diagnostics.flatpakAvailable ? 'yes' : 'no'}</dd>
            {/* The other half of the same question. A machine can have flatpak
                and still have nowhere to install from, which otherwise shows up
                only as every emulator reading "not installed". */}
            <dt>Flathub set up</dt>
            <dd>
              {!diagnostics.flatpakAvailable
                ? '—'
                : diagnostics.flathubConfigured
                  ? 'yes'
                  : 'no — added on first install'}
            </dd>
            <dt>Emulators installed</dt>
            <dd>
              {diagnostics.emulators.filter((e) => e.available).length} of{' '}
              {diagnostics.emulators.length}
            </dd>
            <dt>ROM folders writable</dt>
            <dd>{diagnostics.romsWritable ? 'yes' : 'no'}</dd>
            <dt>Controller</dt>
            <dd>{controller ?? 'none seen — press a button on it'}</dd>
            {/* The file to attach to a bug report, named where the problems are. */}
            <dt>Log file</dt>
            <dd>{diagnostics.logPath}</dd>
          </dl>

          {/* Per-emulator detail lives only in the Emulators tab. */}

          {diagnostics.notes.length > 0 ? (
            diagnostics.notes.map((note) => (
              <div className="notice notice--warn" key={note}>
                {note}
              </div>
            ))
          ) : (
            <div className="notice notice--ok">Everything looks ready to play.</div>
          )}

          <div className="btn-row">
            <FocusButton icon="refresh" disabled={rechecking} onSelect={() => void recheck()}>
              {rechecking ? 'Checking…' : 'Re-run check'}
            </FocusButton>
          </div>
        </>
      )}
    </>
  )
}
