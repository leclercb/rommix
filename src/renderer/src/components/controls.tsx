import { type JSX, type ReactNode, type Ref } from 'react'
import type { I18n } from '@shared/i18n'
import type { RomStorage } from '@shared/types'
import { useAction, useFocusable } from '../input/focus'
import { Icon, type IconName } from '../icons'
import { useI18n } from '../state'

/** The things a controller presses: buttons, fields, tabs and settings rows. */

export function FocusButton({
  children,
  onSelect,
  variant = 'default',
  disabled = false,
  autoFocus = false,
  icon,
  on,
  action,
  actionLabel
}: {
  children?: ReactNode
  onSelect: () => void
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  autoFocus?: boolean
  /** Drawn before the label — or alone, where the mark is unambiguous. */
  icon?: IconName
  /**
   * For a button that is also a state: the icon is filled in when it is on.
   *
   * Only the icon. A button that changed colour with its state would read as a
   * warning rather than as something the user has switched on, and the label
   * still says what pressing it does either way.
   */
  on?: boolean
  /**
   * What this does, for the hint bar and for assistive tech.
   *
   * Taken from the button's own text when that is a plain string. A button with
   * no text has to say it here: an icon on its own leaves the hint bar with
   * nothing to report and a screen reader with nothing to read.
   */
  actionLabel?: string
  /**
   * What this button is, in a word that does not change with the language.
   *
   * Only for the buttons an integration test presses. Everything on screen is
   * drawn from the catalogue, so the only durable handle on a button is one it
   * carries deliberately — matching on its text means a test that passes in
   * English and fails in French, and matching on its position means a test that
   * breaks the next time a button is added beside it.
   *
   * Opt-in, and meant to stay that way: a button with none is a button no test
   * drives, which is most of them.
   */
  action?: string
}): JSX.Element {
  const { ref, props } = useFocusable({
    onSelect: disabled ? undefined : onSelect,
    enabled: !disabled,
    autoFocus,
    // A button's own text is what pressing A does, so the hint bar needs
    // nothing declared at the call site. Anything richer than a string — a
    // label built from several pieces — says nothing and leaves the screen's
    // own hint standing.
    actionLabel: actionLabel ?? (typeof children === 'string' ? children : undefined)
  })

  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      className={`btn ${variant === 'default' ? '' : `btn--${variant}`}`}
      data-action={action}
      data-disabled={disabled}
      data-on={on}
      aria-label={actionLabel}
      title={children === undefined ? actionLabel : undefined}
      {...props}
    >
      {/* Beside the word wherever there is one: an icon alone is a guess on a
          television three metres away. Where a button is icon-only by design,
          `actionLabel` is what the hint bar reads back for it. */}
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  )
}

/**
 * A text field that a controller can reach.
 *
 * Pressing A moves real DOM focus into the input, at which point Steam's Big
 * Picture on-screen keyboard (or a real keyboard) takes over. Escape hands
 * control back to the spatial navigator.
 */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  hint,
  autoFocus = false
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'password'
  hint?: string
  autoFocus?: boolean
}): JSX.Element {
  const { t } = useI18n()
  const { ref, props } = useFocusable({
    onSelect: () => (ref.current as HTMLInputElement | null)?.focus(),
    autoFocus,
    actionLabel: t('action.type')
  })

  return (
    <div className="field">
      <label className="field__label">{label}</label>
      <input
        ref={ref as Ref<HTMLInputElement>}
        className="field__input"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') (event.target as HTMLInputElement).blur()
        }}
        {...props}
      />
      {hint ? <div className="field__hint">{hint}</div> : null}
    </div>
  )
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="segmented">
      {options.map((option) => (
        <SegmentedOption
          key={option.value}
          label={option.label}
          active={option.value === value}
          onSelect={() => onChange(option.value)}
        />
      ))}
    </div>
  )
}

function SegmentedOption({
  label,
  active,
  onSelect
}: {
  label: string
  active: boolean
  onSelect: () => void
}): JSX.Element {
  const { ref, props } = useFocusable({ onSelect })
  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      className="segmented__option"
      data-active={active}
      {...props}
    >
      {label}
    </button>
  )
}

