import type { JSX, ReactNode } from 'react'
import { FocusButton, Hints, PageTitle } from '../../components'
import type { IconName } from '../../icons'
import { useAction } from '../../input/focus'
import { useI18n } from '../../state'

/**
 * One page of the install flow: what is being asked, and the way back.
 *
 * The same shape as first-run setup's pages — see `SetupPage` — because it is
 * the same kind of screen: a sequence walked with a pad, one question to a
 * page, rather than a dialog over the screen that raised it. Installing an
 * emulator is a version, a build and several minutes of downloading, and none
 * of that fits in a panel.
 *
 * There is no "step 3 of 5". How many pages this has is not known until the
 * answers are: an emulator packaged two ways asks which, and only a downloaded
 * build asks for a version and a file. A counter that grew as it was answered
 * would say less than nothing, so the eyebrow names the flow instead.
 *
 * Most pages are a list, and choosing from it *is* the step — which is why the
 * button is optional and never says Next. The pages that have one are the two
 * that end: nothing to install, and installed.
 */
export function WizardPage({
  title,
  subtitle,
  onBack,
  action,
  children
}: {
  title: string
  subtitle?: string
  /** Absent while an install is running, which is the one page with no way back. */
  onBack?: () => void
  /** The page's own button, where the page is read rather than answered. */
  action?: { label: string; icon: IconName; onSelect: () => void }
  children?: ReactNode
}): JSX.Element {
  const { t } = useI18n()
  // B steps back a page here rather than leaving the screen, so the two agree
  // with one another and with every other wizard in the app. The shell leaves
  // `back` alone on this route for exactly that reason — see `App`.
  useAction('back', () => onBack?.(), Boolean(onBack))

  return (
    <div className="content">
      <PageTitle>
        <span className="setup__step">{t('install.flow')}</span>
        {title}
      </PageTitle>
      {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}

      {children}

      {onBack || action ? (
        <div className="btn-row">
          {onBack ? (
            <FocusButton icon="previous" action="install-back" variant="ghost" onSelect={onBack}>
              {t('action.back')}
            </FocusButton>
          ) : null}
          {action ? (
            <FocusButton
              icon={action.icon}
              action="install-done"
              variant="primary"
              onSelect={action.onSelect}
              autoFocus
            >
              {action.label}
            </FocusButton>
          ) : null}
        </div>
      ) : null}

      <Hints
        items={[
          { key: 'A', label: t('action.select') },
          { key: '↕', label: t('action.navigate') },
          ...(onBack ? [{ key: 'B', label: t('action.back') }] : [])
        ]}
      />
    </div>
  )
}
