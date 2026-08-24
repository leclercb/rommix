/**
 * The four tabs of the Settings page, as one import.
 *
 * Each holds one subject and owns whatever state only it needs — the support
 * dialog, the folder being typed — so the screen around them is the tab strip,
 * the two things both tabs read (the pre-flight report and RomMix's folder), and
 * nothing else.
 */

export { EmulatorsTab } from './EmulatorsTab'
export { GamesTab } from './GamesTab'
export { GeneralTab } from './GeneralTab'
export { SystemTab } from './SystemTab'
