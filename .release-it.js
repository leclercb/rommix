// Release configuration, driven by `npm run release`.
//
// A release names its version in three places — package.json, the metainfo
// changelog and the tag — and .github/workflows/flatpak.yml refuses a tag whose
// three disagree. release-it writes the first and the third; the after:bump hook
// writes the second. Pushing the tag is what makes CI build the flatpak and
// publish the release, so nothing here creates one.
export default {
  hooks: {
    // The tag is public the moment it is pushed, and a red release build is not
    // something a fix can take back. CI runs these too; this is just the cheaper
    // place to find out.
    'before:init': ['npm run format:check', 'npm run typecheck', 'npm test'],

    // Runs after package.json is bumped and before the release commit, so the
    // metainfo entry lands in that same commit.
    'after:bump': 'node scripts/metainfo-release.mjs ${version} ${latestTag}'
  },

  git: {
    requireBranch: 'main',
    commitMessage: 'Release ${version}',
    tagName: 'v${version}',
    tagAnnotation: 'RomMix ${version}'
  },

  // RomMix is a flatpak, not a package on the registry.
  npm: {
    publish: false
  },

  // The release is created by the workflow the tag triggers, which is the only
  // thing that has the flatpak bundle to attach to it.
  github: {
    release: false
  }
}
