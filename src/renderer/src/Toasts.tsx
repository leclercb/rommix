/**
 * Notifications, drawn over whatever is on screen.
 *
 * Beside `App` for the same reason as the running overlay: it belongs to the
 * shell rather than to any screen, and nothing navigates to it.
 */

import type { JSX } from 'react'
import { CoverArt, PlatformIcon } from './components'
import { useToasts } from './state'

/**
 * Notifications, all one shape.
 *
 * A toast about a game leads with its cover and title and then says what
 * happened; one about the app is just the message. The uniformity is the point:
 * every notification concerning a game says which game, in the same place.
 */
export function Toasts(): JSX.Element {
  const toasts = useToasts()

  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`notice toast ${
            toast.tone === 'error'
              ? 'notice--error'
              : toast.tone === 'warn'
                ? 'notice--warn'
                : 'notice--ok'
          }`}
        >
          {toast.title ? (
            <div className="toast__art" data-kind={toast.platform ? 'platform' : 'game'}>
              {toast.platform ? (
                <PlatformIcon
                  slug={toast.platform.slug}
                  system={toast.platform.system}
                  size={40}
                  label={toast.title}
                />
              ) : (
                <CoverArt path={toast.coverPath ?? null} name={toast.title} />
              )}
            </div>
          ) : null}
          <div className="toast__body">
            {toast.title ? <div className="toast__title">{toast.title}</div> : null}
            <div className="toast__message">{toast.message}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
