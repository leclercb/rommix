import type { Direction } from './types'

/**
 * Which element lies in a given direction, decided by measurement.
 *
 * Browsers have no notion of "the thing to the right of this thing", so the
 * focus engine picks the next element geometrically. This is that arithmetic,
 * kept apart from the registry it is run over: it touches nothing but rectangles
 * and can be reasoned about — and corrected — on its own.
 */

export interface Rect {
  cx: number
  cy: number
  left: number
  right: number
  top: number
  bottom: number
}

export function rectOf(element: HTMLElement): Rect {
  const r = element.getBoundingClientRect()
  return {
    cx: r.left + r.width / 2,
    cy: r.top + r.height / 2,
    left: r.left,
    right: r.right,
    top: r.top,
    bottom: r.bottom
  }
}

/**
 * How much closer one candidate must be to count as genuinely nearer.
 *
 * Everything within this of the closest candidate is treated as being the same
 * distance away — one row of a grid, one line of a list — and is settled by
 * column instead. Cards in a row rarely align to the pixel once their titles
 * wrap, so the band has to be wider than that jitter and narrower than the gap
 * between two rows.
 */
export const SAME_STEP_PX = 24

export interface Measure {
  /** Distance to travel, edge to edge. */
  gap: number
  /** How far out of the line of travel, 0 when the line passes through it. */
  cross: number
}

/**
 * Measure a candidate for a directional move, or null when it does not lie in
 * that direction at all.
 *
 * Both terms are edge-to-edge rather than centre-to-centre. Centres make an
 * element's *size* count as distance: a tall row directly below would lose to a
 * short one further away but nearer the middle.
 *
 * The two are deliberately *not* combined into one number. Weighing distance
 * against alignment lets a well-aligned element two rows down beat the row
 * immediately below — which is how a press ends up skipping something the user
 * can plainly see. Distance decides; alignment only settles candidates that are
 * the same distance away.
 */
export function measure(
  from: Rect,
  to: Rect,
  direction: Direction,
  anchor: number
): Measure | null {
  const vertical = direction === 'down' || direction === 'up'

  /**
   * One of these sits inside the other: a row that is itself selectable, and
   * the Cancel or Uninstall button drawn within it.
   *
   * Edge-to-edge measurement cannot see these at all — a button inside a row
   * has a negative gap in all four directions, so it is rejected as "not that
   * way" from every side and simply cannot be reached. They are related by
   * containment rather than by distance, so the comparison is between centres.
   *
   * Deliberately sideways only. Letting Down step into a row's own buttons
   * would put one or two extra stops inside every row of a list that can run to
   * thousands, when the point of walking down is to pass them. Right reaches
   * the actions, Left comes back out, Down carries on to the next row.
   */
  const inside = (outer: Rect, inner: Rect): boolean =>
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom

  if (inside(from, to) || inside(to, from)) {
    if (vertical) return null
    const towards = direction === 'right' ? to.cx > from.cx : to.cx < from.cx
    return towards ? { gap: 0, cross: 0 } : null
  }

  const gap =
    direction === 'down'
      ? to.top - from.bottom
      : direction === 'up'
        ? from.top - to.bottom
        : direction === 'right'
          ? to.left - from.right
          : from.left - to.right

  // A one-pixel tolerance: adjacent rows often share a boundary exactly.
  if (gap < -1) return null

  const cross = vertical
    ? Math.max(0, to.left - anchor, anchor - to.right)
    : Math.max(0, to.top - anchor, anchor - to.bottom)

  return { gap: Math.max(gap, 0), cross }
}
