/**
 * Everything RomMix passes between its processes, in one import.
 *
 * Two kinds of shape live here, and the split between the files is along that
 * line first: `romm.ts` mirrors the server's schema and spells its fields the
 * way the server does, while the rest is RomMix's own state — settings, the
 * download queue, what is on disk — and is written the way the rest of the
 * codebase is.
 *
 * One barrel rather than an import per subject. These types are the language
 * the main process, the preload bridge and the renderer share, and most of the
 * places that use one use several: a game screen wants a ROM, its saves and the
 * emulator that runs it at once. Adding a file here costs a line; a screen
 * importing from six places costs a line every time one of them moves.
 */

export * from './romm.ts'
export * from './settings.ts'
export * from './emulators.ts'
export * from './library.ts'
export * from './downloads.ts'
export * from './launch.ts'
export * from './saves.ts'
export * from './bios.ts'
export * from './updates.ts'
export * from './system.ts'
