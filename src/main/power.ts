import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PowerAction } from '@shared/types'
import { binaryPath } from './host.ts'
import { t } from './i18n.ts'
import { log } from './log.ts'

/**
 * Putting the machine to sleep, restarting it, turning it off.
 *
 * RomMix is often the whole session: started by gamescope on a machine with no
 * desktop behind it, driven from a sofa by somebody holding a pad and nothing
 * else. Quitting there leaves a black screen and a console nobody is sitting in
 * front of, and the only way on is the power button on the case — which is the
 * one way of turning a computer off that risks whatever was still being
 * written.
 *
 * `systemctl`, because logind is what actually performs all three on a desktop
 * Linux, and asking it through the command is asking the same thing every
 * desktop's own menu asks. It is also the permission model: polkit lets the
 * user of the active local session do this and refuses everybody else, so a
 * RomMix on a shared machine or over SSH is told no by the system rather than
 * by a rule RomMix invented.
 *
 * Where there is no `systemctl` — a distribution without systemd, a container
 * — RomMix offers nothing rather than a button that cannot work. See
 * `powerActions`.
 */

const execFileAsync = promisify(execFile)

/** What each action is called when asking logind for it. */
const VERBS: Record<PowerAction, string> = {
  suspend: 'suspend',
  reboot: 'reboot',
  poweroff: 'poweroff'
}

/**
 * The actions this machine can be asked for, which is all of them or none.
 *
 * One probe rather than three: the three verbs come from the same binary and
 * the same service, and polkit's answer to each is not knowable without asking
 * — which for `poweroff` means finding out by turning the machine off.
 */
export async function powerActions(): Promise<PowerAction[]> {
  const systemctl = await binaryPath(['systemctl'])
  if (!systemctl) {
    log.debug('power', 'no systemctl, so nothing is offered')
    return []
  }
  return Object.keys(VERBS) as PowerAction[]
}

/**
 * Ask logind for one of them.
 *
 * Returns as soon as the request is accepted, which is well before the machine
 * acts on it: a suspend is a few hundred milliseconds of disks being flushed,
 * and a poweroff ends this process on its own. Nothing here waits for that, and
 * nothing closes RomMix first — a session that comes back from sleep comes back
 * to the library it left.
 *
 * A refusal is the case worth being loud about: polkit answers "Interactive
 * authentication required" to a user who is not on the active local session,
 * which is a sentence that explains itself once it is on screen and is
 * invisible if it is only in the log.
 */
export async function power(action: PowerAction): Promise<void> {
  log.info('power', 'asking logind', { action })
  try {
    await execFileAsync('systemctl', [VERBS[action]], { timeout: 10000 })
  } catch (cause) {
    const reason = ((cause as { stderr?: string }).stderr || (cause as Error).message).trim()
    log.warn('power', 'refused', { action, reason })
    throw new Error(t('error.power', { reason }), { cause })
  }
}
