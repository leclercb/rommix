/**
 * What each system needs before its games will start.
 *
 * The authority on which BIOS files exist is the RomM server: they are
 * uploaded there per platform and RomMix downloads them into whichever
 * emulator runs that platform. This table is the other half of the question —
 * *which* files a system needs — so the BIOS screen can say "PlayStation is
 * missing scph5501.bin" rather than only being able to list what happens to
 * have been uploaded.
 *
 * It is deliberately a short, curated list of the systems whose BIOS
 * requirements are both well known and satisfiable by copying a file. Where a
 * system needs more than that — a console dump, keys, firmware installed by the
 * emulator itself — `setupNote` says so, because telling someone a file is
 * missing when no file could ever be placed is worse than saying nothing.
 *
 * Keyed by ES-DE system name, like everything else RomMix keys by platform.
 *
 * The prose is held as catalogue keys rather than as sentences: this table is
 * data the main process reads, and it is the main process that knows which
 * language to answer in. `BiosManager` resolves them on the way out.
 */

import type { MessageKey } from '@shared/i18n'

export interface BiosFile {
  /** Exact filename the emulator looks for, matched case-insensitively. */
  name: string
  /** What it is, and which region it covers where that matters. */
  note: MessageKey
  /**
   * False for a file that only some games or some cores need. An optional file
   * that is missing is reported as a hint rather than as a problem.
   */
  required: boolean
}

export interface BiosRequirement {
  files: readonly BiosFile[]
  /**
   * How this system's BIOS works, where the files above are not the whole
   * story: a console dump, keys, firmware only the emulator can register.
   *
   * Shown on the BIOS screen once translated. Its presence also means the system's state
   * cannot be judged from `files` alone — a platform with every listed file in
   * place may still be unset up — which is why a row carrying one reports
   * "Unknown" rather than "Ready".
   */
  setupNote?: MessageKey
}

export const BIOS_REQUIREMENTS: Readonly<Record<string, BiosRequirement>> = {
  psx: {
    files: [
      { name: 'scph5500.bin', note: 'bios.note.scph5500', required: false },
      { name: 'scph5501.bin', note: 'bios.note.scph5501', required: true },
      { name: 'scph5502.bin', note: 'bios.note.scph5502', required: false }
    ]
  },
  ps2: {
    files: [],
    setupNote: 'bios.setup.ps2'
  },
  ps3: { files: [], setupNote: 'bios.setup.ps3' },
  psvita: { files: [], setupNote: 'bios.setup.psvita' },
  saturn: {
    files: [
      { name: 'sega_101.bin', note: 'bios.note.sega101', required: false },
      { name: 'mpr-17933.bin', note: 'bios.note.mpr17933', required: true }
    ]
  },
  segacd: {
    files: [
      { name: 'bios_CD_U.bin', note: 'bios.note.segaCdU', required: true },
      { name: 'bios_CD_E.bin', note: 'bios.note.segaCdE', required: false },
      { name: 'bios_CD_J.bin', note: 'bios.note.segaCdJ', required: false }
    ]
  },
  dreamcast: {
    files: [
      { name: 'dc_boot.bin', note: 'bios.note.dcBoot', required: true },
      { name: 'dc_flash.bin', note: 'bios.note.dcFlash', required: true }
    ]
  },
  pcenginecd: {
    files: [{ name: 'syscard3.pce', note: 'bios.note.syscard3', required: true }]
  },
  neogeo: {
    files: [{ name: 'neogeo.zip', note: 'bios.note.neogeo', required: true }]
  },
  neogeocd: {
    files: [{ name: 'neocd_z.rom', note: 'bios.note.neocd', required: true }]
  },
  fds: {
    files: [{ name: 'disksys.rom', note: 'bios.note.disksys', required: true }]
  },
  gba: {
    files: [{ name: 'gba_bios.bin', note: 'bios.note.gbaBios', required: false }]
  },
  nds: {
    files: [
      { name: 'bios7.bin', note: 'bios.note.ndsBios7', required: true },
      { name: 'bios9.bin', note: 'bios.note.ndsBios9', required: true },
      { name: 'firmware.bin', note: 'bios.note.ndsFirmware', required: true }
    ]
  },
  n3ds: {
    files: [],
    setupNote: 'bios.setup.n3ds'
  },
  switch: {
    /**
     * The keys are named here even though the Switch also carries a note,
     * because they are the half of its setup that behaves like every other
     * BIOS: two files, known names, which RomMix can both check for and copy
     * into place.
     * Listing them turns "it needs a dump from a console" into something the
     * screens can be specific about — and lets a game's page say outright that
     * nothing will start, rather than leaving the user to discover it.
     *
     * The firmware is the part that stays unnameable, which is what the note
     * goes on describing.
     */
    files: [
      {
        name: 'prod.keys',
        note: 'bios.note.prodKeys',
        required: true
      },
      {
        name: 'title.keys',
        note: 'bios.note.titleKeys',
        required: true
      }
    ],
    setupNote: 'bios.setup.switch'
  },
  wiiu: { files: [], setupNote: 'bios.setup.wiiu' },
  '3do': {
    files: [{ name: 'panafz10.bin', note: 'bios.note.panafz10', required: true }]
  },
  atarilynx: {
    files: [{ name: 'lynxboot.img', note: 'bios.note.lynxboot', required: true }]
  },
  atari5200: {
    files: [{ name: '5200.rom', note: 'bios.note.atari5200', required: true }]
  },
  atari7800: {
    files: [{ name: '7800 BIOS (U).rom', note: 'bios.note.atari7800', required: false }]
  },
  colecovision: {
    files: [{ name: 'colecovision.rom', note: 'bios.note.colecovision', required: true }]
  },
  pcfx: {
    files: [{ name: 'pcfx.rom', note: 'bios.note.pcfx', required: true }]
  },
  x68000: {
    files: [
      { name: 'iplrom.dat', note: 'bios.note.x68000Ipl', required: true },
      { name: 'cgrom.dat', note: 'bios.note.x68000Cgrom', required: true }
    ]
  },
  amiga: {
    files: [
      { name: 'kick34005.A500.rom', note: 'bios.note.kickstart13', required: true },
      { name: 'kick40068.A1200.rom', note: 'bios.note.kickstart31A1200', required: false }
    ]
  },
  amigacd32: {
    files: [{ name: 'kick40060.CD32.rom', note: 'bios.note.kickstart31Cd32', required: true }]
  }
}

/** What this system needs, or null when RomMix has nothing recorded for it. */
export function biosFor(system: string): BiosRequirement | null {
  return BIOS_REQUIREMENTS[system] ?? null
}
