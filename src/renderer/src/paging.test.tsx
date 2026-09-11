import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import type { JSX } from 'react'
import type { Root } from 'react-dom/client'
import type { RommRom, RommRomPage, RomQuery } from '@shared/types'
import type { RomPages } from './paging.ts'
import { installDom } from './test/dom.ts'

// Before React is loaded, because a window has to exist for it to render into.
// See `focus.test.tsx`.
const window = installDom()

const { act, useEffect, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useRomPages } = await import('./paging.ts')

/**
 * What paging does while the answers are still out.
 *
 * `useRomPages` is the whole of RomMix's paging, and the one part of the
 * renderer nothing else reaches. The screens that page are components, which
 * `npm run test:app` proves against a real window — but the library the fake
 * server holds is smaller than a page, so no scenario there has ever asked for
 * a second one. Everything here happens on the way to that second page, or
 * while the answer to the first is still on the wire.
 *
 * Both hooks this replaced drifted while they were two, and in the same place:
 * one freed the in-flight guard on behalf of a request it had stopped
 * listening to, and only one exempted a first page from that guard — which is
 * what left a shelf empty after a handheld came back into range. Those two are
 * the reason this file renders rather than testing rules in the abstract: what
 * went wrong was the order effects and answers arrived in.
 *
 * The sentinel is not here. `usePagedRoms` watches an element for coming into
 * view, and happy-dom gives nothing a box — that a real grid fetches when it is
 * walked to the bottom is `test/app/`'s to prove.
 */

/** How many games a page is here. Small, so a full page is two answers away. */
const PAGE = 2

const roots: Root[] = []
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
})

/** Let the answers that are due land, and React draw what they changed. */
async function settle(): Promise<void> {
  await act(async () => undefined)
}

/** Press something the hook handed out, and let what it started land. */
async function press(action: () => void): Promise<void> {
  act(action)
  await settle()
}

/** A request the hook has put on the wire, held open until a test answers it. */
interface Call {
  query: RomQuery
  /** Send a page back. `total` is what the server counted, if it counted. */
  answer: (ids: number[], total?: number | null) => Promise<void>
  /** Refuse it, as a server that is there but will not answer does. */
  refuse: (message: string) => Promise<void>
}

/**
 * A `window.rommix.library.roms` that answers when the test says so.
 *
 * Every question in this file is about the gap between a request going out and
 * its answer coming back, so nothing may resolve on its own.
 */
function serve(): Call[] {
  const calls: Call[] = []
  const roms = (query: RomQuery): Promise<RommRomPage> =>
    new Promise<RommRomPage>((resolve, reject) => {
      calls.push({
        query,
        answer: async (ids, total = null) => {
          resolve({
            items: ids.map((id) => ({ id, name: `Game ${id}` }) as unknown as RommRom),
            total,
            limit: query.limit ?? 0,
            offset: query.offset ?? 0
          })
          await settle()
        },
        refuse: async (message) => {
          reject(new Error(message))
          await settle()
        }
      })
    })
  Object.defineProperty(window, 'rommix', {
    value: { library: { roms } },
    configurable: true,
    writable: true
  })
  return calls
}

/** What the hook is drawn with, and what a screen changes about it. */
interface Props {
  query: RomQuery
  enabled: boolean | null
  forget: boolean
}

/** A mounted grid, and the handles a test drives it by. */
interface Screen {
  /** Every request that has gone out, in the order they went. */
  calls: Call[]
  /** The last thing the hook answered with. */
  pages: () => RomPages
  /** Every message `onError` has been handed, `null`s included. */
  errors: (string | null)[]
  /** Draw again with a different query, or enabled differently. */
  redraw: (next: Partial<Props>) => Promise<void>
}

