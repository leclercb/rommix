import type { JSX } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Ban,
  Check,
  ChevronDown,
  EyeOff,
  ChevronRight,
  CircleAlert,
  Download,
  Eraser,
  FolderOpen,
  Gamepad2,
  HardDrive,
  House,
  Layers,
  LayoutGrid,
  ListOrdered,
  LogOut,
  Maximize,
  Play,
  Plug,
  Power,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload
} from 'lucide-react'

/**
 * The icon vocabulary, named by what it means rather than what it draws.
 *
 * One place, so the same action wears the same mark everywhere: Play is the
 * same glyph on the game page and in the rail, and a screen that wants "the
 * uninstall icon" cannot pick a different one from the set by accident. It also
 * keeps the choice of icon library to a single import — swapping lucide for
 * something else is this file and nothing more.
 *
 * Lucide rather than Font Awesome: it ships as tree-shaken SVG components, so
 * only the marks actually used are bundled and nothing loads a font at runtime
 * — which matters for an app that must draw itself with no network, inside a
 * flatpak, on a television.
 */
export const ICONS = {
  play: Play,
  download: Download,
  cancel: Ban,
  pull: ArrowDown,
  push: Upload,
  uninstall: Trash2,
  delete: Trash2,
  back: ArrowLeft,
  refresh: RefreshCw,
  install: Download,
  sort: ListOrdered,
  group: Layers,
  expand: ChevronRight,
  collapse: ChevronDown,
  clear: Eraser,
  moveUp: ArrowUp,
  moveDown: ArrowDown,
  home: House,
  library: LayoutGrid,
  downloads: HardDrive,
  bios: Sparkles,
  settings: Settings,
  emulator: Gamepad2,
  folder: FolderOpen,
  search: Search,
  confirm: Check,
  warn: CircleAlert,
  disconnect: LogOut,
  more: ChevronDown,
  quit: Power,
  fullscreen: Maximize,
  connect: Plug,
  keep: Check,
  hide: EyeOff
} as const

export type IconName = keyof typeof ICONS

/**
 * An icon at button size.
 *
 * `aria-hidden` throughout: every icon in RomMix sits beside a word that says
 * the same thing, so a screen reader announcing both would only stutter.
 */
export function Icon({ name, size = 18 }: { name: IconName; size?: number }): JSX.Element {
  const Glyph = ICONS[name]
  return <Glyph size={size} strokeWidth={2} aria-hidden focusable="false" />
}
