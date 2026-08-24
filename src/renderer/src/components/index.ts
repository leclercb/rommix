/**
 * The shared presentational pieces of the 10-foot UI, as one import.
 *
 * Screens import from here rather than from the files below, so what a screen
 * is built from stays one list — and so a component that moves between those
 * files does not touch every screen that draws it.
 */

export { ArtBackdrop, CoverArt, Logo, PlatformBadge, PlatformIcon, SystemIcon } from './art'
export {
  Choice,
  FocusButton,
  RomStorageChoice,
  SegmentedControl,
  Tabs,
  TextField,
  Toggle,
  UI_SCALES,
  uiScaleChoice,
  type UiScaleChoice
} from './controls'
export { formatBytes, formatDate, formatDateTime } from './format'
export { GameCard, GameRow, tileFromInstalled, tileFromRom, type GameTile } from './games'
export { Hints, Overlay, QuitOverlay, Spinner } from './overlay'
export { QrCode, ScanToOpen } from './qr'