/**
 * A tab strip.
 *
 * Bound to LB/RB (and shift-Tab/Tab) as well as being focusable, because a tab
 * strip that can only be reached by walking focus up to it is a tab strip
 * nobody uses on a controller — the shoulder buttons are where a console UI
 * puts this, and the hint bar says so.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange
}: {
  /** `badge` is a count, as the Saves tab has, or a short word — a version. */
  tabs: { id: T; label: string; icon?: IconName; badge?: number | string }[]
  active: T
  onChange: (id: T) => void
}): JSX.Element {
  const step = (delta: number): void => {
    const index = tabs.findIndex((tab) => tab.id === active)
    if (index < 0) return
    onChange(tabs[(index + delta + tabs.length) % tabs.length].id)
  }

  useAction('tabLeft', () => step(-1))
  useAction('tabRight', () => step(1))

  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <TabButton
          key={tab.id}
          id={tab.id}
          label={tab.label}
          icon={tab.icon}
          badge={tab.badge}
          active={tab.id === active}
          onSelect={() => onChange(tab.id)}
        />
      ))}
    </div>
  )
}

function TabButton({
  id,
  label,
  icon,
  badge,
  active,
  onSelect
}: {
  id: string
  label: string
  icon?: IconName
  badge?: number | string
  active: boolean
  onSelect: () => void
}): JSX.Element {
  const { ref, props } = useFocusable({ onSelect })
  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      className="tab"
      data-tab={id}
      data-active={active}
      {...props}
    >
      {/* Never instead of the word: a strip of marks alone is a puzzle from the
          sofa, and the shoulder buttons move through it without reading it. */}
      {icon ? <Icon name={icon} size={17} /> : null}
      {label}
      {badge != null ? <span className="tab__badge">{badge}</span> : null}
    </button>
  )
}

/**
 * A labelled setting with its own On/Off control, rather than the label
 * smuggled into the text of one of the options.
 */
export function Toggle({
  label,
  hint,
  on,
  onToggle
}: {
  label: string
  hint?: string
  on: boolean
  onToggle: () => void
}): JSX.Element {
  const { t } = useI18n()
  return (
    <div className="setting">
      <div className="setting__text">
        <div className="setting__label">{label}</div>
        {hint ? <div className="setting__hint">{hint}</div> : null}
      </div>
      <SegmentedControl<'on' | 'off'>
        value={on ? 'on' : 'off'}
        onChange={(next) => {
          if ((next === 'on') !== on) onToggle()
        }}
        options={[
          { value: 'on', label: t('value.on') },
          { value: 'off', label: t('value.off') }
        ]}
      />
    </div>
  )
}

/** The same row as `Toggle`, for a setting with more than two answers. */
export function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  onChange
}: {
  label: string
  hint?: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="setting">
      <div className="setting__text">
        <div className="setting__label">{label}</div>
        {hint ? <div className="setting__hint">{hint}</div> : null}
      </div>
      <SegmentedControl<T> value={value} options={options} onChange={onChange} />
    </div>
  )
}

/**
 * The scales offered, as the strings the segmented control switches on.
 *
 * A short list of round numbers rather than a slider: this is a control being
 * driven from a sofa, and every value between 100% and 200% that anyone would
 * actually stop at is here. `auto` is 0 in settings — see `Settings.uiScale`.
 *
 * Here rather than beside the Settings screen because the first-run wizard asks
 * the same question, and two lists of scales would drift apart.
 */
export type UiScaleChoice = 'auto' | '1' | '1.25' | '1.5' | '2'

const UI_SCALE_VALUES: UiScaleChoice[] = ['auto', '1', '1.25', '1.5', '2']

/**
 * The scales as a segmented control's options.
 *
 * A function of the catalogue rather than a constant, because one of the five
 * is a word: `auto` is "however big the screen says", and the other four are
 * percentages, which read the same in every language RomMix speaks.
 */
export function uiScaleOptions(t: I18n['t']): { value: UiScaleChoice; label: string }[] {
  return UI_SCALE_VALUES.map((value) => ({
    value,
    label: value === 'auto' ? t('value.auto') : `${Number(value) * 100}%`
  }))
}

/** The stored number as one of the offered choices, falling back to Auto. */
export function uiScaleChoice(scale: number): UiScaleChoice {
  const match = UI_SCALE_VALUES.find((value) => value === String(scale))
  return match ?? 'auto'
}

/**
 * Where downloaded games go. Asked in Settings and again by the first-run
 * wizard, which is the only reason it is a component rather than two lines.
 */
export function RomStorageChoice({
  value,
  onChange
}: {
  value: RomStorage
  onChange: (value: RomStorage) => void
}): JSX.Element {
  const { t } = useI18n()
  return (
    <Choice<RomStorage>
      label={t('storage.label')}
      hint={value === 'rommix' ? t('storage.hintShared') : t('storage.hintPerEmulator')}
      value={value}
      options={[
        { value: 'emulator', label: t('storage.optionEmulator') },
        { value: 'rommix', label: t('storage.optionRomMix') }
      ]}
      onChange={onChange}
    />
  )
}
