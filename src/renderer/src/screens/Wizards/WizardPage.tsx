import type { JSX, ReactNode } from 'react'
import { FocusButton, Hints, PageTitle } from '../../components'
import type { IconName } from '../../icons'
import { useAction } from '../../input/focus'
import { useI18n } from '../../state'

/**
 * One page of a wizard: what is being asked, and the way back.
 *
 * Both flows in this folder draw their pages here, so a sequence walked with a
 * pad looks the same whichever one it is — the line above the heading, where
 * Back sits, and what B does. They were two components saying the same thing
 * before, and the second was written by copying the first.
 *
 * What differs between them is the line above the heading. Setup counts its
 * pages because it has three of them, fixed; the install flow cannot, because
 * how many pages it has is not known until they are answered — an emulator
 * packaged two ways asks which, and only a downloaded build asks for a version
 * and a file. A counter that grew as it was answered would say less than
 * nothing, so that flow names itself there instead.
 *
 * Both buttons are optional and both carry their own `data-action`: a page that
 * is a list is answered by choosing from it rather than by pressing Next, and
 * the first page of a flow has nothing behind it.
 */
export interface WizardPageProps {
  /** The line over the heading: a position in setup, or the flow's own name. */
  eyebrow: string
  /**
   * The flow's mark, beside the heading.
   *
   * The same one the button that opens the flow carries, which is the only
   * thing a wizard has to be recognised by: it answers to no menu item, so
   * there is no icon in a bar for it to agree with. Setup passes none — it is
   * the first screen of a fresh installation, with nothing yet to recognise it
   * against.
   */
  icon?: IconName
  title: string
  subtitle?: string
  /** Absent on a first page, and while an install is running. */
  back?: { name: string; onSelect: () => void }
  /** The page's own button, where the page is read rather than answered. */
  action?: { name: string; label: string; icon: IconName; onSelect: () => void }
  children?: ReactNode
}

export function WizardPage({
  eyebrow,
  icon,
  title,
  subtitle,
  back,
  action,
  children
}: WizardPageProps): JSX.Element {
  const { t } = useI18n()
  // B steps back a page rather than out of the screen, so it agrees with the
  // button beside it. The shell leaves `back` alone on both of these routes for
  // exactly that reason — see `App`.
  useAction('back', () => back?.onSelect(), Boolean(back))

  return (
    <div className="content">
      {/* Over the heading rather than inside it: the mark and the words are one
          row, and where this page sits in the sequence is not part of either. */}
      <span className="wizard__step">{eyebrow}</span>
      <PageTitle icon={icon}>{title}</PageTitle>
      {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}

      {children}

      {back || action ? (
        <div className="btn-row">
          {/* Back on the left and the thing you came to press on the right, the
              same two ends every other screen has: a wizard should not be a
              fourth navigation model to learn. */}
          {back ? (
            <FocusButton
              icon="previous"
              action={back.name}
              variant="ghost"
              onSelect={back.onSelect}
            >
              {t('action.back')}
            </FocusButton>
          ) : null}
          {action ? (
            <FocusButton
              icon={action.icon}
              action={action.name}
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
          ...(back ? [{ key: 'B', label: t('action.back') }] : [])
        ]}
      />
    </div>
  )
}
