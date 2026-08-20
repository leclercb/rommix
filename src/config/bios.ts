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
 */

export interface BiosFile {
  /** Exact filename the emulator looks for, matched case-insensitively. */
  name: string
  /** What it is, and which region it covers where that matters. */
  note: string
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
   * Shown as-is on the BIOS screen. Its presence also means the system's state
   * cannot be judged from `files` alone — a platform with every listed file in
   * place may still be unset up — which is why a row carrying one reports
   * "Unknown" rather than "Ready".
   */
  setupNote?: string
}

export const BIOS_REQUIREMENTS: Readonly<Record<string, BiosRequirement>> = {
  psx: {
    files: [
      { name: 'scph5500.bin', note: 'PlayStation BIOS — Japan', required: false },
      { name: 'scph5501.bin', note: 'PlayStation BIOS — North America', required: true },
      { name: 'scph5502.bin', note: 'PlayStation BIOS — Europe', required: false }
    ]
  },
  ps2: {
    files: [],
    setupNote:
      'PlayStation 2 needs a BIOS dumped from a real console. The filename varies by model, ' +
      'so anything uploaded to RomM for this platform is installed as-is.'
  },
  ps3: { files: [], setupNote: 'PlayStation 3 needs its firmware installed by RPCS3 itself.' },
  psvita: { files: [], setupNote: 'PlayStation Vita needs a firmware dump installed by Vita3K.' },
  saturn: {
    files: [
      { name: 'sega_101.bin', note: 'Saturn BIOS — Japan', required: false },
      { name: 'mpr-17933.bin', note: 'Saturn BIOS — North America and Europe', required: true }
    ]
  },
  segacd: {
    files: [
      { name: 'bios_CD_U.bin', note: 'Sega CD BIOS — North America', required: true },
      { name: 'bios_CD_E.bin', note: 'Mega-CD BIOS — Europe', required: false },
      { name: 'bios_CD_J.bin', note: 'Mega-CD BIOS — Japan', required: false }
    ]
  },
  dreamcast: {
    files: [
      { name: 'dc_boot.bin', note: 'Dreamcast boot ROM', required: true },
      { name: 'dc_flash.bin', note: 'Dreamcast flash, holds the clock and region', required: true }
    ]
  },
  pcenginecd: {
    files: [{ name: 'syscard3.pce', note: 'PC Engine CD System Card 3', required: true }]
  },
  neogeo: {
    files: [{ name: 'neogeo.zip', note: 'Neo Geo BIOS set', required: true }]
  },
  neogeocd: {
    files: [{ name: 'neocd_z.rom', note: 'Neo Geo CD BIOS — top-loading model', required: true }]
  },
  fds: {
    files: [{ name: 'disksys.rom', note: 'Famicom Disk System BIOS', required: true }]
  },
  gba: {
    files: [
      { name: 'gba_bios.bin', note: 'Game Boy Advance BIOS — improves accuracy', required: false }
    ]
  },
  nds: {
    files: [
      { name: 'bios7.bin', note: 'Nintendo DS ARM7 BIOS', required: true },
      { name: 'bios9.bin', note: 'Nintendo DS ARM9 BIOS', required: true },
      { name: 'firmware.bin', note: 'Nintendo DS firmware', required: true }
    ]
  },
  n3ds: {
    files: [],
    setupNote: 'The 3DS needs its shared fonts and AES keys dumped from a console.'
  },
  switch: {
    /**
     * The keys are named here even though the Switch also carries a note,
     * because
     * they are the half of its setup that behaves like every other BIOS: two
     * files, known names, which RomMix can both check for and copy into place.
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
        note: 'Console master keys — nothing decrypts without them',
        required: true
      },
      {
        name: 'title.keys',
        note: 'Per-title keys, for installed games, updates and DLC',
        required: true
      }
    ],
    setupNote: 'The Switch needs prod.keys and a firmware dump from a console.'
  },
  wiiu: { files: [], setupNote: 'Wii U needs keys and an OTP dump from a console.' },
  '3do': {
    files: [{ name: 'panafz10.bin', note: '3DO BIOS — Panasonic FZ-10', required: true }]
  },
  atarilynx: {
    files: [{ name: 'lynxboot.img', note: 'Atari Lynx boot ROM', required: true }]
  },
  atari5200: {
    files: [{ name: '5200.rom', note: 'Atari 5200 BIOS', required: true }]
  },
  atari7800: {
    files: [{ name: '7800 BIOS (U).rom', note: 'Atari 7800 BIOS — North America', required: false }]
  },
  colecovision: {
    files: [{ name: 'colecovision.rom', note: 'ColecoVision BIOS', required: true }]
  },
  pcfx: {
    files: [{ name: 'pcfx.rom', note: 'PC-FX BIOS', required: true }]
  },
  x68000: {
    files: [
      { name: 'iplrom.dat', note: 'X68000 IPL ROM', required: true },
      { name: 'cgrom.dat', note: 'X68000 character generator ROM', required: true }
    ]
  },
  amiga: {
    files: [
      { name: 'kick34005.A500.rom', note: 'Kickstart 1.3 — Amiga 500', required: true },
      { name: 'kick40068.A1200.rom', note: 'Kickstart 3.1 — Amiga 1200', required: false }
    ]
  },
  amigacd32: {
    files: [{ name: 'kick40060.CD32.rom', note: 'Kickstart 3.1 — CD32', required: true }]
  }
}

/** What this system needs, or null when RomMix has nothing recorded for it. */
export function biosFor(system: string): BiosRequirement | null {
  return BIOS_REQUIREMENTS[system] ?? null
}
