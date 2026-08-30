# Where these icons came from

The thirteen console icons in this folder are RomM's own, fetched from a RomM
5.1.0 instance on 2026-08-30 from

    /assets/platforms/systematic/<platform>.svg

They are copied in because the demo has no server to fetch artwork from, and
without them every platform fell back to RomMix's short-code badge — which is
not what the application shows anyone. Nothing here is part of the application:
the AppImage does not carry them, and they are served only beside the demo page.

## What is known about their terms, and what is not

RomM is licensed **AGPL-3.0**.

Its own attribution file,
[`frontend/assets/platforms/ATTRIBUTIONS`](https://github.com/rommapp/romm/blob/master/frontend/assets/platforms/ATTRIBUTIONS),
credits the Libretro/RetroArch project under **CC BY 4.0** — but it lists only
the `.ico` files in the folder above, and **none of the `systematic/` SVGs
copied here**. There is no other attribution, credits or notice file in that
repository, and the SVGs themselves carry no author or licence metadata.

So the terms covering this particular set are not stated upstream and have not
been established here. That is worth resolving before any release that leans on
them — by asking upstream, or by removing them and letting the demo fall back to
the badge.

## The files

`atari2600` · `atari7800` · `c64` · `dos` · `gamegear` · `gb` · `gba` · `gbc` ·
`genesis` · `nes` · `scummvm` · `sms` · `snes`
