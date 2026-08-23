// Release configuration, driven by `npm run release`.
//
// A release names its version in three places — package.json, CHANGELOG.md and
// the tag — and .github/workflows/release.yml refuses a tag whose
// three disagree. release-it writes the first and the third; the after:bump hook
// writes the second. Pushing the tag is what makes CI build the AppImage and
// publish the release, so nothing here creates one.
export default {
  hooks: {
    // The tag is public the moment it is pushed, and a red release build is not
    // something a fix can take back. CI runs these too; this is just the cheaper
    // place to find out.
    'before:init': ['npm run format:check', 'npm run lint', 'npm run typecheck', 'npm test'],

    // Runs after package.json is bumped and before the release commit, so the
    // changelog entry lands in that same commit.
    'after:bump': 'node scripts/changelog-release.mjs ${version} ${latestTag}'
  },

  git: {
    requireBranch: 'main',
    commitMessage: 'Release ${version}',
    tagName: 'v${version}',
    tagAnnotation: 'RomMix ${version}'
  },

  // RomMix ships as an AppImage, not as a package on the registry.
  npm: {
    publish: false
  },

  // The release is created by the workflow the tag triggers, which is the only
  // thing that has the AppImage to attach to it.
  github: {
    release: false
  }
}
