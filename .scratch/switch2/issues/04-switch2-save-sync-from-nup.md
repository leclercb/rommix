# 04: Switch 2 save sync from the `.nup` title id

**What to build:** Saves of a Switch 2 game sync both ways under Eglantine. RomMix reads the title id from the `.nup` itself, choosing it exactly as Eglantine does, so it names the same save folder Eglantine writes:

- superblock: magic `NUP\x01` at 0x00, `toc_offset` (u64 LE) at 0x08, which must be at least 0x80; TOC magic `TOC\x01` at `toc_offset`; all integers little-endian;
- package records: `package_count` records of 0x40 bytes from `toc_offset + 0x30`; each has `title_id` (u64 LE) at +0x00, `exefs_dir` (u32, `0xFFFFFFFF` = none) at +0x0C, `version` (u32) at +0x14, `kind` (u8: 0 base, 1 update, 2 DLC) at +0x18;
- choice: the first base with an ExeFS, otherwise the highest-version update with an ExeFS;
- its `title_id` is used **as is** — no masking of the last digits, since Eglantine applies none — and must be non-zero and carry the `switch2` prefix `04`.

Anything that does not fit yields no title id and the existing "no title id" outcome: nothing is synced rather than something wrong. The TOC hash is not checked (no crypto in the config layer); matching Eglantine's rule and the prefix are the guard. Layout source: Eglantine `nx2` branch, `nup_container.{h,cpp}`, `loader/nup.cpp`.

**Blocked by:** 01, 03

**Status:** ready-for-agent

- [x] Tests on `.nup` files built in the test: base only; base + updates (base wins); standalone update (highest version wins); bad magic; TOC offset below 0x80; zero id; an `01…` id refused
- [x] Reading stays within a small bounded slice of the file
- [x] A Switch 2 game's save folder resolves under Eglantine's `nand/user/save/<space>/<profile>/<title id>`
- [x] `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` pass
