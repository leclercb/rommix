import { type JSX, type ReactNode, type Ref } from 'react'
import { installMethods, systemCount } from '@config/emulators'
import type { EmulatorAsset, EmulatorDescriptor, EmulatorRelease } from '@shared/types'
import { StatusPill } from '../../../components'
import { Icon, type IconName } from '../../../icons'
import { useFocusable } from '../../../input/focus'
import { useI18n } from '../../../state'
import { INSTALL_KIND } from '../../Emulators/EmulatorList'

/**
 * The rows the flow's four questions are answered from.
 *
 * Rows rather than buttons, and the same row for all four: a button sizes
 * itself to its label and sits beside its neighbours, which for fifty-character
 * filenames is a wrapped thicket nobody can compare. Each answer gets the full
 * width, with the part that differs in the same place every time.
 */

/** A name, what distinguishes it, and the mark for what pressing it does. */
function ChoiceRow({
  name,
  nameClass,
  meta,
  icon,
  actionLabel,
  onSelect,
  autoFocus
}: {
  name: ReactNode
  /** The row whose name is a filename, which is set and broken differently. */
  nameClass?: string
  meta?: ReactNode
  icon: IconName
  actionLabel: string
  onSelect: () => void
  autoFocus: boolean
}): JSX.Element {
  const { ref, props } = useFocusable({ onSelect, autoFocus, actionLabel })

  return (
    <div ref={ref as Ref<HTMLDivElement>} className="release" {...props}>
      <div className="release__body">
        <div className={nameClass ? `release__name ${nameClass}` : 'release__name'}>{name}</div>
        {meta ? <div className="release__meta">{meta}</div> : null}
      </div>
      <Icon name={icon} size={18} />
    </div>
  )
}

/**
 * One emulator that runs the platform, with what else it covers.
 *
 * How it would arrive is on the row because it is part of the choice: a flatpak
 * comes from the distribution's own store and a build comes from the project's
 * releases, which is the difference between an install the machine manages and
 * one RomMix does. An emulator with neither says nothing here and explains
 * itself on the page it leads to.
 */
export function EmulatorRow({
  descriptor,
  onSelect,
  autoFocus
}: {
  descriptor: EmulatorDescriptor
  onSelect: () => void
  autoFocus: boolean
}): JSX.Element {
  const { t } = useI18n()
  const kinds = installMethods(descriptor).map((spec) => t(INSTALL_KIND[spec.kind]))

  return (
    <ChoiceRow
      name={descriptor.name}
      meta={[t('emulator.platforms', { count: systemCount(descriptor) }), ...kinds].join(' · ')}
      icon="next"
      actionLabel={t('install.chooseEmulator')}
      onSelect={onSelect}
      autoFocus={autoFocus}
    />
  )
}

/** One way of installing it, and where that would get the program from. */
export function MethodRow({
  kind,
  detail,
  onSelect,
  autoFocus
}: {
  kind: 'flatpak' | 'appimage'
  detail: string
  onSelect: () => void
  autoFocus: boolean
}): JSX.Element {
  const { t } = useI18n()

  return (
    <ChoiceRow
      name={t(INSTALL_KIND[kind])}
      meta={detail}
      icon={kind === 'flatpak' ? 'install' : 'download'}
      actionLabel={t('install.chooseMethod')}
      onSelect={onSelect}
      autoFocus={autoFocus}
    />
  )
}

/**
 * One version.
 *
 * A release's name is often just a tag, so the row carries what actually
 * separates one from another: how long ago it was published, whether it is a
 * pre-release, and how many files it has for this machine.
 */
export function ReleaseRow({
  release,
  latest,
  onSelect,
  autoFocus
}: {
  release: EmulatorRelease
  latest: boolean
  onSelect: () => void
  autoFocus: boolean
}): JSX.Element {
  const { t, formatDateTime } = useI18n()

  return (
    <ChoiceRow
      name={
        <>
          {release.name || release.tag}
          {latest ? <StatusPill tone="ok">{t('install.latest')}</StatusPill> : null}
          {release.prerelease ? (
            <StatusPill tone="warn">{t('install.prerelease')}</StatusPill>
          ) : null}
        </>
      }
      meta={`${release.publishedAt ? formatDateTime(release.publishedAt) : t('install.noDate')} · ${t('install.builds', { count: release.assets.length })}`}
      icon="next"
      actionLabel={t('install.chooseVersion')}
      onSelect={onSelect}
      autoFocus={autoFocus}
    />
  )
}

/**
 * One downloadable file.
 *
 * The name is the whole content of the decision, so it wraps rather than being
 * ellipsised — these run to fifty characters and differ only near the end.
 */
export function AssetRow({
  asset,
  onSelect,
  autoFocus
}: {
  asset: EmulatorAsset
  onSelect: () => void
  autoFocus: boolean
}): JSX.Element {
  const { t, formatBytes } = useI18n()

  return (
    <ChoiceRow
      name={asset.name}
      nameClass="release__name--file"
      // Eden's release API reports zero for every asset, so this is left out
      // rather than printed as "0 B".
      meta={asset.sizeBytes > 0 ? formatBytes(asset.sizeBytes) : undefined}
      icon="download"
      actionLabel={t('install.chooseBuild')}
      onSelect={onSelect}
      autoFocus={autoFocus}
    />
  )
}
