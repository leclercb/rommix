import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eden } from './eden/index.ts'
import { retroarch } from './retroarch/index.ts'
import { retrodeck } from './retrodeck/index.ts'
import type { BiosContext, EmulatorDescriptor } from './types.ts'
import type { SaveEnvironment } from './savepaths.ts'

/**
 * BIOS placement, against a described machine rather than a real one.
 *
 * The manifest fragments below are copied verbatim out of a RetroDECK 0.9
 * install — `files/retrodeck/components/<component>/component_manifest.json` —
 * because the whole point of reading them is that RomMix agrees with RetroDECK
 * by construction. A test written against a tidied-up shape would agree with
 * nothing.
 */

const INSTALL = '/var/lib/flatpak/app/net.retrodeck.retrodeck/x86_64/stable/active'
const BIOS = '/home/deck/retrodeck/bios'

function manifest(component: string): string {
  return `${INSTALL}/files/retrodeck/components/${component}/component_manifest.json`
}

/** The two shapes that matter: the list nested under `cores`, and `paths`. */
const RETROARCH_MANIFEST = JSON.stringify({
  retroarch: {
    name: 'RetroArch',
    cores: {
      bios: [
        {
          filename: 'scph5501.bin',
          md5: '490f666e1afb15b7362b406ed1cea246',
          system: 'psx',
          description: 'PlayStation BIOS - SCPH-5501  - USA',
          required: 'At least one BIOS file required'
        },
        {
          filename: 'dc_boot.bin',
          md5: 'e10c53c2f8b90bab96ead2d368858623',
          system: 'dreamcast',
          description: 'Dreamcast BIOS',
          paths: '$bios_path/dc',
          required: 'Required'
        },
        {
          filename: 'neogeo.zip',
          system: ['neogeo', 'fbneo', 'arcade'],
          description: 'Neo Geo BIOS',
          required: 'Required',
          paths: ['$roms_path/neogeo', '$roms_path/fbneo', '$roms_path/arcade', '$bios_path']
        }
      ]
    }
  }
})

/** PCSX2 keeps its list under `preset_actions`, and names no paths at all. */
const PCSX2_MANIFEST = JSON.stringify({
  pcsx2: {
    name: 'PCSX2',
    preset_actions: {
      bios: [
        {
          filename: 'SCPH30004R.bin',
          md5: '9cc0b1f1e1a5c66c9f0a6c0e8e8b8f0a',
          system: 'ps2',
          description: 'PS2 BIOS - Europe'
        }
      ]
    }
  }
})

function machine(files: Record<string, string>): SaveEnvironment {
  return {
    exists: (path) => path in files,
    dirs: () => [],
    files: () => [],
    text: (path) => files[path] ?? null,
    head: () => null,
    newest: () => 0
  }
}

function context(options: {
  system: string
  fileName: string
  env?: SaveEnvironment
  installDir?: string | null
  bios?: string | null
}): BiosContext {
  return {
    system: options.system,
    fileName: options.fileName,
    paths: {
      home: '/home/deck/retrodeck',
      roms: '/home/deck/retrodeck/roms',
      saves: '/home/deck/retrodeck/saves',
      states: '/home/deck/retrodeck/states',
      bios: options.bios === undefined ? BIOS : options.bios
    },
    configDir: '/home/deck/.var/app/net.retrodeck.retrodeck/config',
    dataDir: '/home/deck/.var/app/net.retrodeck.retrodeck/data',
    installDir: options.installDir === undefined ? INSTALL : options.installDir,
    home: '/home/deck',
    env: options.env ?? machine({})
  }
}

/** What the main process does with a descriptor that declines to answer. */
function place(descriptor: EmulatorDescriptor, ctx: BiosContext): string | null {
  return descriptor.bios ? descriptor.bios(ctx) : ctx.paths.bios
}

const retroDeck = machine({
  [manifest('retroarch')]: RETROARCH_MANIFEST,
  [manifest('pcsx2')]: PCSX2_MANIFEST
})

test('a file RetroDECK names no folder for goes to the root of bios', () => {
  const dir = place(retrodeck, context({ system: 'psx', fileName: 'scph5501.bin', env: retroDeck }))
  assert.equal(dir, BIOS)
})

test('Dreamcast firmware goes to the subfolder the manifest names', () => {
  const dir = place(
    retrodeck,
    context({ system: 'dreamcast', fileName: 'dc_boot.bin', env: retroDeck })
  )
  assert.equal(dir, `${BIOS}/dc`)
})

test('the filename is matched case-insensitively, as uploads are', () => {
  const dir = place(
    retrodeck,
    context({ system: 'dreamcast', fileName: 'DC_BOOT.BIN', env: retroDeck })
  )
  assert.equal(dir, `${BIOS}/dc`)
})

test('an entry claimed by another system does not place this one', () => {
  // The same name under a system the entry does not list falls through to the
  // default rather than borrowing the other system's folder.
  const dir = place(retrodeck, context({ system: 'psx', fileName: 'dc_boot.bin', env: retroDeck }))
  assert.equal(dir, BIOS)
})

test('a file wanted in several places is put in the BIOS folder, not a ROM folder', () => {
  const dir = place(
    retrodeck,
    context({ system: 'neogeo', fileName: 'neogeo.zip', env: retroDeck })
  )
  assert.equal(dir, BIOS)
})

test('a system RetroDECK runs with a standalone reads that component manifest', () => {
  // PS2 is PCSX2 rather than a core, and its manifest names no paths — so the
  // answer is the root, reached through a different file than RetroArch's.
  const dir = place(
    retrodeck,
    context({ system: 'ps2', fileName: 'SCPH30004R.bin', env: retroDeck })
  )
  assert.equal(dir, BIOS)
})

test('an unreadable manifest falls back to the BIOS folder rather than nowhere', () => {
  const dir = place(
    retrodeck,
    context({ system: 'dreamcast', fileName: 'dc_boot.bin', env: machine({}) })
  )
  assert.equal(dir, BIOS)
})

test('a RetroDECK that flatpak did not report a location for still places files', () => {
  const dir = place(
    retrodeck,
    context({ system: 'dreamcast', fileName: 'dc_boot.bin', env: retroDeck, installDir: null })
  )
  assert.equal(dir, BIOS)
})

test('an emulator with nothing to say puts everything in its BIOS folder', () => {
  assert.equal(retroarch.bios, undefined)
  const dir = place(retroarch, context({ system: 'dreamcast', fileName: 'dc_boot.bin' }))
  assert.equal(dir, BIOS)
})

test('Eden takes keys and refuses firmware', () => {
  const keys = place(eden, context({ system: 'switch', fileName: 'prod.keys', bios: '/keys' }))
  assert.equal(keys, '/keys')

  const firmware = place(eden, context({ system: 'switch', fileName: 'Firmware 18.1.0.zip' }))
  assert.equal(firmware, null, 'firmware is staged for Eden to register itself')
})
