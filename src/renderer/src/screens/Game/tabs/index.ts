/**
 * The tabs of a game's page, as one import.
 *
 * Each answers a different question about the same game — what it is, what it
 * has saved, what it is made of, what it looks like, which dump of it this is —
 * and none of them knows anything about the screen around it: every one takes
 * the game, or the list it draws, and nothing else.
 *
 * Four are always there. Versions, Manual and Achievements are the exceptions,
 * drawn only for a game the server holds more than one file of, one it has a
 * manual for, and one RetroAchievements covers, because a tab that is empty for
 * most of a library reads as something missing rather than as something absent.
 */

export { AchievementsTab } from './AchievementsTab'
export { DetailsTab } from './DetailsTab'
export { FilesTab } from './FilesTab'
export { ManualTab } from './ManualTab'
export { SavesTab, deleteScopeLabel, deleteScopesOf } from './SavesTab'
export { ScreenshotsTab } from './ScreenshotsTab'
export { VersionsTab } from './VersionsTab'
