/**
 * The shared presentational pieces of the 10-foot UI, as one import.
 *
 * Screens import from here rather than from the files below, so what a screen
 * is built from stays one list — and so a component that moves between those
 * files does not touch every screen that draws it.
 */

export {
  ArtBackdrop,
  CoverArt,
  CoverMosaic,
  Flag,
  Logo,
  PlatformBadge,
  PlatformIcon,
  SystemIcon
} from './art'
export {
  Choice,
  FocusButton,
  RomStorageChoice,
  SegmentedControl,
  Tabs,
  TextField,
  Toggle,
  uiScaleChoice,
  uiScaleOptions,
  type SegmentedOptions,
  type UiScaleChoice
} from './controls'
export { DownloadBadge, DownloadBar, ProgressBar } from './downloads'
export { GameCard, GameRow, tileFromInstalled, tileFromRom, type GameTile } from './games'
export { Hints, Overlay, PageTitle, QuitOverlay, Spinner } from './overlay'
export { QrCode, ScanToOpen } from './qr'
export { Filled } from './text'
