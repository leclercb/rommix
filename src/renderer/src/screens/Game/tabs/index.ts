/**
 * The four tabs of a game's page, as one import.
 *
 * Each answers a different question about the same game — what it is, what it
 * has saved, what it is made of, what it looks like — and none of them knows
 * anything about the screen around it: every one takes the game, or the list it
 * draws, and nothing else.
 */

export { DetailsTab } from './DetailsTab'
export { FilesTab } from './FilesTab'
export { SavesTab, DELETE_SCOPES, deleteScopesOf } from './SavesTab'
export { ScreenshotsTab } from './ScreenshotsTab'
