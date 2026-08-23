# Security

## Reporting a vulnerability

Please report privately rather than in a public issue, through GitHub's
[private vulnerability reporting](https://github.com/leclercb/rommix/security/advisories/new)
on this repository.

RomMix is one person's side project, so please do not expect a same-day reply.
I will acknowledge a report when I see it and tell you what I intend to do about
it. If a fix is warranted it goes out as an ordinary release with the advisory
published alongside it.

## What RomMix touches

Worth knowing before deciding whether something is a security issue here:

- **Your RomM credentials.** A JWT pair or a long-lived `rmm_…` client token,
  kept in `~/rommix/config/credentials.bin` and encrypted with the OS keyring
  through Electron's `safeStorage`. Where no keyring is reachable it falls back
  to plaintext in a file created mode `0600`, and says so in the log.
- **The log.** `~/rommix/logs/rommix.log` records every request and every launch.
  Credentials are redacted on the way in — by key, and by pattern for anything
  token-shaped — because the log is meant to be pasted into bug reports.
  `src/main/log.test.ts` is what holds that promise up. A credential surviving
  into the log is a vulnerability; please report it.
- **Programs it starts.** RomMix spawns emulators as ordinary child processes of
  itself, with your own user's access. It is not sandboxed, on purpose — see the
  note in `electron-builder.yml`.
- **Files it downloads.** ROMs, BIOS files and save data come from _your_ RomM
  server and nowhere else. Emulator builds come from Flathub or the project's
  own releases; libretro cores come from the libretro buildbot over HTTPS, which
  is forced even when RetroArch's own config names a plain-http mirror.

## What is not a vulnerability

- That RomMix runs unsandboxed and can start any program you point it at. That
  is the feature; the [README](README.md#from-steam) explains why a sandbox
  breaks the thing it exists to do.
- That a BIOS or ROM on your own RomM server is copied where you told RomMix to
  put it.
- Anything requiring an attacker who can already write to `~/rommix` or to your
  emulator's folders. At that point they are already you.
