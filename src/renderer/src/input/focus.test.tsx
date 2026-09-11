import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import type { JSX, Ref } from 'react'
import type { Root } from 'react-dom/client'
import { installDom } from '../test/dom.ts'

// Before React is loaded, because a window has to exist for it to render into.
// Types are erased, so importing those above costs nothing at run time.
const window = installDom()

const { act, useEffect } = await import('react')
const { createRoot } = await import('react-dom/client')
const { FocusProvider, useFocusable, useFocusContext } = await import('./focus.tsx')

/**
 * What a directional press costs.
 *
 * The focus engine measures carefully and used to re-render carelessly: the
 * context value carried the focused id, so every focusable in the application
 * woke on every press. A library paged three times holds a few hundred cards,
 * each re-allocating its props object and two closures, repeated for as long as
 * a direction is held — to move one ring from one card to another.
 *
 * That is a claim about rendering, so this is the one renderer test that
 * renders. There is no layout in happy-dom, so nothing here presses a
 * direction: `setFocus` moves the highlight by name, which is the same
 * question without the geometry. Where the geometry goes is
 * `geometry.test.ts`, and that a real press arrives at all is `test/app/`.
 */

const roots: Root[] = []
after(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
})

/** Mount a tree and hand back the host it was drawn into. */
function mount(element: JSX.Element): HTMLElement {
  const host = window.document.createElement('div')
  window.document.body.appendChild(host)
  const root = createRoot(host as unknown as HTMLElement)
  roots.push(root)
  act(() => root.render(element))
  return host as unknown as HTMLElement
}

/**
 * A focusable that says when it draws.
 *
 * The count is kept by the test rather than by the component, which is what
 * makes it a measurement rather than state: a component holding its own render
 * count would be a component whose renders are worth counting for its own sake.
 */
function Card({ name, onDraw }: { name: string; onDraw: (name: string) => void }): JSX.Element {
  onDraw(name)
  const { ref, props, focused } = useFocusable({ id: name, onSelect: () => undefined })
  return (
    <button ref={ref as unknown as Ref<HTMLButtonElement>} data-name={name} {...props}>
      {focused ? 'here' : name}
    </button>
  )
}

/**
 * Reaches the engine from inside the provider, which is the only way in.
 *
 * Handed out from an effect rather than during a render: a component that
 * writes to the world while rendering is the thing this whole file is about
 * not doing.
 */
function Driver({ take }: { take: (setFocus: (id: string) => void) => void }): null {
  const { setFocus } = useFocusContext()
  useEffect(() => take(setFocus), [take, setFocus])
  return null
}

/** What a test needs to drive the engine and count what that cost. */
function harness(): {
  drawn: Map<string, number>
  take: (setFocus: (id: string) => void) => void
  onDraw: (name: string) => void
  focus: (id: string) => void
} {
  const drawn = new Map<string, number>()
  let move: ((id: string) => void) | null = null
  return {
    drawn,
    take: (setFocus) => {
      move = setFocus
    },
    onDraw: (name) => drawn.set(name, (drawn.get(name) ?? 0) + 1),
    focus: (id) => act(() => move?.(id))
  }
}

describe('moving the highlight', () => {
  test('wakes the two cards it moves between and no others', () => {
    const { drawn, take, onDraw, focus } = harness()
    const names = Array.from({ length: 40 }, (_, index) => `card-${index}`)

    mount(
      <FocusProvider>
        <Driver take={take} />
        {names.map((name) => (
          <Card key={name} name={name} onDraw={onDraw} />
        ))}
      </FocusProvider>
    )

    focus('card-3')
    const settled = new Map(drawn)

    focus('card-7')

    // Exactly two: the one the ring left and the one it arrived at. Before the
    // registry and the focused id were split apart this was all forty, and on
    // a real library it is several hundred.
    const woken = names.filter((name) => drawn.get(name) !== settled.get(name))
    assert.deepEqual(woken.sort(), ['card-3', 'card-7'])
  })

  test('and moving it nowhere wakes nothing at all', () => {
    // A press against the end of a row settles on the card that already has the
    // highlight. Holding the direction repeats that at the repeat interval, so
    // the cheapest answer to it is no work.
    const { drawn, take, onDraw, focus } = harness()

    mount(
      <FocusProvider>
        <Driver take={take} />
        <Card name="only" onDraw={onDraw} />
      </FocusProvider>
    )

    focus('only')
    const settled = new Map(drawn)
    focus('only')

    assert.deepEqual(drawn, settled)
  })

  test('the card with the ring is the one that says it has it', () => {
    // The half a render count cannot check: that what was woken actually
    // redrew, and that `data-focused` — which is the whole of what the
    // stylesheet draws a ring from — followed.
    const { take, onDraw, focus } = harness()

    const host = mount(
      <FocusProvider>
        <Driver take={take} />
        <Card name="a" onDraw={onDraw} />
        <Card name="b" onDraw={onDraw} />
      </FocusProvider>
    )

    focus('b')

    const ringed = [...host.querySelectorAll('[data-focused="true"]')]
    assert.equal(ringed.length, 1)
    assert.equal(ringed[0].getAttribute('data-name'), 'b')
    assert.equal(ringed[0].textContent, 'here')
  })
})
