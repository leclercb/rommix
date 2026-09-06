/**
 * Putting packaging/rommix-launch.sh in front of the Electron binary.
 *
 * electron-builder renames the Electron binary to `linux.executableName`, and
 * the AppImage's generated AppRun execs whatever has that name. There is no
 * option for a switch on that command line — `linux.executableArgs` writes the
 * .desktop Exec and nothing else — and the one switch RomMix needs there,
 * `--ozone-platform`, is read before any of the application runs. So the name
 * AppRun execs is made a shell script, and the binary is moved a step aside for
 * it to exec in turn. See packaging/rommix-launch.sh for what it decides.
 *
 * This runs for `--linux dir` as well as for the AppImage, which is what makes
 * `npm run pack:dir` start the same way a release does.
 */
import { chmod, copyFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

/** `linux.executableName` in electron-builder.yml, which AppRun execs. */
const EXECUTABLE = 'rommix'

/** Where the Electron binary goes, named in packaging/rommix-launch.sh. */
const BINARY = 'rommix.bin'

const LAUNCHER = join(import.meta.dirname, '..', 'packaging', 'rommix-launch.sh')

export default async function afterPack({ appOutDir, electronPlatformName }) {
  // RomMix ships for Linux only, but the hook is asked about the platform
  // rather than assuming it: renaming a binary that is not the one described
  // above is how a packaging change becomes a build that produces nothing
  // runnable.
  if (electronPlatformName !== 'linux') return

  const launcher = join(appOutDir, EXECUTABLE)
  const binary = join(appOutDir, BINARY)

  // Unconditional, because electron-builder has already put a freshly unpacked
  // Electron at this name — `beforeCopyExtraFiles` renames it there — whether
  // or not the output directory was cleared first. Skipping the rename when a
  // `rommix.bin` from an earlier pack is lying about would copy the script over
  // that new binary and ship the old one beside it.
  await rename(launcher, binary)

  await copyFile(LAUNCHER, launcher)
  // Copied rather than moved, so this is the mode of the file in the image
  // rather than whatever the checkout happens to carry.
  await chmod(launcher, 0o755)
}
