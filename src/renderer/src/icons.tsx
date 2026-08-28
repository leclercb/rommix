import type { JSX } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Ban,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  Clock,
  Coffee,
  EyeOff,
  ChevronRight,
  CircleAlert,
  CircleUser,
  Disc3,
  Download,
  Eraser,
  File,
  Flag,
  FolderOpen,
  FolderTree,
  Gamepad2,
  Globe,
  HardDrive,
  Heart,
  House,
  Joystick,
  Languages,
  Layers,
  ClipboardList,
  BookMarked,
  Plus,
  LayoutGrid,
  Library,
  ListOrdered,
  LogOut,
  Maximize,
  Package,
  Pause,
  Play,
  Plug,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Settings,
  Sparkles,
  Star,
  Tag,
  Tags,
  Trash2,
  Upload,
  Users
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
  // Not `refresh`, which is "look again": this one closes RomMix and opens it.
  restart: RotateCcw,
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
  hide: EyeOff,
  /** Where a program came from: the package or image it was installed as. */
  package: Package,
  /** A project's own page on the web. */
  homepage: Globe,
  roms: Disc3,
  saves: Save,
  /** A game the user has marked. Filled in by CSS when it is one. */
  favourite: Heart,
  /** One file, on the server or on disk. */
  file: File,
  /** How much room something takes. */
  size: HardDrive,
  company: Building2,
  /** The series a game belongs to. */
  franchise: Library,
  players: Users,
  /** How a game can be played: alone, together, split screen. */
  modes: Joystick,
  rating: Star,
  region: Flag,
  languages: Languages,
  /** Which dump of the game this is. */
  revision: Tag,
  tags: Tags,
  /** A moment in time: when something was last done. */
  time: Clock,
  /** The per-system folder a download lands in, as opposed to its full path. */
  systemFolder: FolderTree,
  /** Who is signed in. */
  user: CircleUser,
  /** The RomM instance this library comes from. */
  server: Server,
  /** Supporting the project. */
  coffee: Coffee,
  /** A step of a several-page flow. */
  previous: ChevronLeft,
  add: Plus,
  collection: BookMarked,
  note: ClipboardList,
  next: ChevronRight,
  /** Stopping a transfer without giving it up. */
  pause: Pause
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