/** Mount one grid on the query it is about. */
function open(props: Partial<Props> = {}): Screen {
  const calls = serve()
  const errors: (string | null)[] = []
  let latest: RomPages | null = null
  let again: ((next: (current: Props) => Props) => void) | null = null

  // Stable, as the hook says its `onError` has to be: a new function each draw
  // would rebuild the fetch and send the grid back to its first page on every
  // render.
  const onError = (message: string | null): void => {
    errors.push(message)
  }

  function Grid({ query, enabled, forget }: Props): null {
    const pages = useRomPages(query, {
      pageSize: PAGE,
      enabled,
      forgetOnStandDown: forget,
      onError
    })
    // Taken after the draw rather than during it, on every draw: what a test
    // presses has to be the `loadMore` the grid actually committed.
    useEffect(() => {
      latest = pages
    })
    return null
  }

  function Screenful(): JSX.Element {
    const [current, setCurrent] = useState<Props>({
      query: props.query ?? {},
      // `in` rather than a fallback, because `null` is one of the three
      // answers `enabled` can carry and not an absent one.
      enabled: 'enabled' in props ? (props.enabled ?? null) : true,
      forget: props.forget ?? false
    })
    useEffect(() => {
      again = setCurrent
    }, [])
    return <Grid {...current} />
  }

  const host = window.document.createElement('div')
  window.document.body.appendChild(host)
  const root = createRoot(host as unknown as HTMLElement)
  roots.push(root)
  act(() => root.render(<Screenful />))

  return {
    calls,
    pages: () => latest as RomPages,
    errors,
    redraw: async (next) => {
      act(() => again?.((current) => ({ ...current, ...next })))
      await settle()
    }
  }
}

/** The games the grid is holding, which is the whole of what it draws. */
function held(screen: Screen): number[] {
  return screen.pages().roms.map((rom) => rom.id)
}

describe('paging a query', () => {
  test('asks for the first page of the query it was given', async () => {
    const screen = open({ query: { search_term: 'cave', platform_ids: [1] } })

    assert.equal(screen.calls.length, 1)
    assert.deepEqual(screen.calls[0].query, {
      search_term: 'cave',
      platform_ids: [1],
      limit: PAGE,
      offset: 0
    })
    assert.equal(screen.pages().loading, true)
    assert.equal(screen.pages().settled, false)

    await screen.calls[0].answer([1, 2], 7)

    assert.deepEqual(held(screen), [1, 2])
    assert.equal(screen.pages().total, 7)
    assert.equal(screen.pages().loading, false)
    assert.equal(screen.pages().settled, true)
  })

  test('and the next one carries on from what is held', async () => {
    const screen = open()
    await screen.calls[0].answer([1, 2])
    // A page that came back full is one the server had to stop filling.
    assert.equal(screen.pages().more, true)

    await press(() => screen.pages().loadMore())
    assert.equal(screen.calls[1].query.offset, 2)
    await screen.calls[1].answer([3])

    assert.deepEqual(held(screen), [1, 2, 3])
    // Short, so that was the end of the query. See `hasMorePages`.
    assert.equal(screen.pages().more, false)
  })

  test('and nothing asks past the end of it', async () => {
    const screen = open()
    await screen.calls[0].answer([1])

    await press(() => screen.pages().loadMore())

    assert.equal(screen.calls.length, 1)
  })

  test('and a grid with nothing in it has nothing to carry on from', async () => {
    const screen = open()
    await screen.calls[0].answer([])

    await press(() => screen.pages().loadMore())

    assert.equal(screen.calls.length, 1)
  })

  test('a query rebuilt from the same fields is not asked for twice', async () => {
    const screen = open({ query: { search_term: 'cave' } })
    await screen.calls[0].answer([1, 2])

    // What a screen passes is an object literal, which is a new reference on
    // every draw. Compared by identity, this put the grid back to its first
    // page each time anything else on the screen changed.
    await screen.redraw({ query: { search_term: 'cave' } })

    assert.equal(screen.calls.length, 1)
  })

  test('and a query that did change starts again at the first page', async () => {
    const screen = open({ query: { search_term: 'cave' } })
    await screen.calls[0].answer([1, 2])
    await press(() => screen.pages().loadMore())
    await screen.calls[1].answer([3])

    await screen.redraw({ query: { search_term: 'tobu' } })
    assert.equal(screen.calls[2].query.offset, 0)
    await screen.calls[2].answer([9])

    // Replaced rather than appended: a first page is the whole of what is held.
    assert.deepEqual(held(screen), [9])
  })
})

