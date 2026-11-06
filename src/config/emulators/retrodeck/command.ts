import { chosenCommandLabel, systemBlock } from './saves.ts'
import type { ComponentContext } from './saves.ts'

/** The ES-DE placeholder for the shell a shortcut command hands the ROM to. */
const SHELL = '%EMULATOR_OS-SHELL%'

/**
 * Files a shell command can run: the shortcuts those commands exist for.
 * RetroDECK opens a `.desktop` itself before choosing a command at all.
 */
const SHORTCUT = /\.(desktop|sh)$/i

/**
 * The ES-DE command to hand RetroDECK with `-e`, or null to let it choose.
 *
 * With no choice recorded in ES-DE, RetroDECK runs the first command listed for
 * the system, and for PS3 and PS4 that one only runs shortcuts: it passes the
 * ROM to `/bin/sh`. ES-DE never sends it anything else, because its own
 * frontend lists those systems' games as shortcuts. A disc image sent there
 * fails with "cannot execute binary file" before the emulator starts.
 *
 * So where the default is a shell command and the ROM is not a shortcut, this
 * takes the first command of the same system that runs the ROM directly — one
 * that names `%ROM%` and needs no `%INJECT%` file RomMix never writes. A choice
 * the user made in ES-DE is never overridden: that is what RetroDECK is
 * launched by system to honour.
 */
export function retroDeckCommand(ctx: ComponentContext): string | null {
  if (!ctx.installDir || !ctx.romPath || SHORTCUT.test(ctx.romPath)) return null
  if (chosenCommandLabel(ctx)) return null

  const block = systemBlock(ctx.env, ctx.installDir, ctx.system)
  if (!block) return null

  // A commented-out command is not one RetroDECK can pick.
  const commands = [
    ...block.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<command[^>]*>([\s\S]*?)<\/command>/g)
  ].map(([, command]) => command.trim())
  if (!commands[0]?.includes(SHELL)) return null

  return (
    commands.find(
      (command) =>
        !command.includes(SHELL) && command.includes('%ROM%') && !command.includes('%INJECT%')
    ) ?? null
  )
}
