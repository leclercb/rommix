/**
 * What the page does when focus moves: bring the new element into view, and —
 * at the ends of a run — show the parts of the page nothing focusable lives in.
 *
 * Separate from the geometry because this is the half that touches the document:
 * every function here reads layout or scrolls something.
 */

/**
 * Close enough to an end of the page to go all the way there.
 *
 * `scrollIntoView` moves the least it can get away with, so walking up a page
 * stops with the first row flush against the top edge and the page's own title
 * still hidden above it — the page never appears to reach the top. Focus near
 * either end therefore scrolls to that end instead of to the element, which is
 * what "up" means to someone holding the stick.
 */
const SNAP_TO_EDGE_PX = 260

/**
 * How this page is allowed to scroll.
 *
 * Every focus move scrolls something, and on a grid of covers that is one
 * animated slide per press of a held direction. For someone who has asked their
 * system for reduced motion that is precisely the effect the setting exists to
 * turn off — so the scrolling still happens, it simply arrives rather than
 * travels.
 *
 * Read per call rather than cached: the preference can change while the app is
 * open, and `matchMedia` is a property lookup.
 */
function scrollBehavior(): ScrollBehavior {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/** The nearest ancestor that actually scrolls, if there is one. */
function scrollParentOf(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement
  while (node) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/** The same, for the sideways axis: the shelf a card sits in. */
function horizontalScrollParentOf(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement
  while (node) {
    const overflow = getComputedStyle(node).overflowX
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollWidth > node.clientWidth) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/**
 * Bring the card its own shelf is hiding into view.
 *
 * Done as its own step because the vertical pass below can return early — a
 * shelf near the top of the page snaps the page to the top and stops there, and
 * on the home screen that is the first two shelves. Walking right along one of
 * them then moved the highlight onto cards off the right-hand edge and never
 * scrolled to them, which reads as focus simply disappearing.
 */
function revealAcross(element: HTMLElement): void {
  const shelf = horizontalScrollParentOf(element)
  if (!shelf) return

  const card = element.getBoundingClientRect()
  const view = shelf.getBoundingClientRect()
  // A margin so the card that is *next* is visible too: a highlight flush
  // against the edge gives no sense of what walking further would reach.
  const margin = card.width * 0.75
  if (card.left - margin < view.left) {
    shelf.scrollBy({ left: card.left - margin - view.left, behavior: scrollBehavior() })
  } else if (card.right + margin > view.right) {
    shelf.scrollBy({ left: card.right + margin - view.right, behavior: scrollBehavior() })
  }
}

/**
 * Bring a newly focused element into view, snapping to the ends of the page.
 *
 * Only the focused element is measured — the registry can hold a couple of
 * thousand rows, and this runs on every press of a held direction.
 */
export function revealElement(element: HTMLElement): void {
  revealAcross(element)

  const scroller = scrollParentOf(element)
  if (scroller) {
    // Where the element sits inside the scrolled content, not the viewport.
    const top =
      scroller.scrollTop +
      (element.getBoundingClientRect().top - scroller.getBoundingClientRect().top)
    const bottom = top + element.offsetHeight

    if (top <= SNAP_TO_EDGE_PX) {
      scroller.scrollTo({ top: 0, behavior: scrollBehavior() })
      return
    }
    if (bottom >= scroller.scrollHeight - SNAP_TO_EDGE_PX) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: scrollBehavior() })
      return
    }
  }
  // `inline: 'nearest'` because the sideways axis was settled above, and
  // 'center' would fight it — re-centring every card of a shelf as focus walks
  // along it, which slides the whole row under a highlight that never moves.
  element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: scrollBehavior() })
}

/**
 * Scroll to the end of the page when there is nothing further to focus.
 *
 * A page is not only its buttons. Titles, the paragraph explaining what a
 * screen is for, the note under the last row — none of it is focusable, so
 * walking to the last item leaves the rest of the page unread and the next
 * press does nothing at all. That press means "further down"; this gives it
 * that meaning. It goes to the very end rather than by a screenful because
 * there is nothing focusable in between that could be skipped past.
 *
 * Returns false when the page is already at that end, which leaves the press
 * genuinely inert — the honest answer when there is nothing more to show.
 */
export function scrollToEnd(element: HTMLElement, direction: 'up' | 'down'): boolean {
  const scroller = scrollParentOf(element)
  if (!scroller) return false

  const room =
    direction === 'up'
      ? scroller.scrollTop
      : scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
  if (room <= 1) return false

  scroller.scrollTo({
    top: direction === 'up' ? 0 : scroller.scrollHeight,
    behavior: scrollBehavior()
  })
  return true
}
