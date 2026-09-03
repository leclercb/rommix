// Release configuration, driven by `npm run release`.
//
// A release names its version in three places — package.json, CHANGELOG.md and
// the tag — and .github/workflows/release.yml refuses a tag whose
// three disagree. release-it writes the first and the third; the after:bump hook
// writes the second. Pushing the tag is what makes CI build the AppImage and
// publish the release, so nothing here creates one.
//
// `npm run release:rc` is the same run with a suffixed version — `0.9.0-rc.0`,
// and again for `rc.1`. Nothing here treats it differently; the suffix is what
// does. The workflow reads it and publishes the release as a pre-release, GitHub
// then keeps it out of the release it calls latest, and that is what the updater
// asks for unless somebody has turned release candidates on — see
// `Settings.updatePrereleases`.
export default {
  hooks: {
    // The tag is public the moment it is pushed, and a red release build is not
    // something a fix can take back. CI runs these too; this is just the cheaper
    // place to find out.
    //
    // `test:app` last, and here rather than in the pre-commit hook: it builds,
    // drives a real window and takes about half a minute, which is a hook people
    // pass `--no-verify` to. A release is the one moment that is worth paying,
    // because it is the last one where the answer can still change anything. It
    // needs a display — on a headless machine, run the release from under
    // `xvfb-run`, the same as the workflow does.
    'before:init': [
      'npm run format:check',
      'npm run lint',
      'npm run typecheck',
      'npm test',
      'npm run test:app'
    ],

    // Runs after package.json is bumped and before the release commit, so the
    // changelog entry lands in that same commit.
    'after:bump': 'node scripts/changelog-release.mjs ${version} ${latestTag}'
  },

  git: {
    requireBranch: 'main',
    // `chore` because a release changes no behaviour: it bumps a number, writes
    // the changelog section and tags. Anything filtering the log by type wants
    // it out of the way, which is the same reason it is not `feat` or `fix`.
    commitMessage: 'chore(release): ${version}',
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
