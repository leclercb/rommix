/**
 * Everything RomMix says, in English.
 *
 * The catalogue every other language is typed against: `Catalog` is `typeof en`
 * and `fr.ts`, `de.ts` and `es.ts` are declared as one, so a phrase added here
 * and forgotten there does not compile.
 *
 * Keys are grouped by where they are read rather than by what they say, because
 * that is how they are looked up — someone changing the Downloads screen wants
 * every string on it in one place, not the four verbs it happens to share with
 * the Game screen. A handful of genuinely shared words live under `action.` and
 * `value.` and are used everywhere.
 *
 * `{placeholders}` are substituted at call time. A key ending `_one` / `_other`
 * is a plural set: call sites pass the stem and a `count`, and
 * `Intl.PluralRules` picks the variant — which is why no code anywhere writes
 * `count === 1 ? … : …`.
 *
 * Everything RomMix says is here, including the phrases the emulator
 * descriptors own — those name a key and are resolved by `localize`, because a
 * descriptor is a pure function of an install with no language to hand. That
 * also means one entry serves every frontend that ships the same component.
 */

export const en = {
  // -- shared words ---------------------------------------------------------

  'action.back': 'Back',
  'action.cancel': 'Cancel',
  'action.close': 'Close',
  'action.keep': 'Keep it',
  'action.next': 'Next',
  'action.select': 'Select',
  'action.open': 'Open',
  'action.search': 'Search',
  'action.navigate': 'Navigate',
  'action.menu': 'Menu',
  'action.type': 'Type',
  'action.install': 'Install',
  'action.installAll': 'Install all',
  'action.reinstall': 'Reinstall',
  'action.uninstall': 'Uninstall',
  'action.download': 'Download',
  'action.tryAgain': 'Try again',
  'action.trying': 'Trying…',
  'action.checking': 'Checking…',
  'action.installing': 'Installing…',
  'action.starting': 'Starting…',
  'action.expand': 'Expand',
  'action.collapse': 'Collapse',
  'action.moveUp': 'Move up',
  'action.moveDown': 'Move down',
  'action.previousTab': 'Previous tab',
  'action.nextTab': 'Next tab',
  'action.rowActions': 'Row actions',
  'action.openInBrowser': 'Open in a browser',

  'value.on': 'On',
  'value.off': 'Off',
  'value.yes': 'yes',
  'value.no': 'no',
  'value.yesTitle': 'Yes',
  'value.noTitle': 'No',
  'value.auto': 'Auto',
  'value.none': 'None',
  'value.unknown': 'unknown',
  'value.never': 'never',
  'value.notConfigured': 'Not configured',

  /** Only the two keys whose names are words. Tab and Shift+Tab are neither. */
  'key.enter': 'Enter',
  'key.esc': 'Esc',

  // -- app shell ------------------------------------------------------------

  'nav.home': 'Home',
  'nav.library': 'Library',
  'nav.collections': 'Collections',
  'nav.downloads': 'Downloads',
  'nav.emulators': 'Emulators',
  'nav.bios': 'BIOS',
  'nav.settings': 'Settings',

  'app.notConnected': 'Not connected',
  'app.loading': 'Loading',
  'app.qrCode': 'QR code',
  'app.credit': 'Developed with {heart} by leclercb',
  'app.quitTitle': 'Quit RomMix?',
  'app.stay': 'Stay',
  'app.quit': 'Quit',
  'app.quitRomMix': 'Quit RomMix',
  'app.gettingReady': 'Getting ready',
  'app.gameRunning': 'Game running',
  'app.emulatorHasFocusAsk':
    'The emulator has focus. Quit it to come back — RomMix will ask what to send to RomM.',
  'app.emulatorHasFocusAuto':
    'The emulator has focus. Quit it to come back — saves sync to RomM automatically.',
  'app.emulatorRunning': '{name} is running',
  'app.emulatorOpened':
    '{name} has focus. Quit it to come back — nothing is being played, so there is nothing to ' +
    'sync.',
  'app.holdToClose': 'Hold {key} to close it from here.',
  'app.closeEmulator': 'Close the emulator',
  'app.notClosing': 'It has not closed. Forcing it loses anything it has not saved.',
  'app.holdToForce': 'Hold {key} again to force it.',
  'app.forceClose': 'Force it to close',
  'app.askingEmulatorToQuit': 'Asking the emulator to quit…',

  // -- notifications raised by the shell ------------------------------------

  'toast.updateAvailable': 'RomMix {version} is available',
  'toast.updateAvailableSettings': 'RomMix {version} is available — see Settings',
  'toast.updateReadyRestart': 'RomMix {version} is ready — restart to use it',
  'toast.updateReadyQuit': 'RomMix {version} is ready — quit and start it again',
  'toast.downloadComplete': 'Download complete',
  'toast.downloadCancelled': 'Download cancelled',
  'toast.adoptedOne': 'Already on disk — added to your library',
  'toast.adoptedMany_one': '{count} game was already on disk — added to your library',
  'toast.adoptedMany_other': '{count} games were already on disk — added to your library',

  // -- the published demo ---------------------------------------------------
  //
  // The browser build only. Nothing in the application has a visible tab.

  'demo.notAvailable': 'Not available in the web preview',
  'demo.noEmulator': 'There is no emulator in the web preview',
  'demo.noFirmware': 'No such firmware',
  'demo.nothingToReplace': 'This is the web preview, so there is nothing here to replace.',
  'demo.nothingChecked': 'This is the web preview: nothing was actually checked.',
  'demo.connectionClosed': 'The server closed the connection before the file was complete.',
  'demo.variantFaster': 'faster, less accurate',
  'demo.variantDefault': 'RomMix’s choice',
  'demo.title': 'RomMix — demo',
  'demo.description':
    'The RomMix interface, running against the homebrew library from RomM’s public demo. No ' +
    'server and no emulator are involved, and nothing is downloaded.',

  // -- first-run setup ------------------------------------------------------

  'setup.stepOf': 'Step {step} of {total}',
  'setup.scaleTitle': 'How big should RomMix be?',
  'setup.scaleSubtitle':
    'Auto follows the screen — twice the size on a 4K television. Pick a size you can read from ' +
    'wherever you sit; you can change it later in Settings.',
  'setup.scaleHint': 'The whole interface, not just the text.',
  'setup.storageTitle': 'Where should downloaded games go?',
  'setup.storageSubtitle':
    'This decides where every ROM lands, so it is far easier to answer now than once there are ' +
    'games on disk in the other place.',

  // -- settings rows shared with the wizard ---------------------------------

  'control.scale': 'Scale',
  'storage.label': 'Where downloaded games go',
  'storage.hintShared':
    'One folder for everything, which each emulator has to be pointed at once. Changing emulator ' +
    'moves nothing, and a game can be downloaded before anything that runs it is installed.',
  'storage.hintPerEmulator':
    "Each emulator's own ROM folder, so games show up in its list when you start it yourself. " +
    'Changing emulator for a platform means downloading its games again.',
  'storage.toEmulatorTitle': "Keep games in each emulator's folder?",
  'storage.toEmulatorBody':
    'Downloads will go to the ROM folder of whichever emulator runs their platform. That is what ' +
    'puts them in its own game list when you start it yourself, and it is what ties them to it:',
  'storage.toEmulatorChange':
    'Changing the emulator for a platform leaves its games in the old one’s folder. RomMix stops ' +
    'counting them as downloaded and offers them again.',
  'storage.toEmulatorMissing':
    'A game cannot be downloaded for a platform with no emulator installed yet.',
  'storage.toEmulatorExisting':
    'Games already in the RomMix folder stay there and are offered again; switch back and they ' +
    'reappear.',
  'storage.toEmulatorKeep': 'Keep one folder',
  'storage.toEmulatorConfirm': "Use each emulator's folder",
  'storage.toSharedTitle': 'Keep every game in one folder?',
  'storage.toSharedBody':
    "Downloads will go to RomMix's own ROM folder, which is not a folder any emulator reads " +
    'until it is told to:',
  'storage.toSharedSetup':
    "Add that folder to each emulator's own game directories, or they will not list what RomMix " +
    'has downloaded. The pre-flight check names the folder.',
  'storage.toSharedFree':
    'Changing the emulator for a platform then moves nothing and re-downloads nothing, and a game ' +
    'can be downloaded before anything that runs it is installed.',
  'storage.toSharedExisting':
    "Games already in an emulator's own folder stay there and are offered again; switch back and " +
    'they reappear.',
  'storage.toSharedKeep': "Keep each emulator's folder",
  'storage.toSharedConfirm': 'Use one folder',
  'storage.optionEmulator': "Each emulator's folder",
  'storage.optionRomMix': 'RomMix folder',

  // -- connect --------------------------------------------------------------

  'connect.title': 'Connect to RomM',
  'connect.subtitle': 'Point RomMix at your RomM server to browse and download your library.',
  'connect.serverAddress': 'Server address',
  'connect.serverAddressHint': 'The same address you use for the RomM web interface.',
  'connect.howSignIn': 'How would you like to sign in?',
  'connect.modeDevice': 'Pair this device',
  'connect.modeToken': 'API token',
  'connect.modePassword': 'Username & password',
  'connect.deviceExplainer':
    'RomMix shows a short code that you approve from RomM in any browser — no password typed on ' +
    'the couch.',
  'connect.tokenHint': 'Create one in RomM under Administration → Client tokens.',
  'connect.username': 'Username',
  'connect.password': 'Password',
  'connect.contacting': 'Contacting server…',
  'connect.startPairing': 'Start pairing',
  'connect.connecting': 'Connecting…',
  'connect.connect': 'Connect',
  'connect.connectedAs': 'Connected to RomM as {user}',
  'connect.someone': 'user',
  'connect.pairTitle': 'Approve this device',
  'connect.pairExplainer':
    'Scan this with your phone, or open the address below on any device, then enter the code to ' +
    'let RomMix into your library.',
  'connect.pairOpen': 'Open in a browser',
  'connect.pairExpiresIn': 'Code expires in',
  'connect.pairTimeLeft': '{minutes}m {seconds}s',
  'connect.pairExpired': 'The pairing code expired. Try again.',

  // -- home -----------------------------------------------------------------

  'home.title': 'Home',
  'home.continuePlaying': 'Continue playing',
  'home.readyToPlay': 'Ready to play',
  'home.favourites': 'Favourites',
  'home.recentlyAdded': 'Recently added',
  'home.empty': 'Your RomM library looks empty. Add some ROMs on the server and run a scan.',
  'home.pressToOpen': 'Press {key} to open',

  // -- library --------------------------------------------------------------

  'library.title': 'Library',
  'library.browseAll': 'Browse everything on your RomM server',
  'library.count_one': '{count} game',
  'library.count_other': '{count} games',
  'library.countOnPlatform_one': '{count} game on {platform}',
  'library.countOnPlatform_other': '{count} games on {platform}',
  'library.searchPlaceholder': 'Game title…',
  'library.searchHint': 'Press {key} to jump here, Escape to leave the field.',
  'library.allPlatforms': 'All platforms',
  'library.scopeLabel': 'Show:',
  'library.searchLabel': 'Search:',
  'library.platformLabel': 'Platform:',
  'library.scopeAll': 'All games',
  'library.scopeDownloaded': 'Downloaded only',
  'library.noneDownloaded': 'No games downloaded yet.',
  'library.platformChip': '{name} ({count})',
  'library.noMatches': 'No games match that search.',
  'library.thatIsAll_one': 'That is all {count} of them.',
  'library.thatIsAll_other': 'That is all {count} of them.',
  'library.downloadedMark': 'Downloaded',

  // -- the user's own shelves on RomM ---------------------------------------

  'collections.mine': 'Collections',
  'collections.derived': 'Virtual collections',
  'collections.count_one': '{count} collection',
  'collections.count_other': '{count} collections',
  'collections.openExpand': 'Open · Expand',
  'collections.subtitle': 'Collections you made on RomM, and the ones RomM builds itself.',
  'collections.empty': 'No collections on your RomM server yet.',
  'collections.emptyShelf': 'Nothing in this collection.',
  'collections.button': 'Collections',
  'collections.dialogTitle': 'Which collections?',
  'collections.none': 'You have no collections on RomM yet. Make one there and it appears here.',
  'collections.on': 'On',
  'collections.off': 'Add',
  'collections.add': 'Add to this collection',
  'collections.remove': 'Remove from this collection',

  // -- downloads ------------------------------------------------------------

  'downloads.title': 'Downloads',
  'downloads.onDisk_one': '{count} game on disk · {size}',
  'downloads.onDisk_other': '{count} games on disk · {size}',
  'downloads.state.queued': 'Waiting',
  'downloads.state.downloading': 'Downloading',
  'downloads.state.extracting': 'Extracting',
  'downloads.state.done': 'Installed',
  'downloads.state.error': 'Failed',
  'downloads.state.cancelled': 'Cancelled',
  'downloads.sort.recent': 'Recently added',
  'downloads.sort.largest': 'Largest first',
  'downloads.sort.name': 'Name',
  'downloads.tabActivity': 'Activity',
  'downloads.tabDevice': 'On this device',
  'downloads.checkingTitle': 'Checking your library',
  'downloads.checkedOf': '{checked} of {total} games checked',
  'downloads.askingRomM': 'Asking RomM what you have…',
  'downloads.checkExplainer':
    'Every game on the server is compared against the folder it would be installed in.',
  'downloads.nothingTransferring': 'Nothing transferring. Pick a game and press Download.',
  'downloads.inProgress': 'In progress',
  'downloads.recent': 'Recent',
  'downloads.clearFinished': 'Clear finished',
  'downloads.cleared_one': '{count} finished transfer cleared',
  'downloads.cleared_other': '{count} finished transfers cleared',
  'downloads.sortBy': 'Sort: {mode}',
  'downloads.groupBySystem': 'Group by system: {value}',
  'downloads.syncWithDisk': 'Sync with disk',
  'downloads.nothingDownloaded': 'Nothing downloaded yet. Pick a game and press Download.',
  'downloads.showMore': 'Show {count} more of {total}',
  'downloads.openExpand': 'Open · Expand',
  'downloads.groupMeta_one': '{count} game · {size}',
  'downloads.groupMeta_other': '{count} games · {size}',
  'downloads.fileCount_one': '{count} file',
  'downloads.fileCount_other': '{count} files',
  'downloads.syncFound_one': '{count} found on disk',
  'downloads.syncFound_other': '{count} found on disk',
  'downloads.syncRemoved_one': '{count} no longer there',
  'downloads.syncRemoved_other': '{count} no longer there',
  'downloads.syncUnchanged_one': '{count} game checked — nothing changed',
  'downloads.syncUnchanged_other': '{count} games checked — nothing changed',
  'downloads.uninstalled': 'Uninstalled',

  'uninstall.title': 'Uninstall this game?',
  'uninstall.body': '{file} will be deleted from {folder}. Your saves on RomM are kept.',
  'uninstall.freeing': 'Uninstall, freeing {size}',

  // -- BIOS -----------------------------------------------------------------

  'bios.title': 'BIOS',
  'bios.allInPlace': 'Every BIOS file RomMix knows about is in place.',
  'bios.missingSummary_one': '{count} file missing, {fetchable} of them on your RomM server',
  'bios.missingSummary_other': '{count} files missing, {fetchable} of them on your RomM server',
  'bios.explainer':
    'BIOS files come from your own RomM server — upload them there under a platform, and RomMix ' +
    'copies them into whichever emulator runs that platform. Nothing is downloaded from anywhere ' +
    'else.',
  'bios.nothingToInstall': 'Nothing to install',
  'bios.recheck': 'Re-check',
  'bios.noPlatforms': 'No platforms on your RomM server yet.',
  'bios.installingTitle': 'Installing BIOS files',
  'bios.workingOut': 'Working out what is missing…',
  'bios.progress': '{done} of {total}',
  'bios.checkedAllInPlace': 'Checked — every BIOS file is in place',
  'bios.checkedMissing_one': 'Checked — {count} file still missing',
  'bios.checkedMissing_other': 'Checked — {count} files still missing',
  'bios.fileInstalled': '{file} installed',
  'bios.syncInstalled_one': '{count} installed',
  'bios.syncInstalled_other': '{count} installed',
  'bios.syncFailed_one': '{count} failed',
  'bios.syncFailed_other': '{count} failed',
  'bios.syncUnavailable_one': '{count} not on the server',
  'bios.syncUnavailable_other': '{count} not on the server',
  'bios.statusUnknown': 'Unknown',
  'bios.statusMissing_one': '{count} missing',
  'bios.statusMissing_other': '{count} missing',
  'bios.statusReady': 'Ready',
  'bios.itemInstalled': 'Installed',
  'bios.itemRequired': 'Required',
  'bios.itemOptional': 'Optional',
  'bios.itemVerified': 'Verified',
  'bios.uploadedForPlatform': 'Uploaded to RomM for this platform',
  'bios.notOnServer': 'Not on your server',

  // What each BIOS file is, as the row beneath its name.

  'bios.note.scph5500': 'PlayStation BIOS — Japan',
  'bios.note.scph5501': 'PlayStation BIOS — North America',
  'bios.note.scph5502': 'PlayStation BIOS — Europe',
  'bios.note.sega101': 'Saturn BIOS — Japan',
  'bios.note.mpr17933': 'Saturn BIOS — North America and Europe',
  'bios.note.segaCdU': 'Sega CD BIOS — North America',
  'bios.note.segaCdE': 'Mega-CD BIOS — Europe',
  'bios.note.segaCdJ': 'Mega-CD BIOS — Japan',
  'bios.note.dcBoot': 'Dreamcast boot ROM',
  'bios.note.dcFlash': 'Dreamcast flash, holds the clock and region',
  'bios.note.syscard3': 'PC Engine CD System Card 3',
  'bios.note.neogeo': 'Neo Geo BIOS set',
  'bios.note.neocd': 'Neo Geo CD BIOS — top-loading model',
  'bios.note.disksys': 'Famicom Disk System BIOS',
  'bios.note.gbaBios': 'Game Boy Advance BIOS — improves accuracy',
  'bios.note.ndsBios7': 'Nintendo DS ARM7 BIOS',
  'bios.note.ndsBios9': 'Nintendo DS ARM9 BIOS',
  'bios.note.ndsFirmware': 'Nintendo DS firmware',
  'bios.note.prodKeys': 'Console master keys — nothing decrypts without them',
  'bios.note.titleKeys': 'Per-title keys, for installed games, updates and DLC',
  'bios.note.panafz10': '3DO BIOS — Panasonic FZ-10',
  'bios.note.lynxboot': 'Atari Lynx boot ROM',
  'bios.note.atari5200': 'Atari 5200 BIOS',
  'bios.note.atari7800': 'Atari 7800 BIOS — North America',
  'bios.note.colecovision': 'ColecoVision BIOS',
  'bios.note.pcfx': 'PC-FX BIOS',
  'bios.note.x68000Ipl': 'X68000 IPL ROM',
  'bios.note.x68000Cgrom': 'X68000 character generator ROM',
  'bios.note.kickstart13': 'Kickstart 1.3 — Amiga 500',
  'bios.note.kickstart31A1200': 'Kickstart 3.1 — Amiga 1200',
  'bios.note.kickstart31Cd32': 'Kickstart 3.1 — CD32',

  // Systems whose BIOS is more than a file to copy.

  'bios.setup.ps2':
    'PlayStation 2 needs a BIOS dumped from a real console. The filename varies by model, so ' +
    'anything uploaded to RomM for this platform is installed as-is.',
  'bios.setup.ps3': 'PlayStation 3 needs its firmware installed by RPCS3 itself.',
  'bios.setup.psvita': 'PlayStation Vita needs a firmware dump installed by Vita3K.',
  'bios.setup.n3ds': 'The 3DS needs its shared fonts and AES keys dumped from a console.',
  'bios.setup.switch': 'The Switch needs prod.keys and a firmware dump from a console.',
  'bios.setup.wiiu': 'Wii U needs keys and an OTP dump from a console.',

  // Why a platform's BIOS cannot be placed at all.

  'bios.blockedNoMapping':
    'RomMix has no folder mapping for {platform}, so it does not know which emulator runs it. ' +
    'Add one in settings.systemOverrides.',
  'bios.blockedNoEmulator': 'No installed emulator runs {system}.',
  'bios.blockedNoFolder': 'RomMix does not know where {name} keeps its BIOS files.',

  // -- a game ---------------------------------------------------------------

  'game.fallbackTitle': 'Game',
  'game.play': 'Play',
  'game.running': 'Running…',
  'game.cancelDownload': 'Cancel download ({percent}%)',
  'game.addFavourite': 'Add to favourites',
  'game.removeFavourite': 'Remove from favourites',
  'game.runWith': 'Run with',
  'game.pullSaves': 'Pull saves',
  'game.pushSaves': 'Push saves',
  'game.extracting': 'Extracting…',
  'game.downloading': 'Downloading…',
  'game.openBios': 'Open BIOS',
  'setup.dontShowAgain': "Don't show this again",
  'game.tabDetails': 'Details',
  'game.tabSaves': 'Saves',
  'game.tabFiles': 'Files',
  'game.tabScreenshots': 'Screenshots',
  'game.revision': 'Rev {revision}',
  'game.ratingOutOf': '/ 100',
  'game.runningAsk':
    'The game is running. RomMix will ask what to send to RomM when you quit the emulator.',
  'game.runningAuto':
    'The game is running. RomMix will sync your saves back to RomM when you quit the emulator.',
  'game.biosMissing_one': '{platform} needs {files} to start most games, and it is not installed.',
  'game.biosMissing_other':
    '{platform} needs {files} to start most games, and they are not installed.',
  'game.biosSetup': '{platform} needs its BIOS set up before games will run.',
  'setup.hidden': 'Setup steps hidden for {emulator}',
  'game.alreadyDownloaded': 'Already downloaded',
  'game.downloadStarted': 'Download started',
  'game.couldNotStart': 'The game could not be started',
  'game.sessionEnded': 'Session ended',
  'game.sessionPending_one': 'Session ended — {count} file to send',
  'game.sessionPending_other': 'Session ended — {count} files to send',
  'game.sessionSent_one': 'Session ended — {count} save file sent to RomM',
  'game.sessionSent_other': 'Session ended — {count} save files sent to RomM',
  'game.favouriteAdded': 'Added to favourites on RomM',
  'game.favouriteRemoved': 'Removed from favourites',

  // The four questions the game screen asks before doing something final.

  'game.variantTitle': 'How should {system} games run?',
  'game.variantBody':
    '{emulator} offers several. Remembered for {system} — change it later with Run with',
  'game.deleteSaveTitle': 'Delete this save {where}?',
  'game.deleteStateTitle': 'Delete this state {where}?',
  'game.deleteAssetBody': '{file} — {location}. {consequence}',
  'game.deleteOnlyCopy': 'This is the only copy.',
  'game.deleteAt': 'Delete {where}',
  'game.pushTitle_one': 'Send {count} file to RomM?',
  'game.pushTitle_other': 'Send {count} files to RomM?',
  'game.pushUploadedAs': 'Uploaded as {device}.',
  'game.pushSend': 'Send to RomM',
  'game.pushSendNoAsk': "Send and don't ask again",

  // -- what a push is about to send -----------------------------------------

  'push.folderAsZip': 'folder, sent as one zip',
  'push.onRomM': 'On RomM: {source}, {when}',
  'push.newerThanThis': 'newer than this',
  'push.newOnRomM': 'New on RomM',
  'push.thisDevice': 'this device',
  'push.anotherDevice': 'another device',
  'push.andMore_one': 'and {count} more file.',
  'push.andMore_other': 'and {count} more files.',

  // -- saves ----------------------------------------------------------------

  'asset.save': 'Save',
  'asset.state': 'State',

  'saves.synced': 'In sync',
  'saves.syncedHint': 'This device and RomM have the same file.',
  'saves.localNewer': 'Newer here',
  'saves.localNewerHint': 'Played since it was last uploaded. Push saves sends it.',
  'saves.localOnly': 'Not on RomM',
  'saves.localOnlyHint': 'Only on this device. Push saves sends it.',
  'saves.remoteNewer': 'Newer on RomM',
  'saves.remoteNewerHint': 'RomM has a more recent copy. Pull saves fetches it.',
  'saves.remoteOnly': 'Not on this device',
  'saves.remoteOnlyHint': 'Only on RomM. Pull saves fetches it.',
  'saves.scopeLocal': 'from this device',
  'saves.scopeRemote': 'from RomM',
  'saves.consequenceLocal': 'Pull saves brings the copy on RomM back down.',
  'saves.consequenceRemote': 'Push saves sends the copy on this device back up.',
  'saves.empty': 'No saves for this game, here or on RomM.',
  'saves.emptyPlayIt': 'Play it once and its save will appear here.',
  'saves.nothingNewer': 'Nothing newer on RomM',
  'saves.noLocalSaves': 'No local saves to send',
  'saves.pulled_one': '{count} file downloaded',
  'saves.pulled_other': '{count} files downloaded',
  'saves.pushed_one': '{count} file sent to RomM',
  'saves.pushed_other': '{count} files sent to RomM',
  'saves.nothingSent': 'Nothing was sent',
  'saves.noAskAgain': 'Saves will be sent without asking',
  'saves.deleted': '{file} deleted {where}',
  // -- what a particular emulator cannot sync, and what it still needs --------
  //
  // Named by the descriptors in `src/config/emulators/`, which are pure
  // functions of an install and have no language to answer in — they hold the
  // key and `localize` resolves it. Held here rather than beside them so that
  // one phrase serves every frontend that ships the same component: RetroDECK
  // and EmuDeck both run Dolphin, and both said so in their own words before.
  'saves.retrodeckPcsx2':
    'RetroDECK gives PCSX2 one memory card shared by every PS2 game, so there is no save file that belongs to this one. Save states are synced.',
  'saves.retrodeckDuckstation':
    'RetroDECK gives DuckStation one memory card shared by every PS1 game, so there is no save file that belongs to this one. Save states are synced.',
  'saves.pcsx2':
    'PCSX2 keeps one memory card shared by every PS2 game, so there is no save file that belongs to this one. Save states are synced.',
  'saves.dolphin':
    'Dolphin keeps one GameCube memory card per region and one Wii NAND for every game, so there is no save file that belongs to this one. Save states are synced.',
  'saves.primehack':
    'PrimeHack keeps one memory card for every game, so there is no save file that belongs to this one. Save states are synced.',
  'saves.ppsspp':
    'PPSSPP files saves under the game id printed inside the disc image rather than under the ROM name, which RomMix cannot read from outside the emulator.',
  'saves.rpcs3':
    'RPCS3 files saves under the PS3 title id rather than the ROM name, which RomMix cannot match to this game.',
  'saves.cemu':
    'Cemu files saves under the Wii U title id rather than the ROM name, which RomMix cannot match to this game.',
  'saves.vita3k':
    'Vita3K files saves under the Vita title id rather than the ROM name, which RomMix cannot match to this game.',
  'saves.xenia':
    'Xenia files saves under the Xbox 360 title id rather than the ROM name, which RomMix cannot match to this game.',
  'saves.flycast':
    'Flycast keeps two VMU memory cards shared by every Dreamcast game, so there is no save file that belongs to this one. Save states are synced.',
  'saves.xemu':
    'xemu keeps one emulated Xbox hard disk for every game, so there is no save file that belongs to this one.',
  'saves.xroar': 'XRoar writes no battery saves; only its states are synced.',
  'saves.azahar':
    'Azahar keeps saves inside an emulated SD card tree keyed by title id, which RomMix cannot match to this game.',
  'saves.azaharStates':
    'Azahar keeps saves inside an emulated SD card tree keyed by title id, which RomMix cannot match to this game. Save states are synced.',
  'saves.shadps4NoData': 'RomMix has not found where shadPS4 keeps its save data.',
  'saves.shadps4NoSerial':
    "This game states no PS4 serial, so RomMix cannot tell which of shadPS4's save folders is its own.",
  'setup.edenRoms': "Add RomMix's ROM folder to Eden: File → Game Directories.",
  'setup.edenFirmware':
    'Install firmware in Eden: Tools → Install Firmware. Keys are copied for you.',
  'setup.edenControls': 'Set up your controller in Eden: Emulation → Configure → Controls.',
  'setup.edenExitConfirm':
    'Turn off Eden’s exit confirmation: Emulation → Configure → General → Confirm exit while ' +
    'emulation is running.',
  'setup.edenStaging':
    'Install firmware in Eden: Tools → Install Firmware, pointed at the file below.',
  'setup.shadps4Roms':
    "Add RomMix's ROM folder to shadPS4, so its game list finds what you download.",

  'saves.switchNoTitleId':
    'RomMix could not read a title id for this game, which is how {emulator} names its save ' +
    'folder. A ROM that carries its title id in the file name, or an unmodified NSP or XCI, ' +
    'resolves automatically.',
  'saves.switchNoProfile':
    '{emulator} has no user profile yet, so there is nowhere for a save to go. Start it once and ' +
    'create a profile.',

  // -- a game's details -----------------------------------------------------

  'details.company': 'Company',
  'details.series': 'Series',
  'details.released': 'Released',
  'details.players': 'Players',
  'details.modes': 'Modes',
  'details.languages': 'Languages',
  'details.tags': 'Tags',
  'details.lastPlayed': 'Last played',
  'details.installedTo': 'Installed to',
  'details.systemFolder': 'System folder',
  'details.downloadedFor': 'Downloaded for',
  'details.onDisk': 'On disk',
  'details.downloaded': 'Downloaded',
  'details.romMixFolder': "RomMix's own folder",
  'details.empty': 'RomM knows nothing more about this game.',

  'files.tagBoth': 'Both',
  'files.tagServer': 'RomM',
  'files.tagDevice': 'Device',
  'files.hintBoth': 'On the server and on this device.',
  'files.hintServer': 'On the server only. Download the game to get it.',
  'files.hintDevice': 'On this device only. RomM does not list it.',
  'files.empty': 'RomM lists no files for this game, and none are on this device.',
  'shots.empty': 'RomM has no screenshots for this game.',
  'shots.view': 'View',
  'shots.previous': 'Previous screenshot',
  'shots.next': 'Next screenshot',
  'shots.position': '{index} of {total}',

  // -- settings -------------------------------------------------------------

  'settings.title': 'Settings',
  'settings.tabGeneral': 'General',
  'settings.tabGames': 'Games',
  'settings.tabSystem': 'System',

  'settings.server': 'Server',
  'settings.address': 'Address',
  'settings.signedInAs': 'Signed in as',
  'settings.rommVersion': 'RomM version',
  'settings.disconnect': 'Disconnect',
  'settings.disconnected': 'Disconnected from RomM',
  'settings.interface': 'Interface',
  'settings.scaleHint': 'Auto follows the screen: twice the size on a 4K television.',
  'settings.language': 'Language',
  'settings.languageHint': 'Auto follows the language this machine is set to.',
  'settings.support': 'Support RomMix',
  'settings.supportBody':
    'RomMix is free and always will be. If it saved you an afternoon of wiring emulators ' +
    'together, you can buy me a coffee.',
  'settings.buyCoffee': 'Buy me a coffee',
  'settings.scanOrOpen': 'Scan this with your phone, or open it in a browser on this machine.',
  'settings.application': 'Application',
  'settings.toggleFullscreen': 'Toggle fullscreen',

  'settings.gamesOnDisk': 'Games on disk',
  'settings.storageToRomMix': 'New downloads go to the RomMix folder — add it to each emulator',
  'settings.storageToEmulator': "New downloads go to each emulator's own folder",
  'settings.sharedFolderNote':
    'Games are written to {path}/roms/<system>. Games already downloaded into an emulator’s own ' +
    'folder stay there and are offered for download again; switch back and they reappear.',
  'settings.saveSync': 'Save sync',
  'settings.syncDown': 'Download newer saves before playing',
  'settings.syncDownHint': 'Only when strictly newer. The local file is kept as *.rommix-bak.',
  'settings.syncUp': 'Upload saves after playing',
  'settings.syncUpHint': 'Only what the session wrote is sent.',
  'settings.confirmPush': 'Ask before sending saves to RomM',
  'settings.confirmPushHint': 'Shows what will be sent before sending it.',
  'settings.downloads': 'Downloads',
  'settings.confirmUninstall': 'Ask before deleting a downloaded game',
  'settings.confirmUninstallHint': 'Uninstall is one A press from deleting a multi-gigabyte file.',

  'emulators.explainer':
    'What RomMix found on this machine, and how many platforms each one covers. The order is the ' +
    'preference: a platform with no choice of its own is run by the first emulator here that is ' +
    'installed and covers it, so moving one up makes it the default for everything it can run. ' +
    'Platforms you have chosen for individually below are unaffected.',
  'emulators.platforms': 'Platforms',
  'emulators.platformsExplainer':
    'Which emulator runs each platform in your library. Every platform starts on a default taken ' +
    'from what these emulators normally handle; change one and RomMix uses your choice for that ' +
    'platform only, and says so rather than quietly substituting if it is missing.',

  // -- one emulator ---------------------------------------------------------

  'emulator.notChecked': 'Not checked',
  'emulator.installed': 'Installed',
  'emulator.needsSetup': 'Needs setup',
  'emulator.notInstalled': 'Not installed',
  'emulator.kindFlatpak': 'Flatpak',
  'emulator.kindBinary': 'Program',
  'emulator.kindAppImage': 'AppImage',
  'emulator.kindScripts': 'Launchers',
  'emulator.groupGeneral': 'General',
  'emulator.groupFolders': 'Folders',
  'emulator.platforms_one': '{count} platform',
  'emulator.platforms_other': '{count} platforms',
  'emulator.homepage': 'Homepage',
  'emulator.home': 'Home',
  'emulator.roms': 'Roms',
  'emulator.saves': 'Saves',
  'emulator.bios': 'Bios',
  'emulator.notFound': 'not found',
  'emulator.setByYou': '(set by you)',
  'emulator.homeFolder': 'Home folder',
  'emulator.homeFolderHint':
    'Roms, saves, states and BIOS are read from inside this folder. Leave it empty to go back to ' +
    'finding it automatically.',
  'emulator.useThisFolder': 'Use this folder',
  'emulator.changeVersion': 'Change version',
  'emulator.run': 'Run',
  'emulator.movedUp': '{name} moved up',
  'emulator.movedDown': '{name} moved down',
  'emulator.rootSet': '{name} will be read from {path}',
  'emulator.rootCleared': '{name} folder found automatically again',
  'emulator.installedTitle': '{name} is installed',
  'emulator.setupTitle': 'Set up {name}',
  'emulator.setupSteps': 'Setup steps',
  'emulator.setupIntro':
    'What is left is inside {name} itself — RomMix can neither do these from outside it nor check ' +
    'that they are done:',
  'emulator.installedToast': '{name} installed',
  'emulator.installingFlathub': 'Installing from Flathub',
  'emulator.contactingFlathub': 'Contacting Flathub…',
  'emulator.installTitle': 'Install {name}',
  'emulator.fromFlathub': '{appId}, from Flathub',
  'emulator.buildIntoRomMix': "the build you pick, into RomMix's own folder",
  'emulator.manualInstall': '{name} has to be installed by hand.',
  'emulator.manualInstallFrom': '{name} has to be installed by hand, from {homepage}.',
  'emulator.reasonNotInstalled': '{name} is not installed.',
  'emulator.reasonNotRun': '{name} has not been run yet, so its folders do not exist.',

  'platforms.connectFirst': 'Connect to RomM to see the platforms in your library.',
  'platforms.noneCovers': 'No emulator covers this',
  'platforms.noneInstalled': 'None installed',
  'platforms.meta_one': '{system} · {count} game',
  'platforms.meta_other': '{system} · {count} games',
  'platforms.default': '(default)',

  // -- picking a build to install -------------------------------------------

  'install.installing': 'Installing {name}',
  'install.title': 'Install {name}',
  'install.noBuilds': 'No builds were published for this machine.',
  'install.whichVersion': 'Which version?',
  'install.publishedAt': 'Published at {url}.',
  'install.latest': 'Latest',
  'install.prerelease': 'Pre-release',
  'install.noDate': 'no publication date',
  'install.builds_one': '{count} build for this machine',
  'install.builds_other': '{count} builds for this machine',
  'install.chooseVersion': 'Choose this version',
  'install.chooseBuild': 'Install this build',
  'install.whichBuild':
    'Which build? Pick the one that matches your hardware — when in doubt, the plainest name is ' +
    'the general-purpose one.',
  'install.otherVersions': 'Other versions',

  // -- RomMix's own updates -------------------------------------------------

  'update.label': 'New versions of RomMix',
  'update.policyAuto': 'Automatic',
  'update.policyNotify': 'Tell me',
  'update.policyOff': 'Off',
  'update.hintAuto':
    'New versions are downloaded in the background and used the next time RomMix starts.',
  'update.hintNotify': 'RomMix says when a new version is published and waits for you to fetch it.',
  'update.hintOff': 'RomMix never looks on its own. The button below still does.',
  'update.installed': 'Installed',
  'update.newestPublished': 'Newest published',
  'update.checking': 'checking…',
  'update.notCheckedYet': 'not checked yet',
  'update.lastChecked': 'Last checked',
  'update.available': 'RomMix {version} is available.',
  'update.availableBlocked': 'Download it from the releases page.',
  'update.availableAuto': 'It is being fetched now.',
  'update.availableManual': 'Fetch it whenever suits you — nothing is downloaded until you do.',
  'update.downloadingLine': 'Downloading RomMix {version}: {size}',
  'update.ready': 'RomMix {version} is ready.',
  'update.readyDefault': 'It runs the next time RomMix starts, or now if you restart.',
  'update.upToDate': 'RomMix is up to date.',
  'update.checkNow': 'Check now',
  'update.downloadVersion': 'Download {version}',
  'update.downloadAction': 'Download the new version',
  'update.restartNow': 'Restart now',
  'update.releasesPage': 'Releases page',
  'update.newest': 'RomMix {version} is the newest version',
  'update.steamBlocked':
    'Steam started RomMix, and it will not let a program restart itself. Quit RomMix and press ' +
    'Play again — the new version is already in place.',
  'update.noBuildForMachine': 'Release {version} has no build for this machine ({arch}).',
  'update.noVersionTag': 'The newest release has no version tag',
  'update.nothingToDownload': 'There is no new version to download',
  'update.nothingToRestartInto': 'There is no downloaded version to restart into',
  'update.devBuild': 'This is a development build, so RomMix will not replace it.',
  'update.notAppImage':
    'RomMix was not started from an AppImage, so it cannot replace itself. Download the new ' +
    'version from the releases page.',
  'update.cannotWrite':
    'RomMix cannot write to {dir}, so it cannot replace itself there. Move the AppImage ' +
    'somewhere you own, or download the new version from the releases page.',
  'update.noRoom': 'There is not enough room left on {dir} for the new version.',
  'update.githubResponded': 'GitHub responded {status}',
  'update.downloadFailed': 'Download failed: {url} responded {status}',

  // -- the installation itself ----------------------------------------------

  'system.updates': 'Updates',
  'system.romMixFolder': 'RomMix folder',
  'system.folderExplainer':
    'Settings, credentials, the download index, and any emulator RomMix installed. Move this ' +
    'folder to move the whole installation.',
  'system.folder': 'Folder',
  'system.folderHintEnv': 'Set by ROMMIX_HOME, which wins over anything chosen here.',
  'system.folderHint':
    'Settings are copied to the new folder; emulators and ROMs stay where they are.',
  'system.moveAndRestart': 'Move and restart',
  'system.folderMoved': 'RomMix folder moved — restarting',
  'system.preflight': 'Pre-flight check',
  'system.flatpakAvailable': 'Flatpak available',
  'system.flathubSetUp': 'Flathub set up',
  'system.flathubOnFirstInstall': 'no — added on first install',
  'system.emulatorsInstalled': 'Emulators installed',
  'system.countOf': '{count} of {total}',
  'system.romsWritable': 'ROM folders writable',
  'system.controller': 'Controller',
  'system.noController': 'none seen — press a button on it',
  'system.logFile': 'Log file',
  'system.allReady': 'Everything looks ready to play.',
  'system.rerunCheck': 'Re-run check',
  'system.checkedReady': 'Checked — everything looks ready to play',
  'system.checkedProblems_one': 'Checked — {count} thing to sort out',
  'system.checkedProblems_other': 'Checked — {count} things to sort out',

  'change.title': 'Change which emulator runs this?',
  'change.body': 'Each emulator keeps its own files, and nothing moves across when you change one:',
  'change.bios': 'BIOS files have to be installed again for the new emulator.',
  'change.gamesShared':
    'Games stay where they are — they are in RomMix’s own folder, which you point every emulator ' +
    'at.',
  'change.gamesPerEmulator':
    'Downloaded games stay in the old emulator’s folder and have to be downloaded again.',
  'change.saves': "Saves live in the old emulator's tree. Pull them from RomM after the change.",
  'change.confirm': 'Change it',
  'change.confirmNoAsk': "Change it, don't ask again",

  // -- what the pre-flight check reports ------------------------------------

  'diagnostics.noFlatpak':
    'flatpak is not installed, so RomMix cannot find or install the emulators that are ' +
    'distributed that way. Install it from your distribution, then re-run this check.',
  'diagnostics.noFlathub':
    'Flathub is not set up for your user, so there is nowhere to install the flatpak emulators ' +
    'from yet. RomMix adds it the first time you install one, or you can add it yourself with: ' +
    'flatpak remote-add --user --if-not-exists flathub ' +
    'https://dl.flathub.org/repo/flathub.flatpakrepo',
  'diagnostics.noEmulatorSuggest':
    'No emulator found. Install {name}, which covers most systems, from the Emulators section ' +
    'above.',
  'diagnostics.noEmulator': 'No emulator found. Install one from the Emulators section above.',
  'diagnostics.romsNotWritable':
    "{name}'s ROM folder {path} is not writable. Check its permissions, or that the drive it is " +
    'on is mounted.',
  'diagnostics.sharedFolder':
    "Games are downloaded to {path}. Add that folder to each emulator's own game directories, or " +
    'they will not list what RomMix has downloaded.',

  // -- failures the main process reports ------------------------------------

  'error.serverAddressEmpty': 'Server address is empty',
  'error.noServerConfigured': 'No RomM server configured',
  'error.cannotReach': 'Cannot reach {url}: {reason}',
  'error.notAuthorised': 'Not authorised — sign in again',
  'error.permissionDenied': 'Permission denied: {detail}',
  'error.rommReturned': 'RomM returned {status}: {detail}',
  'error.wrongCredentials': 'Wrong username or password',
  'error.sessionExpired': 'Session expired — sign in again',
  'error.emptyResponseBody': 'RomM returned an empty response body',
  'error.emptyAssetBody': 'Empty asset body',
  'error.credentialsRequired': 'Username and password are required',
  'error.tokenRequired': 'An API token is required',
  'error.couldNotSignIn': 'Could not sign in',

  'error.notDownloadedForEmulator':
    'That ROM is not downloaded for the emulator this platform uses',
  'error.notDownloadedYet': 'That ROM is not downloaded yet',
  'error.downloadedForOther':
    'This copy was downloaded for a different emulator. Download it again for the one this ' +
    'platform now uses.',
  'error.noEmulatorForSystem': 'No installed emulator can run "{system}".',
  'error.noEmulatorInstallOne':
    'No installed emulator can run "{system}". Install {name}, then try again.',
  'error.noFolderMapping':
    'RomMix does not know which folder "{platform}" maps to. Add a mapping for "{slug}" to ' +
    'settings.systemOverrides.',
  'error.noRomFolder': 'RomMix does not know where {name} keeps its games',

  'error.unknownEmulator': 'RomMix does not know an emulator called {id}',
  'error.emulatorNotInstalled': '{name} is not installed',
  'error.cannotInstall': 'RomMix cannot install {name} for you',
  'error.assetNotRunnable': '{asset} is not something RomMix can run',
  'error.assetWrongArch': '{asset} is not built for this machine ({arch})',
  'error.notAFlatpak': '{name} is not distributed as a flatpak',

  'error.rootMustBeAbsolute': 'The RomMix folder must be an absolute path',
  'error.romMixHomeSet':
    'ROMMIX_HOME is set, and it overrides the folder chosen here. Unset it and restart RomMix to ' +
    'move the folder from Settings.',
  'error.onlyWebAddresses': 'RomMix only opens web addresses',

  'error.biosListFailed': 'Cannot read the BIOS files on the server: {reason}',
  'error.biosGone': 'That BIOS file is no longer on the server',
  'error.biosNowhere': 'RomMix has nowhere to put that BIOS file',

  'error.assetGone': '{file} is no longer there to delete',
  'error.assetNotLocal': '{file} is not on this device to delete',
  'error.assetNotRemote': '{file} is not on RomM to delete',

  'error.cannotOpenArchive': 'Cannot open archive',
  'error.badZipEntry': 'Bad zip entry',
  'error.releasesResponded': '{api} responded {status}',
  'error.assetDownloadFailed': 'Download failed: {url} responded {status}',
  'error.noAppImageInArchive': '{archive} holds no AppImage',

  // -- starting a game ------------------------------------------------------

  'launch.installingCore': 'Installing the {core} core…',
  'launch.installingCorePercent': 'Installing the {core} core… {percent}%',
  'launch.alreadyRunning': 'A game is already running',
  'launch.cannotRunSystem':
    '{emulator} cannot run "{system}". Choose a different emulator for this platform in ' +
    'Settings, or install one that covers it.',
  'launch.launcherMissing':
    '{emulator} has no launcher installed for "{system}". Add one from {emulator}, or choose a ' +
    'different emulator for this platform in Settings.',
  'launch.stoppedBeforeStart': 'Stopped before the game started',
  'launch.syncWarning': 'Save sync warning: {details}',
  'launch.couldNotStartEmulator': 'Could not start the emulator: {reason}',
  'launch.couldNotStartNamed': 'Could not start {name}: {reason}',
  'launch.emulatorReported': 'The emulator reported: {detail}',
  'launch.quitImmediatelyDetail': 'The emulator quit immediately: {detail}',
  'launch.quitImmediately': 'The emulator quit immediately.',
  'launch.quitImmediatelyCode': 'The emulator quit immediately (code {code}).',
  'launch.emulatorQuitDetail': '{name} quit immediately: {detail}',
  'launch.emulatorQuitCode': '{name} quit immediately (code {code}).',

  'core.noneForMachine':
    "No {core} core is published for this machine. Install it from the emulator's own Online " +
    'Updater.',
  'core.downloadFailed': 'Could not download the {core} core: {url} responded {status}',
  'core.missingFile': 'The {core} download did not contain {file}',

  'host.addingFlathub': 'Adding the Flathub remote…',
  'host.flathubFailed':
    'Could not add the Flathub remote. Add it by hand with:  flatpak remote-add --user ' +
    '--if-not-exists {remote} {repo}',
  'host.suspiciousAppId': 'Refusing to install a suspicious app id: {appId}',
  'host.flatpakFailed': 'Could not run flatpak: {reason}'
}
