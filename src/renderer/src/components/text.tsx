import type { JSX, ReactNode } from 'react'

/**
 * A translated sentence with one `{placeholder}` filled by an element rather
 * than by a word.
 *
 * Two things in RomMix are a sentence wrapped around something that is not
 * text: the heart in the footer's signature, and the emphasised address in
 * "installed by hand, from …". Both used to be built by concatenating fragments
 * of English around the element, which is exactly the shape that cannot be
 * translated — word order is the first thing a language changes.
 *
 * So the whole sentence stays one catalogue entry, placeholder included, and
 * this splits it at the placeholder. A phrase that has moved the placeholder to
 * the front in another language comes out right without anything here knowing
 * that it did.
 */
export function Filled({
  text,
  name,
  children
}: {
  /** The translated phrase, containing `{name}` exactly once. */
  text: string
  name: string
  children: ReactNode
}): JSX.Element {
  const [before, ...rest] = text.split(`{${name}}`)
  // No placeholder is not an error worth throwing over: the sentence is still
  // the sentence, and a missing heart beats a screen that will not render.
  return (
    <>
      {before}
      {rest.length > 0 ? children : null}
      {rest.join(`{${name}}`)}
    </>
  )
}
