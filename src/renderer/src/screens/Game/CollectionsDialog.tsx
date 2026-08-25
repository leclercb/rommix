import { type JSX, type Ref, useEffect, useState } from 'react'
import type { RommCollection } from '@shared/types'
import { FocusButton, Overlay, Spinner } from '../../components'
import { Icon } from '../../icons'
import { useFocusable } from '../../input/focus'
import { useI18n } from '../../state'

/**
 * Which of the user's shelves this game is on, and a press to change it.
 *
 * A list of toggles rather than an add-to picker, because both directions are
 * the same question: the row says whether it is on the shelf, and pressing it
 * says the opposite. An "add to…" that cannot take a game off again would leave
 * the only way to do that in RomM's web interface.
 *
 * Two kinds are left out. RomM's virtual collections — a shelf per genre, per
 * franchise — are built from metadata and have nothing to add to; and the
 * favourites collection has the heart on the row above, which would otherwise
 * be two controls for one fact.
 *
 * Each row is written to the server as it is pressed, and shown as the answer
 * before the server has confirmed it. The alternative is a list that does
 * nothing for a round trip and then moves under the cursor, and a collection
 * edit is not a thing worth watching a spinner for. A failure puts the row back
 * and says so.
 */
export function CollectionsDialog({
  romId,
  onClose,
  onError
}: {
  romId: number
  onClose: () => void
  onError: (message: string) => void
}): JSX.Element {
  const { t } = useI18n()
  const [collections, setCollections] = useState<RommCollection[] | null>(null)
  const [members, setMembers] = useState<ReadonlySet<number>>(new Set())

  useEffect(() => {
    void window.rommix.library
      .collections()
      .then((all) => {
        const own = all.filter((entry) => !entry.is_virtual && !entry.is_favorite)
        setCollections(own)
        setMembers(new Set(own.filter((e) => e.rom_ids.includes(romId)).map((e) => e.id)))
      })
      .catch((cause: Error) => {
        setCollections([])
        onError(cause.message)
      })
  }, [romId, onError])

  const toggle = async (collection: RommCollection): Promise<void> => {
    const member = !members.has(collection.id)
    setMembers((current) => {
      const next = new Set(current)
      if (member) next.add(collection.id)
      else next.delete(collection.id)
      return next
    })
    try {
      await window.rommix.library.setCollection(romId, collection.id, member)
    } catch (cause) {
      setMembers((current) => {
        const next = new Set(current)
        if (member) next.delete(collection.id)
        else next.add(collection.id)
        return next
      })
      onError((cause as Error).message)
    }
  }

  return (
    <Overlay title={t('collections.dialogTitle')}>
      {!collections ? <Spinner /> : null}

      {/* RomMix makes no collections of its own: one is a thing somebody named,
          and naming it on a television is worse than doing it in the browser
          that is already open on the server. */}
      {collections && collections.length === 0 ? (
        <p className="muted">{t('collections.none')}</p>
      ) : null}

      {collections && collections.length > 0 ? (
        <ul className="asset-list">
          {collections.map((collection) => (
            <CollectionRow
              key={collection.id}
              collection={collection}
              member={members.has(collection.id)}
              onToggle={() => void toggle(collection)}
            />
          ))}
        </ul>
      ) : null}

      <div className="btn-row">
        <FocusButton icon="keep" onSelect={onClose} autoFocus>
          {t('action.close')}
        </FocusButton>
      </div>
    </Overlay>
  )
}

/** One shelf, and whether this game is on it. */
function CollectionRow({
  collection,
  member,
  onToggle
}: {
  collection: RommCollection
  member: boolean
  onToggle: () => void
}): JSX.Element {
  const { t } = useI18n()
  const { ref, props } = useFocusable({
    onSelect: onToggle,
    actionLabel: member ? t('collections.remove') : t('collections.add')
  })

  return (
    <li ref={ref as Ref<HTMLLIElement>} {...props}>
      <span className="status" data-state={member ? 'ok' : 'off'}>
        <Icon name={member ? 'confirm' : 'add'} size={13} />
        {member ? t('collections.on') : t('collections.off')}
      </span>
      <span className="asset__name">{collection.name}</span>
      <span className="asset__meta">{t('library.count', { count: collection.rom_count })}</span>
    </li>
  )
}
