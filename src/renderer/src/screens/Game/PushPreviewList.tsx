import type { JSX } from 'react'
import type { PendingSave } from '@shared/types'
import { useI18n } from '../../state'

/**
 * How many files the push confirmation lists before summarising the rest.
 *
 * Enough for a game's battery save and a handful of states, which is what an
 * ordinary push is; past that the list stops being something you read and the
 * count in the dialog's title is doing the work anyway.
 */
const PUSH_PREVIEW_ROWS = 8

/**
 * Exactly what a push is about to send, one row per file.
 *
 * The three things worth knowing before pressing send, in the order they
 * matter: which file, what tag it will carry — a save is only loadable by the
 * emulator that wrote it, so a wrong tag is a save that never comes back — and
 * what is already on the server under that name. The last is called out when
 * the server's copy is the newer of the two, which is the one case where
 * sending is likely to be a mistake.
 */
export function PushPreviewList({ files }: { files: PendingSave[] }): JSX.Element {
  const { t, formatBytes, formatDateTime } = useI18n()
  // Capped rather than scrolled: nothing in this list is focusable, so a
  // scrolling panel on a gamepad is content that cannot be reached. A push of
  // ten libretro state slots is a real thing, and the count in the title is
  // already the number that decides the answer.
  const shown = files.slice(0, PUSH_PREVIEW_ROWS)
  const hidden = files.length - shown.length

  return (
    <>
      <ul className="asset-list">
        {shown.map((file) => {
          const stale = file.replaces
            ? Date.parse(file.replaces.updatedAt) > Date.parse(file.modifiedAt)
            : false

          return (
            <li key={`${file.kind}-${file.path}`}>
              <span className="asset__kind" data-kind={file.kind}>
                {file.kind === 'save' ? t('asset.save') : t('asset.state')}
              </span>
              <span className="status" data-state={stale ? 'warn' : 'ok'}>
                {file.emulator}
              </span>
              <span className="asset__name">{file.fileName}</span>
              <span className="asset__meta">
                {formatBytes(file.sizeBytes)}
                {/* A Switch save is a folder of files named after nothing, so it
                  travels as one archive — worth saying, since the name above is
                  not a name anything on disk has. */}
                {file.isDirectory ? ` · ${t('push.folderAsZip')}` : ''} ·{' '}
                {formatDateTime(file.modifiedAt)}
              </span>
              <span className="asset__meta">
                {file.replaces
                  ? t('push.onRomM', {
                      source:
                        file.replaces.fromThisDevice === true
                          ? t('push.thisDevice')
                          : file.replaces.fromThisDevice === false
                            ? t('push.anotherDevice')
                            : (file.replaces.emulator ?? t('value.unknown')),
                      when: formatDateTime(file.replaces.updatedAt) ?? ''
                    }) + (stale ? ` · ${t('push.newerThanThis')}` : '')
                  : t('push.newOnRomM')}
              </span>
            </li>
          )
        })}
      </ul>
      {hidden > 0 ? <p className="muted">{t('push.andMore', { count: hidden })}</p> : null}
    </>
  )
}
