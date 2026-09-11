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
    // because it is the last one where the answer can still change anything.
    // Nothing has to be arranged for the window it needs — see
    // scripts/test-app.sh, which is why a release can be cut from a machine with
    // no screen.
    'before:init': [
      'npm run format:check',
      'npm run lint',
      'npm run typecheck',
      'npm test',
      'npm run test:app',
      // The one thing none of the above runs. `test:app` drives `out/` with a
      // bare `electron .`, so `electron-builder.yml` and
      // `scripts/after-pack.mjs` were unexercised until the tag was already
      // public — and a failure that only happens at pack time then turned both
      // release legs red, leaving a pushed tag with no release behind it to be
      // deleted by hand. `pack:dir` is the cheap variant and still runs
      // `after-pack.mjs`.
      'npm run pack:dir'
    ],

    // Runs after package.json is bumped and before the release commit, so what
    // these write lands in that same commit.
    //
    // The pictures are here rather than above for the same reason the changelog
    // is: they are files, and `before:init` runs ahead of the check that the
    // working directory is clean — writing them there would fail the release
    // that asked for them. Taken every time rather than when somebody
    // remembers, because the landing page is built from them and a release is
    // the moment they are meant to show what is being shipped. Nothing has to
    // be arranged for the screen they need — see scripts/headless.sh, which is
    // why this can be run from a machine that has none.
    'after:bump': [
      'node scripts/changelog-release.mjs ${version} ${latestTag}',
      'npm run screenshots'
    ]
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
