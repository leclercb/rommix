import type { Catalog } from './catalog.ts'

/**
 * RomMix auf Deutsch.
 *
 * Als `Catalog` deklariert: ein Eintrag, der in `en.ts` hinzukommt und hier
 * vergessen wird, scheitert am Typecheck, statt auf dem Bildschirm still auf
 * Englisch zu erscheinen.
 *
 * Eigennamen bleiben stehen — RomM, RomMix, Flatpak, Flathub, AppImage, BIOS —
 * und ebenso jede Beschriftung, die der Nutzer in einem anderen Programm sucht:
 * „Tools → Install Firmware“ steht so in einem Menü, das englisch bleibt.
 *
 * Angesprochen wird gesiezt, weil RomMix vom Sofa aus bedient wird und der Ton
 * überall gleich sein soll.
 */
export const de: Catalog = {
  // -- gemeinsame Wörter ----------------------------------------------------

  'action.back': 'Zurück',
  'action.cancel': 'Abbrechen',
  'action.close': 'Schließen',
  'action.keep': 'Behalten',
  'action.next': 'Weiter',
  'action.select': 'Auswählen',
  'action.open': 'Öffnen',
  'action.search': 'Suchen',
  'action.navigate': 'Navigieren',
  'action.menu': 'Menü',
  'action.type': 'Tippen',
  'action.install': 'Installieren',
  'action.installAll': 'Alle installieren',
  'action.reinstall': 'Neu installieren',
  'action.uninstall': 'Deinstallieren',
  'action.download': 'Herunterladen',
  'action.tryAgain': 'Erneut versuchen',
  'action.trying': 'Neuer Versuch…',
  'action.checking': 'Prüfung…',
  'action.installing': 'Installation…',
  'action.starting': 'Start…',
  'action.expand': 'Ausklappen',
  'action.collapse': 'Einklappen',
  'action.moveUp': 'Nach oben',
  'action.moveDown': 'Nach unten',
  'action.previousTab': 'Vorheriger Tab',
  'action.nextTab': 'Nächster Tab',
  'action.rowActions': 'Aktionen der Zeile',
  'action.openInBrowser': 'Im Browser öffnen',

  'value.on': 'An',
  'value.off': 'Aus',
  'value.yes': 'ja',
  'value.no': 'nein',
  'value.yesTitle': 'Ja',
  'value.noTitle': 'Nein',
  'value.auto': 'Auto',
  'value.none': 'Keiner',
  'value.unknown': 'unbekannt',
  'value.never': 'nie',
  'value.notConfigured': 'Nicht eingerichtet',

  'key.enter': 'Enter',
  'key.esc': 'Esc',

  // -- das Gerüst der Anwendung ---------------------------------------------

  'nav.home': 'Start',
  'nav.library': 'Bibliothek',
  'nav.collections': 'Sammlungen',
  'nav.downloads': 'Downloads',
  'nav.emulators': 'Emulatoren',
  'nav.bios': 'BIOS',
  'nav.settings': 'Einstellungen',

  'app.notConnected': 'Nicht verbunden',
  'app.loading': 'Wird geladen',
  'app.qrCode': 'QR-Code',
  'app.credit': 'Mit {heart} entwickelt von leclercb',
  'app.quitTitle': 'RomMix beenden?',
  'app.stay': 'Bleiben',
  'app.quit': 'Beenden',
  'app.quitRomMix': 'RomMix beenden',
  'app.gettingReady': 'Wird vorbereitet',
  'app.gameRunning': 'Spiel läuft',
  'app.emulatorHasFocusAsk':
    'Der Emulator hat den Fokus. Beenden Sie ihn, um zurückzukommen — RomMix fragt dann, was an ' +
    'RomM geschickt werden soll.',
  'app.emulatorHasFocusAuto':
    'Der Emulator hat den Fokus. Beenden Sie ihn, um zurückzukommen — Spielstände werden ' +
    'automatisch mit RomM abgeglichen.',
  'app.emulatorRunning': '{name} läuft',
  'app.emulatorOpened':
    '{name} hat den Fokus. Beenden Sie ihn, um zurückzukommen — es wird nichts gespielt, also gibt ' +
    'es auch nichts abzugleichen.',
  'app.holdToClose': '{key} gedrückt halten, um ihn von hier aus zu schließen.',
  'app.closeEmulator': 'Emulator schließen',
  'app.askingEmulatorToQuit': 'Der Emulator wird zum Beenden aufgefordert…',

  // -- Benachrichtigungen des Gerüsts ---------------------------------------

  'toast.updateAvailable': 'RomMix {version} ist verfügbar',
  'toast.updateAvailableSettings': 'RomMix {version} ist verfügbar — siehe Einstellungen',
  'toast.updateReadyRestart': 'RomMix {version} ist bereit — zum Verwenden neu starten',
  'toast.updateReadyQuit': 'RomMix {version} ist bereit — beenden und wieder starten',
  'toast.downloadComplete': 'Download abgeschlossen',
  'toast.downloadCancelled': 'Download abgebrochen',
  'toast.adoptedOne': 'War schon auf der Platte — zu Ihrer Bibliothek hinzugefügt',
  'toast.adoptedMany_one':
    '{count} Spiel war schon auf der Platte — zu Ihrer Bibliothek hinzugefügt',
  'toast.adoptedMany_other':
    '{count} Spiele waren schon auf der Platte — zu Ihrer Bibliothek hinzugefügt',

  // -- die veröffentlichte Demo ---------------------------------------------

  'demo.notAvailable': 'In der Web-Vorschau nicht verfügbar',
  'demo.noEmulator': 'In der Web-Vorschau gibt es keinen Emulator',
  'demo.noFirmware': 'Firmware nicht gefunden',
  'demo.nothingToReplace': 'Dies ist die Web-Vorschau, hier gibt es nichts zu ersetzen.',
  'demo.nothingChecked': 'Dies ist die Web-Vorschau: geprüft wurde in Wirklichkeit nichts.',
  'demo.connectionClosed':
    'Der Server hat die Verbindung geschlossen, bevor die Datei vollständig war.',
  'demo.variantFaster': 'schneller, weniger genau',
  'demo.variantDefault': 'die Wahl von RomMix',
  'demo.title': 'RomMix — Demo',
  'demo.description':
    'Die Oberfläche von RomMix, auf der Homebrew-Bibliothek der öffentlichen Demo von RomM. Weder ' +
    'ein Server noch ein Emulator ist beteiligt, und es wird nichts heruntergeladen.',

  // -- Ersteinrichtung ------------------------------------------------------

  'setup.stepOf': 'Schritt {step} von {total}',
  'setup.scaleTitle': 'Wie groß soll RomMix sein?',
  'setup.scaleSubtitle':
    'Auto richtet sich nach dem Bildschirm — doppelt so groß auf einem 4K-Fernseher. Wählen Sie ' +
    'eine Größe, die Sie von Ihrem Platz aus lesen können; ändern lässt sie sich später in den ' +
    'Einstellungen.',
  'setup.scaleHint': 'Die ganze Oberfläche, nicht nur der Text.',
  'setup.storageTitle': 'Wohin sollen heruntergeladene Spiele?',
  'setup.storageSubtitle':
    'Das entscheidet, wo jede ROM landet — jetzt zu antworten ist weit einfacher, als wenn schon ' +
    'Spiele am anderen Ort auf der Platte liegen.',

  // -- Einstellungen, die der Assistent mitbenutzt --------------------------

  'control.scale': 'Skalierung',
  'storage.label': 'Wohin heruntergeladene Spiele kommen',
  'storage.hintShared':
    'Ein Ordner für alles, auf den jeder Emulator einmal gezeigt werden muss. Ein Wechsel des ' +
    'Emulators verschiebt nichts, und ein Spiel kann heruntergeladen werden, bevor überhaupt ' +
    'etwas installiert ist, das es startet.',
  'storage.hintPerEmulator':
    'Der eigene ROM-Ordner jedes Emulators, damit Spiele in seiner Liste auftauchen, wenn Sie ihn ' +
    'selbst starten. Ein Emulatorwechsel für eine Plattform bedeutet, ihre Spiele erneut ' +
    'herunterzuladen.',
  'storage.toEmulatorTitle': 'Spiele im Ordner des jeweiligen Emulators halten?',
  'storage.toEmulatorBody':
    'Downloads gehen dann in den ROM-Ordner des Emulators, der ihre Plattform ausführt. Das ist ' +
    'es, was sie in dessen eigene Spieleliste bringt, wenn Sie ihn selbst starten — und was sie ' +
    'an ihn bindet:',
  'storage.toEmulatorChange':
    'Ein Emulatorwechsel für eine Plattform lässt ihre Spiele im Ordner des alten zurück. RomMix ' +
    'zählt sie nicht mehr als heruntergeladen und bietet sie erneut an.',
  'storage.toEmulatorMissing':
    'Ein Spiel lässt sich nicht für eine Plattform herunterladen, für die noch kein Emulator ' +
    'installiert ist.',
  'storage.toEmulatorExisting':
    'Spiele, die bereits im RomMix-Ordner liegen, bleiben dort und werden erneut angeboten; ' +
    'schalten Sie zurück, tauchen sie wieder auf.',
  'storage.toEmulatorKeep': 'Einen Ordner behalten',
  'storage.toEmulatorConfirm': 'Ordner des jeweiligen Emulators verwenden',
  'storage.toSharedTitle': 'Alle Spiele in einem Ordner halten?',
  'storage.toSharedBody':
    'Downloads gehen dann in den eigenen ROM-Ordner von RomMix — einen Ordner, den kein Emulator ' +
    'liest, solange man es ihm nicht sagt:',
  'storage.toSharedSetup':
    'Fügen Sie diesen Ordner den Spieleverzeichnissen jedes Emulators hinzu, sonst listen sie ' +
    'nicht, was RomMix heruntergeladen hat. Die Startklar-Prüfung nennt den Ordner.',
  'storage.toSharedFree':
    'Ein Emulatorwechsel für eine Plattform verschiebt dann nichts und lädt nichts erneut, und ein ' +
    'Spiel lässt sich herunterladen, bevor überhaupt etwas installiert ist, das es startet.',
  'storage.toSharedExisting':
    'Spiele, die bereits im Ordner eines Emulators liegen, bleiben dort und werden erneut ' +
    'angeboten; schalten Sie zurück, tauchen sie wieder auf.',
  'storage.toSharedKeep': 'Ordner des jeweiligen Emulators behalten',
  'storage.toSharedConfirm': 'Einen Ordner verwenden',
  'storage.optionEmulator': 'Ordner des jeweiligen Emulators',
  'storage.optionRomMix': 'RomMix-Ordner',

  // -- Verbinden ------------------------------------------------------------

  'connect.title': 'Mit RomM verbinden',
  'connect.subtitle':
    'Zeigen Sie RomMix auf Ihren RomM-Server, um Ihre Bibliothek zu durchsuchen und ' +
    'herunterzuladen.',
  'connect.serverAddress': 'Serveradresse',
  'connect.serverAddressHint': 'Dieselbe Adresse wie für die Weboberfläche von RomM.',
  'connect.howSignIn': 'Wie möchten Sie sich anmelden?',
  'connect.modeDevice': 'Dieses Gerät koppeln',
  'connect.modeToken': 'API-Token',
  'connect.modePassword': 'Benutzername und Passwort',
  'connect.deviceExplainer':
    'RomMix zeigt einen kurzen Code, den Sie in RomM in einem beliebigen Browser bestätigen — kein ' +
    'Passwort, das auf dem Sofa getippt werden muss.',
  'connect.tokenHint': 'Legen Sie eines in RomM unter Administration → Client tokens an.',
  'connect.username': 'Benutzername',
  'connect.password': 'Passwort',
  'connect.contacting': 'Server wird kontaktiert…',
  'connect.startPairing': 'Kopplung starten',
  'connect.connecting': 'Verbindung…',
  'connect.connect': 'Verbinden',
  'connect.connectedAs': 'Mit RomM verbunden als {user}',
  'connect.someone': 'Benutzer',
  'connect.pairTitle': 'Dieses Gerät bestätigen',
  'connect.pairExplainer':
    'Scannen Sie dies mit Ihrem Telefon oder öffnen Sie die Adresse unten auf einem beliebigen ' +
    'Gerät und geben Sie dann den Code ein, um RomMix in Ihre Bibliothek zu lassen.',
  'connect.pairOpen': 'Im Browser öffnen',
  'connect.pairExpiresIn': 'Code läuft ab in',
  'connect.pairTimeLeft': '{minutes} Min. {seconds} Sek.',
  'connect.pairExpired': 'Der Kopplungscode ist abgelaufen. Versuchen Sie es erneut.',

  // -- Start ----------------------------------------------------------------

  'home.title': 'Start',
  'home.continuePlaying': 'Weiterspielen',
  'home.readyToPlay': 'Spielbereit',
  'home.favourites': 'Favoriten',
  'home.recentlyAdded': 'Zuletzt hinzugefügt',
  'home.empty':
    'Ihre RomM-Bibliothek sieht leer aus. Legen Sie ROMs auf dem Server ab und starten Sie einen ' +
    'Scan.',
  'home.pressToOpen': '{key} drücken zum Öffnen',

  // -- Bibliothek -----------------------------------------------------------

  'library.title': 'Bibliothek',
  'library.browseAll': 'Alles durchsuchen, was auf Ihrem RomM-Server liegt',
  'library.count_one': '{count} Spiel',
  'library.count_other': '{count} Spiele',
  'library.countOnPlatform_one': '{count} Spiel auf {platform}',
  'library.countOnPlatform_other': '{count} Spiele auf {platform}',
  'library.searchPlaceholder': 'Spieltitel…',
  'library.searchHint': '{key} drücken, um hierher zu springen, Esc zum Verlassen des Feldes.',
  'library.allPlatforms': 'Alle Plattformen',
  'library.platformChip': '{name} ({count})',
  'library.noMatches': 'Kein Spiel passt zu dieser Suche.',
  'library.thatIsAll_one': 'Das war alles: {count} insgesamt.',
  'library.thatIsAll_other': 'Das war alles: {count} insgesamt.',
  'library.downloadedMark': 'Heruntergeladen',

  // -- die eigenen Regale des Nutzers auf RomM -------------------------------

  'collections.mine': 'Sammlungen',
  'collections.derived': 'Virtuelle Sammlungen',
  'collections.count_one': '{count} Sammlung',
  'collections.count_other': '{count} Sammlungen',
  'collections.openExpand': 'Öffnen · Ausklappen',
  'collections.subtitle':
    'Sammlungen, die Sie auf RomM angelegt haben, und die, die RomM selbst bildet.',
  'collections.empty': 'Noch keine Sammlungen auf Ihrem RomM-Server.',
  'collections.emptyShelf': 'Nichts in dieser Sammlung.',
  'collections.button': 'Sammlungen',
  'collections.dialogTitle': 'In welchen Sammlungen?',
  'collections.none':
    'Sie haben auf RomM noch keine Sammlungen. Legen Sie dort eine an, dann erscheint sie hier.',
  'collections.on': 'Drin',
  'collections.off': 'Hinzufügen',
  'collections.add': 'Zu dieser Sammlung hinzufügen',
  'collections.remove': 'Aus dieser Sammlung entfernen',

  // -- Downloads ------------------------------------------------------------

  'downloads.title': 'Downloads',
  'downloads.onDisk_one': '{count} Spiel auf der Platte · {size}',
  'downloads.onDisk_other': '{count} Spiele auf der Platte · {size}',
  'downloads.state.queued': 'Wartet',
  'downloads.state.downloading': 'Lädt herunter',
  'downloads.state.extracting': 'Entpackt',
  'downloads.state.done': 'Installiert',
  'downloads.state.error': 'Fehlgeschlagen',
  'downloads.state.cancelled': 'Abgebrochen',
  'downloads.sort.recent': 'Zuletzt hinzugefügt',
  'downloads.sort.largest': 'Größte zuerst',
  'downloads.sort.name': 'Name',
  'downloads.tabActivity': 'Aktivität',
  'downloads.tabDevice': 'Auf diesem Gerät',
  'downloads.checkingTitle': 'Ihre Bibliothek wird geprüft',
  'downloads.checkedOf': '{checked} von {total} Spielen geprüft',
  'downloads.askingRomM': 'RomM wird gefragt, was Sie haben…',
  'downloads.checkExplainer':
    'Jedes Spiel auf dem Server wird mit dem Ordner verglichen, in den es installiert würde.',
  'downloads.nothingTransferring':
    'Nichts wird übertragen. Wählen Sie ein Spiel und drücken Sie Herunterladen.',
  'downloads.inProgress': 'Laufend',
  'downloads.recent': 'Zuletzt',
  'downloads.clearFinished': 'Abgeschlossene entfernen',
  'downloads.cleared_one': '{count} abgeschlossene Übertragung entfernt',
  'downloads.cleared_other': '{count} abgeschlossene Übertragungen entfernt',
  'downloads.sortBy': 'Sortierung: {mode}',
  'downloads.groupBySystem': 'Nach System gruppieren: {value}',
  'downloads.syncWithDisk': 'Mit der Platte abgleichen',
  'downloads.nothingDownloaded':
    'Noch nichts heruntergeladen. Wählen Sie ein Spiel und drücken Sie Herunterladen.',
  'downloads.showMore': '{count} weitere von {total} anzeigen',
  'downloads.openExpand': 'Öffnen · Ausklappen',
  'downloads.groupMeta_one': '{count} Spiel · {size}',
  'downloads.groupMeta_other': '{count} Spiele · {size}',
  'downloads.fileCount_one': '{count} Datei',
  'downloads.fileCount_other': '{count} Dateien',
  'downloads.syncFound_one': '{count} auf der Platte gefunden',
  'downloads.syncFound_other': '{count} auf der Platte gefunden',
  'downloads.syncRemoved_one': '{count} nicht mehr vorhanden',
  'downloads.syncRemoved_other': '{count} nicht mehr vorhanden',
  'downloads.syncUnchanged_one': '{count} Spiel geprüft — nichts hat sich geändert',
  'downloads.syncUnchanged_other': '{count} Spiele geprüft — nichts hat sich geändert',
  'downloads.uninstalled': 'Deinstalliert',

  'uninstall.title': 'Dieses Spiel deinstallieren?',
  'uninstall.body':
    '{file} wird aus {folder} gelöscht. Ihre Spielstände auf RomM bleiben erhalten.',
  'uninstall.freeing': 'Deinstallieren und {size} freigeben',

  // -- BIOS -----------------------------------------------------------------

  'bios.title': 'BIOS',
  'bios.allInPlace': 'Jede RomMix bekannte BIOS-Datei liegt an ihrem Platz.',
  'bios.missingSummary_one': '{count} Datei fehlt, {fetchable} davon auf Ihrem RomM-Server',
  'bios.missingSummary_other': '{count} Dateien fehlen, {fetchable} davon auf Ihrem RomM-Server',
  'bios.explainer':
    'BIOS-Dateien kommen von Ihrem eigenen RomM-Server — laden Sie sie dort unter einer Plattform ' +
    'hoch, und RomMix kopiert sie in den Emulator, der diese Plattform ausführt. Von anderswo wird ' +
    'nichts heruntergeladen.',
  'bios.nothingToInstall': 'Nichts zu installieren',
  'bios.recheck': 'Erneut prüfen',
  'bios.noPlatforms': 'Noch keine Plattformen auf Ihrem RomM-Server.',
  'bios.installingTitle': 'BIOS-Dateien werden installiert',
  'bios.workingOut': 'Es wird ermittelt, was fehlt…',
  'bios.progress': '{done} von {total}',
  'bios.checkedAllInPlace': 'Geprüft — jede BIOS-Datei liegt an ihrem Platz',
  'bios.checkedMissing_one': 'Geprüft — {count} Datei fehlt weiterhin',
  'bios.checkedMissing_other': 'Geprüft — {count} Dateien fehlen weiterhin',
  'bios.fileInstalled': '{file} installiert',
  'bios.syncInstalled_one': '{count} installiert',
  'bios.syncInstalled_other': '{count} installiert',
  'bios.syncFailed_one': '{count} fehlgeschlagen',
  'bios.syncFailed_other': '{count} fehlgeschlagen',
  'bios.syncUnavailable_one': '{count} nicht auf dem Server',
  'bios.syncUnavailable_other': '{count} nicht auf dem Server',
  'bios.statusUnknown': 'Unbekannt',
  'bios.statusMissing_one': '{count} fehlt',
  'bios.statusMissing_other': '{count} fehlen',
  'bios.statusReady': 'Bereit',
  'bios.itemInstalled': 'Installiert',
  'bios.itemRequired': 'Erforderlich',
  'bios.itemOptional': 'Optional',
  'bios.itemVerified': 'Geprüft',
  'bios.uploadedForPlatform': 'Auf RomM für diese Plattform hochgeladen',
  'bios.notOnServer': 'Nicht auf Ihrem Server',

  // Was jede BIOS-Datei ist, in der Zeile unter ihrem Namen.

  'bios.note.scph5500': 'PlayStation-BIOS — Japan',
  'bios.note.scph5501': 'PlayStation-BIOS — Nordamerika',
  'bios.note.scph5502': 'PlayStation-BIOS — Europa',
  'bios.note.sega101': 'Saturn-BIOS — Japan',
  'bios.note.mpr17933': 'Saturn-BIOS — Nordamerika und Europa',
  'bios.note.segaCdU': 'Sega-CD-BIOS — Nordamerika',
  'bios.note.segaCdE': 'Mega-CD-BIOS — Europa',
  'bios.note.segaCdJ': 'Mega-CD-BIOS — Japan',
  'bios.note.dcBoot': 'Dreamcast-Boot-ROM',
  'bios.note.dcFlash': 'Dreamcast-Flash, enthält Uhr und Region',
  'bios.note.syscard3': 'PC Engine CD System Card 3',
  'bios.note.neogeo': 'Neo-Geo-BIOS-Satz',
  'bios.note.neocd': 'Neo-Geo-CD-BIOS — Modell mit Deckelöffnung',
  'bios.note.disksys': 'Famicom-Disk-System-BIOS',
  'bios.note.gbaBios': 'Game-Boy-Advance-BIOS — erhöht die Genauigkeit',
  'bios.note.ndsBios7': 'Nintendo-DS-ARM7-BIOS',
  'bios.note.ndsBios9': 'Nintendo-DS-ARM9-BIOS',
  'bios.note.ndsFirmware': 'Nintendo-DS-Firmware',
  'bios.note.prodKeys': 'Hauptschlüssel der Konsole — ohne sie wird nichts entschlüsselt',
  'bios.note.titleKeys': 'Schlüssel je Titel, für installierte Spiele, Updates und DLC',
  'bios.note.panafz10': '3DO-BIOS — Panasonic FZ-10',
  'bios.note.lynxboot': 'Atari-Lynx-Boot-ROM',
  'bios.note.atari5200': 'Atari-5200-BIOS',
  'bios.note.atari7800': 'Atari-7800-BIOS — Nordamerika',
  'bios.note.colecovision': 'ColecoVision-BIOS',
  'bios.note.pcfx': 'PC-FX-BIOS',
  'bios.note.x68000Ipl': 'X68000-IPL-ROM',
  'bios.note.x68000Cgrom': 'X68000-Zeichengenerator-ROM',
  'bios.note.kickstart13': 'Kickstart 1.3 — Amiga 500',
  'bios.note.kickstart31A1200': 'Kickstart 3.1 — Amiga 1200',
  'bios.note.kickstart31Cd32': 'Kickstart 3.1 — CD32',

  // Systeme, deren BIOS mehr ist als eine Datei zum Kopieren.

  'bios.setup.ps2':
    'Die PlayStation 2 braucht ein BIOS, das aus einer echten Konsole ausgelesen wurde. Der ' +
    'Dateiname hängt vom Modell ab, deshalb wird alles, was für diese Plattform auf RomM liegt, ' +
    'unverändert installiert.',
  'bios.setup.ps3': 'Die PlayStation 3 braucht ihre Firmware, installiert von RPCS3 selbst.',
  'bios.setup.psvita': 'Die PlayStation Vita braucht einen Firmware-Dump, installiert von Vita3K.',
  'bios.setup.n3ds':
    'Der 3DS braucht seine gemeinsamen Schriftarten und AES-Schlüssel aus einer Konsole.',
  'bios.setup.switch': 'Die Switch braucht prod.keys und einen Firmware-Dump aus einer Konsole.',
  'bios.setup.wiiu': 'Die Wii U braucht Schlüssel und einen OTP-Dump aus einer Konsole.',

  // Warum das BIOS einer Plattform überhaupt nicht abgelegt werden kann.

  'bios.blockedNoMapping':
    'RomMix hat keine Ordnerzuordnung für {platform} und weiß deshalb nicht, welcher Emulator sie ' +
    'ausführt. Legen Sie eine in settings.systemOverrides an.',
  'bios.blockedNoEmulator': 'Kein installierter Emulator führt {system} aus.',
  'bios.blockedNoFolder': 'RomMix weiß nicht, wo {name} seine BIOS-Dateien ablegt.',

  // -- ein Spiel ------------------------------------------------------------

  'game.fallbackTitle': 'Spiel',
  'game.play': 'Spielen',
  'game.running': 'Läuft…',
  'game.cancelDownload': 'Download abbrechen ({percent} %)',
  'game.addFavourite': 'Zu Favoriten hinzufügen',
  'game.removeFavourite': 'Aus Favoriten entfernen',
  'game.runWith': 'Ausführen mit',
  'game.pullSaves': 'Spielstände holen',
  'game.pushSaves': 'Spielstände senden',
  'game.extracting': 'Entpacken…',
  'game.downloading': 'Download…',
  'game.openBios': 'BIOS öffnen',
  'setup.dontShowAgain': 'Nicht mehr anzeigen',
  'game.tabDetails': 'Details',
  'game.tabSaves': 'Spielstände',
  'game.tabFiles': 'Dateien',
  'game.tabScreenshots': 'Screenshots',
  'game.revision': 'Rev. {revision}',
  'game.ratingOutOf': '/ 100',
  'game.runningAsk':
    'Das Spiel läuft. RomMix fragt beim Beenden des Emulators, was an RomM geschickt werden soll.',
  'game.runningAuto':
    'Das Spiel läuft. RomMix gleicht Ihre Spielstände beim Beenden des Emulators wieder mit RomM ' +
    'ab.',
  'game.biosMissing_one':
    '{platform} braucht {files}, damit die meisten Spiele starten, und es ist nicht installiert.',
  'game.biosMissing_other':
    '{platform} braucht {files}, damit die meisten Spiele starten, und sie sind nicht installiert.',
  'game.biosSetup': 'Bei {platform} muss das BIOS eingerichtet sein, bevor Spiele laufen.',
  'setup.hidden': 'Einrichtungsschritte für {emulator} ausgeblendet',
  'game.alreadyDownloaded': 'Bereits heruntergeladen',
  'game.downloadStarted': 'Download gestartet',
  'game.couldNotStart': 'Das Spiel konnte nicht gestartet werden',
  'game.sessionEnded': 'Sitzung beendet',
  'game.sessionPending_one': 'Sitzung beendet — {count} Datei zu senden',
  'game.sessionPending_other': 'Sitzung beendet — {count} Dateien zu senden',
  'game.sessionSent_one': 'Sitzung beendet — {count} Spielstand an RomM gesendet',
  'game.sessionSent_other': 'Sitzung beendet — {count} Spielstände an RomM gesendet',
  'game.favouriteAdded': 'Auf RomM zu den Favoriten hinzugefügt',
  'game.favouriteRemoved': 'Aus den Favoriten entfernt',

  // Die vier Fragen vor einem Schritt, der sich nicht zurücknehmen lässt.

  'game.variantTitle': 'Womit sollen {system}-Spiele laufen?',
  'game.variantBody':
    '{emulator} bietet mehrere an. Für {system} gemerkt — später über Ausführen mit änderbar',
  'game.deleteSaveTitle': 'Diesen Spielstand {where} löschen?',
  'game.deleteStateTitle': 'Diesen Savestate {where} löschen?',
  'game.deleteAssetBody': '{file} — {location}. {consequence}',
  'game.deleteOnlyCopy': 'Das ist die einzige Kopie.',
  'game.deleteAt': 'Löschen {where}',
  'game.pushTitle_one': '{count} Datei an RomM senden?',
  'game.pushTitle_other': '{count} Dateien an RomM senden?',
  'game.pushUploadedAs': 'Hochgeladen als {device}.',
  'game.pushSend': 'An RomM senden',
  'game.pushSendNoAsk': 'Senden und nicht mehr fragen',

  // -- was ein Senden gleich übertragen wird --------------------------------

  'push.folderAsZip': 'Ordner, als ein Zip gesendet',
  'push.onRomM': 'Auf RomM: {source}, {when}',
  'push.newerThanThis': 'neuer als dieser',
  'push.newOnRomM': 'Neu auf RomM',
  'push.thisDevice': 'dieses Gerät',
  'push.anotherDevice': 'ein anderes Gerät',
  'push.andMore_one': 'und {count} weitere Datei.',
  'push.andMore_other': 'und {count} weitere Dateien.',

  // -- Spielstände ----------------------------------------------------------

  'asset.save': 'Spielstand',
  'asset.state': 'Savestate',

  'saves.synced': 'Abgeglichen',
  'saves.syncedHint': 'Dieses Gerät und RomM haben dieselbe Datei.',
  'saves.localNewer': 'Hier neuer',
  'saves.localNewerHint': 'Seit dem letzten Hochladen gespielt. Spielstände senden schickt ihn.',
  'saves.localOnly': 'Nicht auf RomM',
  'saves.localOnlyHint': 'Nur auf diesem Gerät. Spielstände senden schickt ihn.',
  'saves.remoteNewer': 'Auf RomM neuer',
  'saves.remoteNewerHint': 'RomM hat eine neuere Kopie. Spielstände holen lädt sie herunter.',
  'saves.remoteOnly': 'Nicht auf diesem Gerät',
  'saves.remoteOnlyHint': 'Nur auf RomM. Spielstände holen lädt sie herunter.',
  'saves.scopeLocal': 'von diesem Gerät',
  'saves.scopeRemote': 'von RomM',
  'saves.consequenceLocal': 'Spielstände holen bringt die Kopie von RomM wieder herunter.',
  'saves.consequenceRemote': 'Spielstände senden schickt die Kopie dieses Geräts wieder hoch.',
  'saves.empty': 'Keine Spielstände für dieses Spiel, weder hier noch auf RomM.',
  'saves.emptyPlayIt': 'Spielen Sie es einmal, dann erscheint sein Spielstand hier.',
  'saves.nothingNewer': 'Nichts Neueres auf RomM',
  'saves.noLocalSaves': 'Keine lokalen Spielstände zum Senden',
  'saves.pulled_one': '{count} Datei heruntergeladen',
  'saves.pulled_other': '{count} Dateien heruntergeladen',
  'saves.pushed_one': '{count} Datei an RomM gesendet',
  'saves.pushed_other': '{count} Dateien an RomM gesendet',
  'saves.nothingSent': 'Es wurde nichts gesendet',
  'saves.noAskAgain': 'Spielstände werden künftig ohne Nachfrage gesendet',
  'saves.deleted': '{file} gelöscht {where}',
  // -- was ein bestimmter Emulator nicht abgleichen kann, und was er braucht --
  'saves.retrodeckPcsx2':
    'RetroDECK gibt PCSX2 eine einzige Memory Card für alle PS2-Spiele, deshalb gehört keine Speicherdatei zu diesem einen Spiel. Savestates werden synchronisiert.',
  'saves.retrodeckDuckstation':
    'RetroDECK gibt DuckStation eine einzige Memory Card für alle PS1-Spiele, deshalb gehört keine Speicherdatei zu diesem einen Spiel. Savestates werden synchronisiert.',
  'saves.pcsx2':
    'PCSX2 führt eine einzige Memory Card für alle PS2-Spiele, deshalb gehört keine Speicherdatei zu diesem einen Spiel. Savestates werden synchronisiert.',
  'saves.dolphin':
    'Dolphin führt eine GameCube-Memory-Card pro Region und einen einzigen Wii-NAND für alle Spiele, deshalb gehört keine Speicherdatei zu diesem einen Spiel. Savestates werden synchronisiert.',
  'saves.primehack':
    'PrimeHack führt eine einzige Memory Card für alle Spiele, deshalb gehört keine Speicherdatei zu diesem einen Spiel. Savestates werden synchronisiert.',
  'saves.ppsspp':
    'PPSSPP legt Spielstände unter der im Disc-Image hinterlegten Spiel-ID ab statt unter dem ROM-Namen, und RomMix kann diese von außerhalb des Emulators nicht lesen.',
  'saves.rpcs3':
    'RPCS3 legt Spielstände unter der PS3-Title-ID ab statt unter dem ROM-Namen, die RomMix diesem Spiel nicht zuordnen kann.',
  'saves.cemu':
    'Cemu legt Spielstände unter der Wii-U-Title-ID ab statt unter dem ROM-Namen, die RomMix diesem Spiel nicht zuordnen kann.',
  'saves.vita3k':
    'Vita3K legt Spielstände unter der Vita-Title-ID ab statt unter dem ROM-Namen, die RomMix diesem Spiel nicht zuordnen kann.',
  'saves.xenia':
    'Xenia legt Spielstände unter der Xbox-360-Title-ID ab statt unter dem ROM-Namen, die RomMix diesem Spiel nicht zuordnen kann.',
  'saves.flycast':
    'Flycast führt zwei VMU-Speicherkarten für alle Dreamcast-Spiele, deshalb gehört keine Speicherdatei zu diesem einen Spiel. Savestates werden synchronisiert.',
  'saves.xemu':
    'xemu führt eine einzige emulierte Xbox-Festplatte für alle Spiele, deshalb gehört keine Speicherdatei zu diesem einen Spiel.',
  'saves.xroar':
    'XRoar schreibt keine Batterie-Speicherstände; nur seine Savestates werden synchronisiert.',
  'saves.azahar':
    'Azahar legt Spielstände in einem emulierten SD-Karten-Baum ab, der nach Title-ID sortiert ist und den RomMix diesem Spiel nicht zuordnen kann.',
  'saves.azaharStates':
    'Azahar legt Spielstände in einem emulierten SD-Karten-Baum ab, der nach Title-ID sortiert ist und den RomMix diesem Spiel nicht zuordnen kann. Savestates werden synchronisiert.',
  'saves.shadps4NoData': 'RomMix hat nicht gefunden, wo shadPS4 seine Spielstände ablegt.',
  'saves.shadps4NoSerial':
    'Dieses Spiel nennt keine PS4-Seriennummer, deshalb kann RomMix nicht erkennen, welcher der Spielstandsordner von shadPS4 zu ihm gehört.',
  'setup.edenRoms': 'Den ROM-Ordner von RomMix in Eden eintragen: File → Game Directories.',
  'setup.edenFirmware':
    'Firmware in Eden installieren: Tools → Install Firmware. Die Schlüssel werden für Sie kopiert.',
  'setup.edenControls': 'Den Controller in Eden einrichten: Emulation → Configure → Controls.',
  'setup.edenExitConfirm':
    'Die Beenden-Nachfrage von Eden abschalten: Emulation → Configure → General → Confirm exit ' +
    'while emulation is running.',
  'setup.edenStaging':
    'Firmware in Eden installieren: Tools → Install Firmware, auf die Datei unten zeigen lassen.',
  'setup.shadps4Roms':
    'Den ROM-Ordner von RomMix in shadPS4 eintragen, damit dessen Spieleliste findet, was Sie herunterladen.',

  'saves.switchNoTitleId':
    'RomMix konnte für dieses Spiel keine Title-ID lesen, und genau danach benennt {emulator} ' +
    'seinen Spielstandsordner. Eine ROM, die ihre Title-ID im Dateinamen trägt, oder eine ' +
    'unveränderte NSP oder XCI löst sich von selbst auf.',
  'saves.switchNoProfile':
    '{emulator} hat noch kein Benutzerprofil, ein Spielstand hat also nirgendwo hin. Starten Sie ' +
    'ihn einmal und legen Sie ein Profil an.',

  // -- die Details eines Spiels ---------------------------------------------

  'details.company': 'Firma',
  'details.series': 'Reihe',
  'details.released': 'Erschienen',
  'details.players': 'Spieler',
  'details.modes': 'Modi',
  'details.languages': 'Sprachen',
  'details.tags': 'Schlagwörter',
  'details.lastPlayed': 'Zuletzt gespielt',
  'details.installedTo': 'Installiert in',
  'details.systemFolder': 'Systemordner',
  'details.downloadedFor': 'Heruntergeladen für',
  'details.onDisk': 'Auf der Platte',
  'details.downloaded': 'Heruntergeladen',
  'details.romMixFolder': 'Der eigene Ordner von RomMix',
  'details.empty': 'RomM weiß nichts weiter über dieses Spiel.',

  'files.onServer': 'Auf dem Server',
  'files.onDevice': 'Auf diesem Gerät',
  'files.serverEmpty': 'RomM führt für dieses Spiel keine Dateien.',
  'files.notDownloaded': 'Nicht heruntergeladen.',

  'shots.empty': 'RomM hat keine Screenshots für dieses Spiel.',

  // -- Einstellungen --------------------------------------------------------

  'settings.title': 'Einstellungen',
  'settings.tabGeneral': 'Allgemein',
  'settings.tabGames': 'Spiele',
  'settings.tabSystem': 'System',

  'settings.server': 'Server',
  'settings.address': 'Adresse',
  'settings.signedInAs': 'Angemeldet als',
  'settings.rommVersion': 'RomM-Version',
  'settings.disconnect': 'Verbindung trennen',
  'settings.disconnected': 'Verbindung zu RomM getrennt',
  'settings.interface': 'Oberfläche',
  'settings.scaleHint':
    'Auto richtet sich nach dem Bildschirm: doppelt so groß auf einem 4K-Fernseher.',
  'settings.language': 'Sprache',
  'settings.languageHint': 'Auto folgt der Sprache, auf die dieser Rechner eingestellt ist.',
  'settings.support': 'RomMix unterstützen',
  'settings.supportBody':
    'RomMix ist kostenlos und bleibt es. Wenn es Ihnen einen Nachmittag Emulator-Verkabelung ' +
    'erspart hat, können Sie mir einen Kaffee ausgeben.',
  'settings.buyCoffee': 'Kaffee ausgeben',
  'settings.scanOrOpen':
    'Scannen Sie das mit Ihrem Telefon oder öffnen Sie es in einem Browser auf diesem Rechner.',
  'settings.application': 'Anwendung',
  'settings.toggleFullscreen': 'Vollbild umschalten',

  'settings.gamesOnDisk': 'Spiele auf der Platte',
  'settings.storageToRomMix':
    'Neue Downloads gehen in den RomMix-Ordner — tragen Sie ihn bei jedem Emulator ein',
  'settings.storageToEmulator': 'Neue Downloads gehen in den eigenen Ordner jedes Emulators',
  'settings.sharedFolderNote':
    'Spiele werden nach {path}/roms/<System> geschrieben. Spiele, die bereits in den eigenen ' +
    'Ordner eines Emulators heruntergeladen wurden, bleiben dort und werden erneut zum Download ' +
    'angeboten; schalten Sie zurück, tauchen sie wieder auf.',
  'settings.saveSync': 'Spielstand-Abgleich',
  'settings.syncDown': 'Neuere Spielstände vor dem Spielen herunterladen',
  'settings.syncDownHint':
    'Nur wenn sie echt neuer sind. Die lokale Datei bleibt als *.rommix-bak erhalten.',
  'settings.syncUp': 'Spielstände nach dem Spielen hochladen',
  'settings.syncUpHint': 'Gesendet wird nur, was die Sitzung geschrieben hat.',
  'settings.confirmPush': 'Vor dem Senden von Spielständen an RomM fragen',
  'settings.confirmPushHint': 'Zeigt vor dem Senden, was gesendet wird.',
  'settings.downloads': 'Downloads',
  'settings.confirmUninstall': 'Vor dem Löschen eines heruntergeladenen Spiels fragen',
  'settings.confirmUninstallHint':
    'Deinstallieren ist einen Druck auf A davon entfernt, eine mehrere Gigabyte große Datei zu ' +
    'löschen.',

  'emulators.explainer':
    'Was RomMix auf diesem Rechner gefunden hat und wie viele Plattformen jeder abdeckt. Die ' +
    'Reihenfolge ist die Präferenz: eine Plattform ohne eigene Wahl wird vom ersten Emulator ' +
    'dieser Liste ausgeführt, der installiert ist und sie abdeckt — einen nach oben zu schieben ' +
    'macht ihn also zur Vorgabe für alles, was er kann. Plattformen, die Sie unten einzeln ' +
    'festgelegt haben, bleiben davon unberührt.',
  'emulators.platforms': 'Plattformen',
  'emulators.platformsExplainer':
    'Welcher Emulator jede Plattform Ihrer Bibliothek ausführt. Jede Plattform startet mit einer ' +
    'Vorgabe daraus, was diese Emulatoren üblicherweise übernehmen; ändern Sie eine, verwendet ' +
    'RomMix Ihre Wahl nur für diese Plattform — und sagt es, statt stillschweigend etwas anderes ' +
    'einzusetzen, wenn sie fehlt.',

  // -- ein Emulator ---------------------------------------------------------

  'emulator.notChecked': 'Nicht geprüft',
  'emulator.installed': 'Installiert',
  'emulator.needsSetup': 'Einrichtung nötig',
  'emulator.notInstalled': 'Nicht installiert',
  'emulator.kindFlatpak': 'Flatpak',
  'emulator.kindBinary': 'Programm',
  'emulator.kindAppImage': 'AppImage',
  'emulator.kindScripts': 'Starter',
  'emulator.groupGeneral': 'Allgemein',
  'emulator.groupFolders': 'Ordner',
  'emulator.platforms_one': '{count} Plattform',
  'emulator.platforms_other': '{count} Plattformen',
  'emulator.homepage': 'Website',
  'emulator.home': 'Basis',
  'emulator.roms': 'Roms',
  'emulator.saves': 'Spielstände',
  'emulator.bios': 'Bios',
  'emulator.notFound': 'nicht gefunden',
  'emulator.setByYou': '(von Ihnen gesetzt)',
  'emulator.homeFolder': 'Basisordner',
  'emulator.homeFolderHint':
    'Roms, Spielstände, Savestates und BIOS werden aus diesem Ordner gelesen. Lassen Sie ihn ' +
    'leer, um wieder automatisch zu suchen.',
  'emulator.useThisFolder': 'Diesen Ordner verwenden',
  'emulator.changeVersion': 'Version wechseln',
  'emulator.run': 'Starten',
  'emulator.movedUp': '{name} nach oben verschoben',
  'emulator.movedDown': '{name} nach unten verschoben',
  'emulator.rootSet': '{name} wird aus {path} gelesen',
  'emulator.rootCleared': 'Der Ordner von {name} wird wieder automatisch gefunden',
  'emulator.installedTitle': '{name} ist installiert',
  'emulator.setupTitle': '{name} einrichten',
  'emulator.setupSteps': 'Einrichtungsschritte',
  'emulator.setupIntro':
    'Was übrig bleibt, geschieht in {name} selbst — RomMix kann es von außen weder erledigen noch ' +
    'nachprüfen:',
  'emulator.installedToast': '{name} installiert',
  'emulator.installingFlathub': 'Installation von Flathub',
  'emulator.contactingFlathub': 'Flathub wird kontaktiert…',
  'emulator.installTitle': '{name} installieren',
  'emulator.fromFlathub': '{appId}, von Flathub',
  'emulator.buildIntoRomMix': 'der Build Ihrer Wahl, in den eigenen Ordner von RomMix',
  'emulator.manualInstall': '{name} muss von Hand installiert werden.',
  'emulator.manualInstallFrom': '{name} muss von Hand installiert werden, von {homepage}.',
  'emulator.reasonNotInstalled': '{name} ist nicht installiert.',
  'emulator.reasonNotRun':
    '{name} wurde noch nie gestartet, deshalb existieren seine Ordner nicht.',

  'platforms.connectFirst':
    'Verbinden Sie sich mit RomM, um die Plattformen Ihrer Bibliothek zu sehen.',
  'platforms.noneCovers': 'Kein Emulator deckt das ab',
  'platforms.noneInstalled': 'Keiner installiert',
  'platforms.meta_one': '{system} · {count} Spiel',
  'platforms.meta_other': '{system} · {count} Spiele',
  'platforms.default': '(Vorgabe)',

  // -- einen Build zum Installieren wählen ----------------------------------

  'install.installing': '{name} wird installiert',
  'install.title': '{name} installieren',
  'install.noBuilds': 'Für diesen Rechner wurden keine Builds veröffentlicht.',
  'install.whichVersion': 'Welche Version?',
  'install.publishedAt': 'Veröffentlicht auf {url}.',
  'install.latest': 'Neueste',
  'install.prerelease': 'Vorabversion',
  'install.noDate': 'kein Veröffentlichungsdatum',
  'install.builds_one': '{count} Build für diesen Rechner',
  'install.builds_other': '{count} Builds für diesen Rechner',
  'install.chooseVersion': 'Diese Version wählen',
  'install.chooseBuild': 'Diesen Build installieren',
  'install.whichBuild':
    'Welcher Build? Nehmen Sie den, der zu Ihrer Hardware passt — im Zweifel ist der schlichteste ' +
    'Name der für den allgemeinen Gebrauch.',
  'install.otherVersions': 'Andere Versionen',

  // -- RomMix' eigene Updates -----------------------------------------------

  'update.label': 'Neue Versionen von RomMix',
  'update.policyAuto': 'Automatisch',
  'update.policyNotify': 'Bescheid geben',
  'update.policyOff': 'Aus',
  'update.hintAuto':
    'Neue Versionen werden im Hintergrund heruntergeladen und beim nächsten Start von RomMix ' +
    'verwendet.',
  'update.hintNotify':
    'RomMix meldet, wenn eine neue Version erscheint, und wartet darauf, dass Sie sie holen.',
  'update.hintOff': 'RomMix sieht nie von selbst nach. Die Schaltfläche unten schon.',
  'update.installed': 'Installiert',
  'update.newestPublished': 'Neueste veröffentlichte',
  'update.checking': 'wird geprüft…',
  'update.notCheckedYet': 'noch nicht geprüft',
  'update.lastChecked': 'Zuletzt geprüft',
  'update.available': 'RomMix {version} ist verfügbar.',
  'update.availableBlocked': 'Laden Sie es von der Releases-Seite herunter.',
  'update.availableAuto': 'Es wird gerade geholt.',
  'update.availableManual':
    'Holen Sie es, wann es Ihnen passt — bis dahin wird nichts heruntergeladen.',
  'update.downloadingLine': 'RomMix {version} wird heruntergeladen: {size}',
  'update.ready': 'RomMix {version} ist bereit.',
  'update.readyDefault':
    'Es läuft beim nächsten Start von RomMix, oder sofort, wenn Sie neu starten.',
  'update.upToDate': 'RomMix ist aktuell.',
  'update.checkNow': 'Jetzt prüfen',
  'update.downloadVersion': '{version} herunterladen',
  'update.downloadAction': 'Die neue Version herunterladen',
  'update.restartNow': 'Jetzt neu starten',
  'update.releasesPage': 'Releases-Seite',
  'update.newest': 'RomMix {version} ist die neueste Version',
  'update.steamBlocked':
    'Steam hat RomMix gestartet und lässt ein Programm sich nicht selbst neu starten. Beenden Sie ' +
    'RomMix und drücken Sie erneut auf Spielen — die neue Version liegt bereits an ihrem Platz.',
  'update.noBuildForMachine': 'Release {version} hat keinen Build für diesen Rechner ({arch}).',
  'update.noVersionTag': 'Das neueste Release hat kein Versions-Tag',
  'update.nothingToDownload': 'Es gibt keine neue Version zum Herunterladen',
  'update.nothingToRestartInto':
    'Es gibt keine heruntergeladene Version, in die neu gestartet werden könnte',
  'update.devBuild': 'Dies ist ein Entwicklungs-Build, RomMix ersetzt ihn nicht.',
  'update.notAppImage':
    'RomMix wurde nicht aus einem AppImage gestartet und kann sich deshalb nicht selbst ersetzen. ' +
    'Laden Sie die neue Version von der Releases-Seite herunter.',
  'update.cannotWrite':
    'RomMix kann nicht nach {dir} schreiben und sich dort deshalb nicht selbst ersetzen. ' +
    'Verschieben Sie das AppImage an einen Ort, der Ihnen gehört, oder laden Sie die neue Version ' +
    'von der Releases-Seite herunter.',
  'update.noRoom': 'Auf {dir} ist nicht genug Platz für die neue Version.',
  'update.githubResponded': 'GitHub antwortete {status}',
  'update.downloadFailed': 'Download fehlgeschlagen: {url} antwortete {status}',

  // -- die Installation selbst ----------------------------------------------

  'system.updates': 'Updates',
  'system.romMixFolder': 'RomMix-Ordner',
  'system.folderExplainer':
    'Einstellungen, Zugangsdaten, der Download-Index und jeder von RomMix installierte Emulator. ' +
    'Verschieben Sie diesen Ordner, um die ganze Installation zu verschieben.',
  'system.folder': 'Ordner',
  'system.folderHintEnv': 'Durch ROMMIX_HOME gesetzt, was Vorrang vor allem hier Gewählten hat.',
  'system.folderHint':
    'Die Einstellungen werden in den neuen Ordner kopiert; Emulatoren und ROMs bleiben, wo sie ' +
    'sind.',
  'system.moveAndRestart': 'Verschieben und neu starten',
  'system.folderMoved': 'RomMix-Ordner verschoben — Neustart',
  'system.preflight': 'Startklar-Prüfung',
  'system.flatpakAvailable': 'Flatpak vorhanden',
  'system.flathubSetUp': 'Flathub eingerichtet',
  'system.flathubOnFirstInstall': 'nein — wird bei der ersten Installation hinzugefügt',
  'system.emulatorsInstalled': 'Emulatoren installiert',
  'system.countOf': '{count} von {total}',
  'system.romsWritable': 'ROM-Ordner beschreibbar',
  'system.controller': 'Controller',
  'system.noController': 'keiner gesehen — drücken Sie eine seiner Tasten',
  'system.logFile': 'Protokolldatei',
  'system.allReady': 'Alles sieht spielbereit aus.',
  'system.rerunCheck': 'Prüfung wiederholen',
  'system.checkedReady': 'Geprüft — alles sieht spielbereit aus',
  'system.checkedProblems_one': 'Geprüft — {count} Sache zu erledigen',
  'system.checkedProblems_other': 'Geprüft — {count} Sachen zu erledigen',

  'change.title': 'Den Emulator wechseln, der das ausführt?',
  'change.body':
    'Jeder Emulator führt seine eigenen Dateien, und beim Wechsel geht nichts davon mit:',
  'change.bios': 'BIOS-Dateien müssen für den neuen Emulator erneut installiert werden.',
  'change.gamesShared':
    'Die Spiele bleiben, wo sie sind — sie liegen im eigenen Ordner von RomMix, auf den Sie jeden ' +
    'Emulator zeigen.',
  'change.gamesPerEmulator':
    'Heruntergeladene Spiele bleiben im Ordner des alten Emulators und müssen erneut ' +
    'heruntergeladen werden.',
  'change.saves':
    'Die Spielstände liegen im Baum des alten Emulators. Holen Sie sie nach dem Wechsel von RomM.',
  'change.confirm': 'Wechseln',
  'change.confirmNoAsk': 'Wechseln und nicht mehr fragen',

  // -- was die Startklar-Prüfung meldet -------------------------------------

  'diagnostics.noFlatpak':
    'flatpak ist nicht installiert, deshalb kann RomMix die so verteilten Emulatoren weder finden ' +
    'noch installieren. Installieren Sie es aus Ihrer Distribution und wiederholen Sie diese ' +
    'Prüfung.',
  'diagnostics.noFlathub':
    'Flathub ist für Ihren Benutzer nicht eingerichtet, es gibt also noch keine Quelle für die ' +
    'flatpak-Emulatoren. RomMix fügt sie hinzu, sobald Sie den ersten installieren, oder Sie ' +
    'fügen sie selbst hinzu mit: flatpak remote-add --user --if-not-exists flathub ' +
    'https://dl.flathub.org/repo/flathub.flatpakrepo',
  'diagnostics.noEmulatorSuggest':
    'Kein Emulator gefunden. Installieren Sie {name}, der die meisten Systeme abdeckt, im ' +
    'Abschnitt Emulatoren oben.',
  'diagnostics.noEmulator':
    'Kein Emulator gefunden. Installieren Sie einen im Abschnitt Emulatoren oben.',
  'diagnostics.romsNotWritable':
    'Der ROM-Ordner von {name}, {path}, ist nicht beschreibbar. Prüfen Sie seine Rechte oder ob ' +
    'das Laufwerk, auf dem er liegt, eingehängt ist.',
  'diagnostics.sharedFolder':
    'Spiele werden nach {path} heruntergeladen. Fügen Sie diesen Ordner den Spieleverzeichnissen ' +
    'jedes Emulators hinzu, sonst listen sie nicht, was RomMix heruntergeladen hat.',

  // -- Fehler, die der Hauptprozess meldet ----------------------------------

  'error.serverAddressEmpty': 'Die Serveradresse ist leer',
  'error.noServerConfigured': 'Kein RomM-Server eingerichtet',
  'error.cannotReach': '{url} ist nicht erreichbar: {reason}',
  'error.notAuthorised': 'Nicht berechtigt — melden Sie sich erneut an',
  'error.permissionDenied': 'Zugriff verweigert: {detail}',
  'error.rommReturned': 'RomM antwortete {status}: {detail}',
  'error.wrongCredentials': 'Falscher Benutzername oder falsches Passwort',
  'error.sessionExpired': 'Sitzung abgelaufen — melden Sie sich erneut an',
  'error.emptyResponseBody': 'RomM hat einen leeren Antwortkörper geliefert',
  'error.emptyAssetBody': 'Leerer Dateiinhalt',
  'error.credentialsRequired': 'Benutzername und Passwort sind erforderlich',
  'error.tokenRequired': 'Ein API-Token ist erforderlich',
  'error.couldNotSignIn': 'Anmeldung nicht möglich',

  'error.notDownloadedForEmulator':
    'Diese ROM ist nicht für den Emulator heruntergeladen, den diese Plattform verwendet',
  'error.notDownloadedYet': 'Diese ROM ist noch nicht heruntergeladen',
  'error.downloadedForOther':
    'Diese Kopie wurde für einen anderen Emulator heruntergeladen. Laden Sie sie erneut für den ' +
    'herunter, den diese Plattform jetzt verwendet.',
  'error.noEmulatorForSystem': 'Kein installierter Emulator kann „{system}“ ausführen.',
  'error.noEmulatorInstallOne':
    'Kein installierter Emulator kann „{system}“ ausführen. Installieren Sie {name} und ' +
    'versuchen Sie es erneut.',
  'error.noFolderMapping':
    'RomMix weiß nicht, welchem Ordner „{platform}“ entspricht. Legen Sie eine Zuordnung für ' +
    '„{slug}“ in settings.systemOverrides an.',
  'error.noRomFolder': 'RomMix weiß nicht, wo {name} seine Spiele ablegt',

  'error.unknownEmulator': 'RomMix kennt keinen Emulator namens {id}',
  'error.emulatorNotInstalled': '{name} ist nicht installiert',
  'error.cannotInstall': 'RomMix kann {name} nicht für Sie installieren',
  'error.assetNotRunnable': '{asset} ist nichts, was RomMix ausführen kann',
  'error.assetWrongArch': '{asset} ist nicht für diesen Rechner gebaut ({arch})',
  'error.notAFlatpak': '{name} wird nicht als Flatpak verteilt',

  'error.rootMustBeAbsolute': 'Der RomMix-Ordner muss ein absoluter Pfad sein',
  'error.romMixHomeSet':
    'ROMMIX_HOME ist gesetzt und hat Vorrang vor dem hier gewählten Ordner. Entfernen Sie es und ' +
    'starten Sie RomMix neu, um den Ordner aus den Einstellungen heraus zu verschieben.',
  'error.onlyWebAddresses': 'RomMix öffnet nur Webadressen',

  'error.biosListFailed': 'Die BIOS-Dateien auf dem Server sind nicht lesbar: {reason}',
  'error.biosGone': 'Diese BIOS-Datei liegt nicht mehr auf dem Server',
  'error.biosNowhere': 'RomMix hat keinen Ort für diese BIOS-Datei',

  'error.assetGone': '{file} ist nicht mehr da, um gelöscht zu werden',
  'error.assetNotLocal': '{file} liegt nicht auf diesem Gerät, um gelöscht zu werden',
  'error.assetNotRemote': '{file} liegt nicht auf RomM, um gelöscht zu werden',

  'error.cannotOpenArchive': 'Archiv lässt sich nicht öffnen',
  'error.badZipEntry': 'Ungültiger Zip-Eintrag',
  'error.releasesResponded': '{api} antwortete {status}',
  'error.assetDownloadFailed': 'Download fehlgeschlagen: {url} antwortete {status}',
  'error.noAppImageInArchive': '{archive} enthält kein AppImage',

  // -- ein Spiel starten ----------------------------------------------------

  'launch.installingCore': 'Der Core {core} wird installiert…',
  'launch.installingCorePercent': 'Der Core {core} wird installiert… {percent} %',
  'launch.alreadyRunning': 'Es läuft bereits ein Spiel',
  'launch.cannotRunSystem':
    '{emulator} kann „{system}“ nicht ausführen. Wählen Sie in den Einstellungen einen anderen ' +
    'Emulator für diese Plattform oder installieren Sie einen, der sie abdeckt.',
  'launch.stoppedBeforeStart': 'Vor dem Start des Spiels abgebrochen',
  'launch.syncWarning': 'Warnung beim Spielstand-Abgleich: {details}',
  'launch.couldNotStartEmulator': 'Der Emulator ließ sich nicht starten: {reason}',
  'launch.couldNotStartNamed': '{name} ließ sich nicht starten: {reason}',
  'launch.emulatorReported': 'Der Emulator meldete: {detail}',
  'launch.quitImmediatelyDetail': 'Der Emulator beendete sich sofort: {detail}',
  'launch.quitImmediately': 'Der Emulator beendete sich sofort.',
  'launch.quitImmediatelyCode': 'Der Emulator beendete sich sofort (Code {code}).',
  'launch.emulatorQuitDetail': '{name} beendete sich sofort: {detail}',
  'launch.emulatorQuitCode': '{name} beendete sich sofort (Code {code}).',

  'core.noneForMachine':
    'Für diesen Rechner ist kein {core}-Core veröffentlicht. Installieren Sie ihn über den ' +
    'Online Updater des Emulators.',
  'core.downloadFailed': 'Der Core {core} ließ sich nicht herunterladen: {url} antwortete {status}',
  'core.missingFile': 'Der Download von {core} enthielt {file} nicht',

  'host.addingFlathub': 'Die Flathub-Quelle wird hinzugefügt…',
  'host.flathubFailed':
    'Die Flathub-Quelle ließ sich nicht hinzufügen. Fügen Sie sie von Hand hinzu mit:  flatpak ' +
    'remote-add --user --if-not-exists {remote} {repo}',
  'host.suspiciousAppId': 'Installation einer verdächtigen App-ID verweigert: {appId}',
  'host.flatpakFailed': 'flatpak ließ sich nicht ausführen: {reason}'
}
