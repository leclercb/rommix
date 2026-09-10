/**
 * The tabs of a game's page, as one import.
 *
 * Each answers a different question about the same game — what it is, what it
 * has saved, what it is made of, what it looks like, which dump of it this is —
 * and none of them knows anything about the screen around it: every one takes
 * the game, or the list it draws, and nothing else.
 *
 * Four are always there. Versions is the exception, drawn only for a game the
 * server holds more than one file of, because a tab that is empty for most of a
 * library reads as something missing rather than as something absent.
 */

export { DetailsTab } from './DetailsTab'
export { FilesTab } from './FilesTab'
export { SavesTab, deleteScopeLabel, deleteScopesOf } from './SavesTab'
export { ScreenshotsTab } from './ScreenshotsTab'
export { VersionsTab } from './VersionsTab'