describe('two requests at once', () => {
  test('a second page is not asked for while one is out', async () => {
    const screen = open()
    await screen.calls[0].answer([1, 2])

    // The sentinel stays in view while the page it asked for is loading, and
    // fires again. One request per page is enough.
    act(() => {
      screen.pages().loadMore()
      screen.pages().loadMore()
    })
    await settle()

    assert.equal(screen.calls.length, 2)
  })

  test('but a first page takes over from one that is out', async () => {
    const screen = open({ query: { search_term: 'cave' } })

    // The search term typed into while the page for the old one is still on
    // the wire — and the same shape as a shelf coming back into range while a
    // request nothing is listening to is still out. Held behind that request,
    // the grid asks for nothing and stays on what the query before it matched.
    await screen.redraw({ query: { search_term: 'tobu' } })

    assert.equal(screen.calls.length, 2)
    assert.equal(screen.calls[1].query.search_term, 'tobu')
  })

  test('and the answer to the one it took over from changes nothing', async () => {
    const screen = open({ query: { search_term: 'cave' } })
    await screen.redraw({ query: { search_term: 'tobu' } })

    await screen.calls[0].answer([1, 2])

    // Not drawn — and, the half that is easy to get wrong, not counted as the
    // end of the request that is still out either. A stale page that settles
    // the grid frees the guard, and the next page starts beside the live one.
    assert.deepEqual(held(screen), [])
    assert.equal(screen.pages().loading, true)
    assert.equal(screen.pages().settled, false)

    await screen.calls[1].answer([9])

    assert.deepEqual(held(screen), [9])
  })

  test('and a refusal it had stopped listening to is not reported', async () => {
    const screen = open({ query: { search_term: 'cave' } })
    await screen.redraw({ query: { search_term: 'tobu' } })

    await screen.calls[0].refuse('no route to host')

    // A screen working perfectly well on the query it moved to, with an error
    // over it about the one it left.
    assert.equal(screen.errors.includes('no route to host'), false)
  })
})

describe('standing down', () => {
  test('nothing is asked while there is nothing to ask', async () => {
    const screen = open({ enabled: false })

    assert.equal(screen.calls.length, 0)
  })

  test('and nothing is said at all before the first connection answer', async () => {
    const screen = open({ enabled: null })

    assert.equal(screen.calls.length, 0)
    // Settling is a statement — a shelf draws itself as empty on it — and
    // nothing is known yet. See `useRomPages.enabled`.
    assert.equal(screen.pages().settled, false)
  })

  test('standing down disowns what is on the wire', async () => {
    const screen = open()
    await screen.redraw({ enabled: false })

    await screen.calls[0].answer([1, 2])

    assert.deepEqual(held(screen), [])
  })

  test('and keeps what is held, where it was not told to forget', async () => {
    const screen = open()
    await screen.calls[0].answer([1, 2])

    await screen.redraw({ enabled: false })

    // The library grid's case: its caller swaps the downloaded index in over
    // these rather than drawing them.
    assert.deepEqual(held(screen), [1, 2])
  })

  test('and a shelf told to forget clears, and says it has finished', async () => {
    const screen = open({ forget: true })
    await screen.calls[0].answer([1, 2])

    await screen.redraw({ enabled: false })

    assert.deepEqual(held(screen), [])
    assert.equal(screen.pages().more, false)
    assert.equal(screen.pages().settled, true)
  })

  test('and asks again on the way back, whatever was out when it left', async () => {
    const screen = open()

    // Carried out of range while the first page was still on the wire, and
    // back again.
    await screen.redraw({ enabled: false })
    await screen.redraw({ enabled: true })

    // The request it left is disowned and the guard handed back, so the page
    // it comes back on is its own rather than the one it was waiting for.
    assert.equal(screen.calls.length, 2)

    await screen.calls[1].answer([1, 2])

    assert.deepEqual(held(screen), [1, 2])
  })
})

describe('a page that failed', () => {
  test('says why, and stops the grid waiting on it', async () => {
    const screen = open()

    await screen.calls[0].refuse('no route to host')

    assert.equal(screen.errors.at(-1), 'no route to host')
    assert.equal(screen.pages().loading, false)
    assert.equal(screen.pages().settled, true)
  })

  test('and the message goes on the way into the next attempt', async () => {
    const screen = open()
    await screen.calls[0].refuse('no route to host')

    await press(() => screen.pages().reload())

    // Cleared on the way in rather than on the way out, so the notice is gone
    // while the retry is running rather than only once it has worked.
    assert.equal(screen.errors.at(-1), null)

    await screen.calls[1].answer([1, 2])

    assert.deepEqual(held(screen), [1, 2])
    assert.equal(screen.errors.at(-1), null)
  })
})
