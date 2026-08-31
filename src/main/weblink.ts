/**
 * Whether a URL is one the desktop may be asked to open.
 *
 * `shell.openExternal` is a hole from the renderer straight out to the
 * desktop's URL handlers, and those cover a great deal more than the web —
 * `file:`, `.desktop` actions, anything a scheme has been registered for.
 * RomMix only ever opens web addresses: its own releases page, its support
 * page, and the server the user typed. A scheme check therefore costs nothing
 * and stops the call being useful to anything else.
 *
 * Stated here rather than beside either caller because there are two of them —
 * the `system:openExternal` channel and the handler for a link the interface
 * asked to open in a new window — and a guard on one of two holes is not a
 * guard.
 */
export function isWebAddress(url: string): boolean {
  return /^https?:\/\//i.test(url)
}
