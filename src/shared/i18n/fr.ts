import type { Catalog } from './catalog.ts'

/**
 * RomMix en français.
 *
 * Déclaré comme `Catalog`, donc toute entrée ajoutée à `en.ts` et oubliée ici
 * échoue à la compilation plutôt que de ressortir en anglais à l'écran.
 *
 * Les noms propres ne sont pas traduits — RomM, RomMix, Flatpak, Flathub,
 * AppImage, BIOS — ni les libellés que l'utilisateur va chercher dans un autre
 * logiciel : « Tools → Install Firmware » est écrit sur un menu qui, lui, reste
 * en anglais.
 */
export const fr: Catalog = {
  // -- mots partagés --------------------------------------------------------

  'action.back': 'Retour',
  'action.cancel': 'Annuler',
  'action.close': 'Fermer',
  'action.keep': 'Le garder',
  'action.next': 'Suivant',
  'action.select': 'Choisir',
  'action.open': 'Ouvrir',
  'action.search': 'Rechercher',
  'action.navigate': 'Naviguer',
  'action.menu': 'Menu',
  'action.type': 'Saisir',
  'action.install': 'Installer',
  'action.installAll': 'Tout installer',
  'action.reinstall': 'Réinstaller',
  'action.uninstall': 'Désinstaller',
  'action.download': 'Télécharger',
  'action.tryAgain': 'Réessayer',
  'action.trying': 'Nouvel essai…',
  'action.checking': 'Vérification…',
  'action.installing': 'Installation…',
  'action.starting': 'Démarrage…',
  'action.expand': 'Déplier',
  'action.collapse': 'Replier',
  'action.moveUp': 'Monter',
  'action.moveDown': 'Descendre',
  'action.previousTab': 'Onglet précédent',
  'action.nextTab': 'Onglet suivant',
  'action.rowActions': 'Actions de la ligne',
  'action.openInBrowser': 'Ouvrir dans un navigateur',

  'value.on': 'Activé',
  'value.off': 'Désactivé',
  'value.yes': 'oui',
  'value.no': 'non',
  'value.yesTitle': 'Oui',
  'value.noTitle': 'Non',
  'value.auto': 'Auto',
  'value.none': 'Aucun',
  'value.unknown': 'inconnue',
  'value.never': 'jamais',
  'value.notConfigured': 'Non configurée',

  'key.enter': 'Entrée',
  'key.esc': 'Échap',

  // -- l'ossature de l'application ------------------------------------------

  'nav.home': 'Accueil',
  'nav.library': 'Bibliothèque',
  'nav.collections': 'Collections',
  'nav.downloads': 'Téléchargements',
  'nav.emulators': 'Émulateurs',
  'nav.bios': 'BIOS',
  'nav.settings': 'Réglages',

  'app.notConnected': 'Non connecté',
  'app.loading': 'Chargement',
  'app.qrCode': 'QR code',
  'app.credit': 'Développé avec {heart} par leclercb',
  'app.quitTitle': 'Quitter RomMix ?',
  'app.stay': 'Rester',
  'app.quit': 'Quitter',
  'app.quitRomMix': 'Quitter RomMix',
  'app.gettingReady': 'Préparation',
  'app.gameRunning': 'Jeu en cours',
  'app.emulatorHasFocusAsk':
    "L'émulateur a la main. Quittez-le pour revenir — RomMix demandera quoi envoyer à RomM.",
  'app.emulatorHasFocusAuto':
    "L'émulateur a la main. Quittez-le pour revenir — les sauvegardes se synchronisent " +
    'automatiquement avec RomM.',
  'app.emulatorRunning': '{name} est en cours',
  'app.emulatorOpened':
    '{name} a la main. Quittez-le pour revenir — aucune partie n’est en cours, il n’y a donc rien ' +
    'à synchroniser.',
  'app.holdToClose': 'Maintenez {key} pour le fermer d’ici.',
  'app.closeEmulator': "Fermer l'émulateur",
  'app.notClosing':
    'Il ne s’est pas fermé. Le forcer fait perdre tout ce qu’il n’a pas enregistré.',
  'app.holdToForce': 'Maintenez de nouveau {key} pour le forcer.',
  'app.forceClose': 'Forcer la fermeture',
  'app.askingEmulatorToQuit': "Demande à l'émulateur de quitter…",

  // -- notifications de l'ossature ------------------------------------------

  'toast.updateAvailable': 'RomMix {version} est disponible',
  'toast.updateAvailableSettings': 'RomMix {version} est disponible — voir les Réglages',
  'toast.updateReadyRestart': 'RomMix {version} est prêt — redémarrez pour l’utiliser',
  'toast.updateReadyQuit': 'RomMix {version} est prêt — quittez puis relancez',
  'toast.downloadComplete': 'Téléchargement terminé',
  'toast.downloadCancelled': 'Téléchargement annulé',
  'toast.adoptedOne': 'Déjà sur le disque — ajouté à votre bibliothèque',
  'toast.adoptedMany_one': '{count} jeu était déjà sur le disque — ajouté à votre bibliothèque',
  'toast.adoptedMany_other':
    '{count} jeux étaient déjà sur le disque — ajoutés à votre bibliothèque',

  // -- la démo publiée ------------------------------------------------------

  'demo.notAvailable': 'Indisponible dans l’aperçu web',
  'demo.noEmulator': 'Il n’y a aucun émulateur dans l’aperçu web',
  'demo.noFirmware': 'Firmware introuvable',
  'demo.nothingToReplace': 'Ceci est l’aperçu web : il n’y a rien à remplacer ici.',
  'demo.nothingChecked': 'Ceci est l’aperçu web : rien n’a réellement été vérifié.',
  'demo.connectionClosed': 'Le serveur a fermé la connexion avant la fin du fichier.',
  'demo.variantFaster': 'plus rapide, moins fidèle',
  'demo.variantDefault': 'le choix de RomMix',
  'demo.title': 'RomMix — démo',
  'demo.description':
    'L’interface de RomMix, sur la bibliothèque homebrew de la démo publique de RomM. Aucun ' +
    'serveur ni émulateur n’est en jeu, et rien n’est téléchargé.',

  // -- première configuration -----------------------------------------------

  'setup.stepOf': 'Étape {step} sur {total}',
  'setup.scaleTitle': 'Quelle taille pour RomMix ?',
  'setup.scaleSubtitle':
    'Auto suit l’écran — deux fois plus grand sur un téléviseur 4K. Choisissez une taille lisible ' +
    'depuis là où vous êtes assis ; vous pourrez la changer plus tard dans les Réglages.',
  'setup.scaleHint': 'Toute l’interface, pas seulement le texte.',
  'setup.storageTitle': 'Où placer les jeux téléchargés ?',
  'setup.storageSubtitle':
    'Cela décide où atterrit chaque ROM : il est bien plus simple de répondre maintenant qu’une ' +
    'fois des jeux installés ailleurs.',

  // -- réglages partagés avec l'assistant -----------------------------------

  'control.scale': 'Échelle',
  'storage.label': 'Où vont les jeux téléchargés',
  'storage.hintShared':
    'Un seul dossier pour tout, qu’il faut indiquer une fois à chaque émulateur. Changer ' +
    'd’émulateur ne déplace rien, et un jeu peut être téléchargé avant même que ce qui le lance ' +
    'soit installé.',
  'storage.hintPerEmulator':
    'Le dossier de ROM propre à chaque émulateur, pour que les jeux apparaissent dans sa liste ' +
    'quand vous le lancez vous-même. Changer d’émulateur pour une plateforme oblige à ' +
    'retélécharger ses jeux.',
  'storage.toEmulatorTitle': 'Garder les jeux dans le dossier de chaque émulateur ?',
  'storage.toEmulatorBody':
    'Les téléchargements iront dans le dossier de ROM de l’émulateur qui fait tourner leur ' +
    'plateforme. C’est ce qui les place dans sa propre liste de jeux quand vous le lancez ' +
    'vous-même, et c’est ce qui les lui attache :',
  'storage.toEmulatorChange':
    'Changer d’émulateur pour une plateforme laisse ses jeux dans le dossier de l’ancien. RomMix ' +
    'cesse de les compter comme téléchargés et les propose de nouveau.',
  'storage.toEmulatorMissing':
    'Un jeu ne peut pas être téléchargé pour une plateforme dont aucun émulateur n’est encore ' +
    'installé.',
  'storage.toEmulatorExisting':
    'Les jeux déjà dans le dossier RomMix y restent et sont proposés de nouveau ; revenez en ' +
    'arrière et ils réapparaissent.',
  'storage.toEmulatorKeep': 'Garder un seul dossier',
  'storage.toEmulatorConfirm': 'Utiliser le dossier de chaque émulateur',
  'storage.toSharedTitle': 'Garder tous les jeux dans un seul dossier ?',
  'storage.toSharedBody':
    'Les téléchargements iront dans le dossier de ROM propre à RomMix, qu’aucun émulateur ne lit ' +
    'tant qu’on ne le lui a pas indiqué :',
  'storage.toSharedSetup':
    'Ajoutez ce dossier aux répertoires de jeux de chaque émulateur, sinon ils ne listeront pas ce ' +
    'que RomMix a téléchargé. La vérification préalable donne le chemin du dossier.',
  'storage.toSharedFree':
    'Changer d’émulateur pour une plateforme ne déplacera alors rien et n’obligera à rien ' +
    'retélécharger, et un jeu peut être téléchargé avant même que ce qui le lance soit installé.',
  'storage.toSharedExisting':
    'Les jeux déjà dans le dossier d’un émulateur y restent et sont proposés de nouveau ; revenez ' +
    'en arrière et ils réapparaissent.',
  'storage.toSharedKeep': 'Garder le dossier de chaque émulateur',
  'storage.toSharedConfirm': 'Utiliser un seul dossier',
  'storage.optionEmulator': 'Dossier de chaque émulateur',
  'storage.optionRomMix': 'Dossier RomMix',

  // -- connexion ------------------------------------------------------------

  'connect.title': 'Se connecter à RomM',
  'connect.subtitle':
    'Indiquez à RomMix votre serveur RomM pour parcourir et télécharger votre bibliothèque.',
  'connect.serverAddress': 'Adresse du serveur',
  'connect.serverAddressHint': 'La même adresse que pour l’interface web de RomM.',
  'connect.howSignIn': 'Comment souhaitez-vous vous connecter ?',
  'connect.modeDevice': 'Appairer cet appareil',
  'connect.modeToken': 'Jeton API',
  'connect.modePassword': 'Identifiant et mot de passe',
  'connect.deviceExplainer':
    'RomMix affiche un code court que vous approuvez depuis RomM dans n’importe quel navigateur — ' +
    'aucun mot de passe à taper depuis le canapé.',
  'connect.tokenHint': 'Créez-en un dans RomM sous Administration → Client tokens.',
  'connect.username': 'Identifiant',
  'connect.password': 'Mot de passe',
  'connect.contacting': 'Contact du serveur…',
  'connect.startPairing': 'Lancer l’appairage',
  'connect.connecting': 'Connexion…',
  'connect.connect': 'Se connecter',
  'connect.connectedAs': 'Connecté à RomM en tant que {user}',
  'connect.someone': 'utilisateur',
  'connect.pairTitle': 'Approuver cet appareil',
  'connect.pairExplainer':
    'Scannez ceci avec votre téléphone, ou ouvrez l’adresse ci-dessous sur n’importe quel ' +
    'appareil, puis saisissez le code pour laisser RomMix entrer dans votre bibliothèque.',
  'connect.pairOpen': 'Ouvrir dans un navigateur',
  'connect.pairExpiresIn': 'Le code expire dans',
  'connect.pairTimeLeft': '{minutes} min {seconds} s',
  'connect.pairExpired': 'Le code d’appairage a expiré. Réessayez.',

  // -- accueil --------------------------------------------------------------

  'home.title': 'Accueil',
  'home.continuePlaying': 'Reprendre une partie',
  'home.readyToPlay': 'Prêts à jouer',
  'home.favourites': 'Favoris',
  'home.recentlyAdded': 'Ajoutés récemment',
  'home.empty':
    'Votre bibliothèque RomM a l’air vide. Ajoutez des ROM sur le serveur et lancez une analyse.',
  'home.pressToOpen': 'Appuyez sur {key} pour ouvrir',

  // -- bibliothèque ---------------------------------------------------------

  'library.title': 'Bibliothèque',
  'library.browseAll': 'Parcourez tout ce que contient votre serveur RomM',
  'library.count_one': '{count} jeu',
  'library.count_other': '{count} jeux',
  'library.countOnPlatform_one': '{count} jeu sur {platform}',
  'library.countOnPlatform_other': '{count} jeux sur {platform}',
  'library.searchPlaceholder': 'Titre du jeu…',
  'library.searchHint': 'Appuyez sur {key} pour venir ici, Échap pour quitter le champ.',
  'library.allPlatforms': 'Toutes les plateformes',
  'library.scopeLabel': 'Afficher :',
  'library.searchLabel': 'Rechercher :',
  'library.platformLabel': 'Plateforme :',
  'library.scopeAll': 'Tous les jeux',
  'library.scopeDownloaded': 'Téléchargés uniquement',
  'library.noneDownloaded': 'Aucun jeu téléchargé pour l’instant.',
  'library.platformChip': '{name} ({count})',
  'library.noMatches': 'Aucun jeu ne correspond à cette recherche.',
  'library.thatIsAll_one': 'C’est tout : {count} en tout.',
  'library.thatIsAll_other': 'C’est tout : {count} en tout.',
  'library.downloadedMark': 'Téléchargé',

  // -- les étagères de l'utilisateur sur RomM --------------------------------

  'collections.mine': 'Collections',
  'collections.derived': 'Collections virtuelles',
  'collections.count_one': '{count} collection',
  'collections.count_other': '{count} collections',
  'collections.openExpand': 'Ouvrir · Déplier',
  'collections.subtitle':
    'Les collections que vous avez faites sur RomM, et celles que RomM construit lui-même.',
  'collections.empty': 'Aucune collection sur votre serveur RomM pour l’instant.',
  'collections.emptyShelf': 'Rien dans cette collection.',
  'collections.button': 'Collections',
  'collections.dialogTitle': 'Dans quelles collections ?',
  'collections.none':
    'Vous n’avez encore aucune collection sur RomM. Créez-en une là-bas et elle apparaîtra ici.',
  'collections.on': 'Dedans',
  'collections.off': 'Ajouter',
  'collections.add': 'Ajouter à cette collection',
  'collections.remove': 'Retirer de cette collection',

  // -- téléchargements ------------------------------------------------------

  'downloads.title': 'Téléchargements',
  'downloads.onDisk_one': '{count} jeu sur le disque · {size}',
  'downloads.onDisk_other': '{count} jeux sur le disque · {size}',
  'downloads.state.queued': 'En attente',
  'downloads.state.downloading': 'Téléchargement',
  'downloads.state.extracting': 'Extraction',
  'downloads.state.done': 'Installé',
  'downloads.state.error': 'Échec',
  'downloads.state.cancelled': 'Annulé',
  'downloads.sort.recent': 'Ajoutés récemment',
  'downloads.sort.largest': 'Les plus gros d’abord',
  'downloads.sort.name': 'Nom',
  'downloads.tabActivity': 'Activité',
  'downloads.tabDevice': 'Sur cet appareil',
  'downloads.checkingTitle': 'Vérification de votre bibliothèque',
  'downloads.checkedOf': '{checked} jeux vérifiés sur {total}',
  'downloads.askingRomM': 'RomMix demande à RomM ce que vous avez…',
  'downloads.checkExplainer':
    'Chaque jeu du serveur est comparé au dossier dans lequel il serait installé.',
  'downloads.nothingTransferring': 'Aucun transfert. Choisissez un jeu et appuyez sur Télécharger.',
  'downloads.inProgress': 'En cours',
  'downloads.recent': 'Récents',
  'downloads.clearFinished': 'Effacer les terminés',
  'downloads.cleared_one': '{count} transfert terminé effacé',
  'downloads.cleared_other': '{count} transferts terminés effacés',
  'downloads.sortBy': 'Tri : {mode}',
  'downloads.groupBySystem': 'Grouper par système : {value}',
  'downloads.syncWithDisk': 'Comparer au disque',
  'downloads.nothingDownloaded':
    'Rien de téléchargé pour l’instant. Choisissez un jeu et appuyez sur Télécharger.',
  'downloads.showMore': 'Afficher {count} de plus sur {total}',
  'downloads.openExpand': 'Ouvrir · Déplier',
  'downloads.groupMeta_one': '{count} jeu · {size}',
  'downloads.groupMeta_other': '{count} jeux · {size}',
  'downloads.fileCount_one': '{count} fichier',
  'downloads.fileCount_other': '{count} fichiers',
  'downloads.syncFound_one': '{count} trouvé sur le disque',
  'downloads.syncFound_other': '{count} trouvés sur le disque',
  'downloads.syncRemoved_one': '{count} qui n’est plus là',
  'downloads.syncRemoved_other': '{count} qui ne sont plus là',
  'downloads.syncUnchanged_one': '{count} jeu vérifié — rien n’a changé',
  'downloads.syncUnchanged_other': '{count} jeux vérifiés — rien n’a changé',
  'downloads.uninstalled': 'Désinstallé',

  'uninstall.title': 'Désinstaller ce jeu ?',
  'uninstall.body': '{file} sera supprimé de {folder}. Vos sauvegardes sur RomM sont conservées.',
  'uninstall.freeing': 'Désinstaller et libérer {size}',

  // -- BIOS -----------------------------------------------------------------

  'bios.title': 'BIOS',
  'bios.allInPlace': 'Tous les fichiers BIOS connus de RomMix sont en place.',
  'bios.missingSummary_one': '{count} fichier manquant, {fetchable} sur votre serveur RomM',
  'bios.missingSummary_other': '{count} fichiers manquants, {fetchable} sur votre serveur RomM',
  'bios.explainer':
    'Les fichiers BIOS viennent de votre propre serveur RomM — déposez-les là-bas sous une ' +
    'plateforme, et RomMix les copie dans l’émulateur qui fait tourner cette plateforme. Rien ' +
    'n’est téléchargé d’ailleurs.',
  'bios.nothingToInstall': 'Rien à installer',
  'bios.recheck': 'Revérifier',
  'bios.noPlatforms': 'Aucune plateforme sur votre serveur RomM pour l’instant.',
  'bios.installingTitle': 'Installation des fichiers BIOS',
  'bios.workingOut': 'Recherche de ce qui manque…',
  'bios.progress': '{done} sur {total}',
  'bios.checkedAllInPlace': 'Vérifié — tous les fichiers BIOS sont en place',
  'bios.checkedMissing_one': 'Vérifié — {count} fichier manque toujours',
  'bios.checkedMissing_other': 'Vérifié — {count} fichiers manquent toujours',
  'bios.fileInstalled': '{file} installé',
  'bios.syncInstalled_one': '{count} installé',
  'bios.syncInstalled_other': '{count} installés',
  'bios.syncFailed_one': '{count} en échec',
  'bios.syncFailed_other': '{count} en échec',
  'bios.syncUnavailable_one': '{count} absent du serveur',
  'bios.syncUnavailable_other': '{count} absents du serveur',
  'bios.statusUnknown': 'Inconnu',
  'bios.statusMissing_one': '{count} manquant',
  'bios.statusMissing_other': '{count} manquants',
  'bios.statusReady': 'Prêt',
  'bios.itemInstalled': 'Installé',
  'bios.itemRequired': 'Requis',
  'bios.itemOptional': 'Facultatif',
  'bios.itemVerified': 'Vérifié',
  'bios.uploadedForPlatform': 'Déposé sur RomM pour cette plateforme',
  'bios.notOnServer': 'Absent de votre serveur',

  // Ce qu'est chaque fichier BIOS, sur la ligne sous son nom.

  'bios.note.scph5500': 'BIOS PlayStation — Japon',
  'bios.note.scph5501': 'BIOS PlayStation — Amérique du Nord',
  'bios.note.scph5502': 'BIOS PlayStation — Europe',
  'bios.note.sega101': 'BIOS Saturn — Japon',
  'bios.note.mpr17933': 'BIOS Saturn — Amérique du Nord et Europe',
  'bios.note.segaCdU': 'BIOS Sega CD — Amérique du Nord',
  'bios.note.segaCdE': 'BIOS Mega-CD — Europe',
  'bios.note.segaCdJ': 'BIOS Mega-CD — Japon',
  'bios.note.dcBoot': 'ROM de démarrage Dreamcast',
  'bios.note.dcFlash': 'Flash Dreamcast, contient l’horloge et la région',
  'bios.note.syscard3': 'PC Engine CD System Card 3',
  'bios.note.neogeo': 'Jeu de BIOS Neo Geo',
  'bios.note.neocd': 'BIOS Neo Geo CD — modèle à chargement par le dessus',
  'bios.note.disksys': 'BIOS Famicom Disk System',
  'bios.note.gbaBios': 'BIOS Game Boy Advance — améliore la précision',
  'bios.note.ndsBios7': 'BIOS ARM7 Nintendo DS',
  'bios.note.ndsBios9': 'BIOS ARM9 Nintendo DS',
  'bios.note.ndsFirmware': 'Firmware Nintendo DS',
  'bios.note.prodKeys': 'Clés maîtresses de la console — rien ne se déchiffre sans elles',
  'bios.note.titleKeys': 'Clés par titre, pour les jeux installés, les mises à jour et les DLC',
  'bios.note.panafz10': 'BIOS 3DO — Panasonic FZ-10',
  'bios.note.lynxboot': 'ROM de démarrage Atari Lynx',
  'bios.note.atari5200': 'BIOS Atari 5200',
  'bios.note.atari7800': 'BIOS Atari 7800 — Amérique du Nord',
  'bios.note.colecovision': 'BIOS ColecoVision',
  'bios.note.pcfx': 'BIOS PC-FX',
  'bios.note.x68000Ipl': 'ROM IPL X68000',
  'bios.note.x68000Cgrom': 'ROM du générateur de caractères X68000',
  'bios.note.kickstart13': 'Kickstart 1.3 — Amiga 500',
  'bios.note.kickstart31A1200': 'Kickstart 3.1 — Amiga 1200',
  'bios.note.kickstart31Cd32': 'Kickstart 3.1 — CD32',

  // Les systèmes dont le BIOS ne se résume pas à un fichier à copier.

  'bios.setup.ps2':
    'La PlayStation 2 a besoin d’un BIOS extrait d’une vraie console. Le nom de fichier varie ' +
    'selon le modèle : tout ce qui est déposé sur RomM pour cette plateforme est installé tel quel.',
  'bios.setup.ps3': 'La PlayStation 3 a besoin de son firmware, installé par RPCS3 lui-même.',
  'bios.setup.psvita': 'La PlayStation Vita a besoin d’un dump de firmware installé par Vita3K.',
  'bios.setup.n3ds':
    'La 3DS a besoin de ses polices partagées et de ses clés AES extraites d’une console.',
  'bios.setup.switch':
    'La Switch a besoin de prod.keys et d’un dump de firmware issus d’une console.',
  'bios.setup.wiiu': 'La Wii U a besoin de clés et d’un dump OTP issus d’une console.',

  // Pourquoi le BIOS d'une plateforme ne peut pas être placé du tout.

  'bios.blockedNoMapping':
    'RomMix n’a aucune correspondance de dossier pour {platform} : il ne sait donc pas quel ' +
    'émulateur la fait tourner. Ajoutez-en une dans settings.systemOverrides.',
  'bios.blockedNoEmulator': 'Aucun émulateur installé ne fait tourner {system}.',
  'bios.blockedNoFolder': 'RomMix ignore où {name} range ses fichiers BIOS.',

  // -- un jeu ---------------------------------------------------------------

  'game.fallbackTitle': 'Jeu',
  'game.play': 'Jouer',
  'game.running': 'En cours…',
  'game.cancelDownload': 'Annuler le téléchargement ({percent} %)',
  'game.addFavourite': 'Ajouter aux favoris',
  'game.removeFavourite': 'Retirer des favoris',
  'game.runWith': 'Lancer avec',
  'game.pullSaves': 'Récupérer les sauvegardes',
  'game.pushSaves': 'Envoyer les sauvegardes',
  'game.extracting': 'Extraction…',
  'game.downloading': 'Téléchargement…',
  'game.openBios': 'Ouvrir BIOS',
  'setup.dontShowAgain': 'Ne plus afficher',
  'game.tabDetails': 'Détails',
  'game.tabSaves': 'Sauvegardes',
  'game.tabFiles': 'Fichiers',
  'game.tabScreenshots': 'Captures',
  'game.revision': 'Rév. {revision}',
  'game.ratingOutOf': '/ 100',
  'game.runningAsk':
    'Le jeu est en cours. RomMix demandera quoi envoyer à RomM quand vous quitterez l’émulateur.',
  'game.runningAuto':
    'Le jeu est en cours. RomMix renverra vos sauvegardes vers RomM quand vous quitterez ' +
    'l’émulateur.',
  'game.biosMissing_one':
    '{platform} a besoin de {files} pour lancer la plupart des jeux, et il n’est pas installé.',
  'game.biosMissing_other':
    '{platform} a besoin de {files} pour lancer la plupart des jeux, et ils ne sont pas installés.',
  'game.biosSetup': '{platform} a besoin que son BIOS soit en place avant que les jeux démarrent.',
  'setup.hidden': 'Étapes de configuration masquées pour {emulator}',
  'game.alreadyDownloaded': 'Déjà téléchargé',
  'game.downloadStarted': 'Téléchargement lancé',
  'game.couldNotStart': 'Le jeu n’a pas pu démarrer',
  'game.sessionEnded': 'Session terminée',
  'game.sessionPending_one': 'Session terminée — {count} fichier à envoyer',
  'game.sessionPending_other': 'Session terminée — {count} fichiers à envoyer',
  'game.sessionSent_one': 'Session terminée — {count} sauvegarde envoyée à RomM',
  'game.sessionSent_other': 'Session terminée — {count} sauvegardes envoyées à RomM',
  'game.favouriteAdded': 'Ajouté aux favoris sur RomM',
  'game.favouriteRemoved': 'Retiré des favoris',

  // Les quatre questions posées avant un geste sans retour.

  'game.variantTitle': 'Comment lancer les jeux {system} ?',
  'game.variantBody':
    '{emulator} en propose plusieurs. Retenu pour {system} — changez-le plus tard avec Lancer avec',
  'game.deleteSaveTitle': 'Supprimer cette sauvegarde {where} ?',
  'game.deleteStateTitle': 'Supprimer cet état {where} ?',
  'game.deleteAssetBody': '{file} — {location}. {consequence}',
  'game.deleteOnlyCopy': 'C’est la seule copie.',
  'game.deleteAt': 'Supprimer {where}',
  'game.pushTitle_one': 'Envoyer {count} fichier à RomM ?',
  'game.pushTitle_other': 'Envoyer {count} fichiers à RomM ?',
  'game.pushUploadedAs': 'Envoyé sous le nom {device}.',
  'game.pushSend': 'Envoyer à RomM',
  'game.pushSendNoAsk': 'Envoyer et ne plus demander',

  // -- ce qu'un envoi s'apprête à transmettre -------------------------------

  'push.folderAsZip': 'dossier, envoyé en un seul zip',
  'push.onRomM': 'Sur RomM : {source}, {when}',
  'push.newerThanThis': 'plus récent que celui-ci',
  'push.newOnRomM': 'Nouveau sur RomM',
  'push.thisDevice': 'cet appareil',
  'push.anotherDevice': 'un autre appareil',
  'push.andMore_one': 'et {count} fichier de plus.',
  'push.andMore_other': 'et {count} fichiers de plus.',

  // -- sauvegardes ----------------------------------------------------------

  'asset.save': 'Sauvegarde',
  'asset.state': 'État',

  'saves.synced': 'Synchronisé',
  'saves.syncedHint': 'Cet appareil et RomM ont le même fichier.',
  'saves.localNewer': 'Plus récent ici',
  'saves.localNewerHint': 'Joué depuis le dernier envoi. Envoyer les sauvegardes le transmettra.',
  'saves.localOnly': 'Absent de RomM',
  'saves.localOnlyHint': 'Uniquement sur cet appareil. Envoyer les sauvegardes le transmettra.',
  'saves.remoteNewer': 'Plus récent sur RomM',
  'saves.remoteNewerHint':
    'RomM a une copie plus récente. Récupérer les sauvegardes la rapatriera.',
  'saves.remoteOnly': 'Absent de cet appareil',
  'saves.remoteOnlyHint': 'Uniquement sur RomM. Récupérer les sauvegardes la rapatriera.',
  'saves.scopeLocal': 'de cet appareil',
  'saves.scopeRemote': 'de RomM',
  'saves.consequenceLocal': 'Récupérer les sauvegardes fera redescendre la copie de RomM.',
  'saves.consequenceRemote': 'Envoyer les sauvegardes renverra la copie de cet appareil.',
  'saves.empty': 'Aucune sauvegarde pour ce jeu, ni ici ni sur RomM.',
  'saves.emptyPlayIt': 'Jouez-y une fois et sa sauvegarde apparaîtra ici.',
  'saves.nothingNewer': 'Rien de plus récent sur RomM',
  'saves.noLocalSaves': 'Aucune sauvegarde locale à envoyer',
  'saves.pulled_one': '{count} fichier téléchargé',
  'saves.pulled_other': '{count} fichiers téléchargés',
  'saves.pushed_one': '{count} fichier envoyé à RomM',
  'saves.pushed_other': '{count} fichiers envoyés à RomM',
  'saves.nothingSent': 'Rien n’a été envoyé',
  'saves.noAskAgain': 'Les sauvegardes seront envoyées sans demander',
  'saves.deleted': '{file} supprimé {where}',
  // -- ce qu'un émulateur donné ne peut pas synchroniser, et ce qu'il attend --
  'saves.retrodeckPcsx2':
    "RetroDECK donne à PCSX2 une seule carte mémoire partagée par tous les jeux PS2 : aucune sauvegarde n'appartient donc à celui-ci. Les états de sauvegarde sont synchronisés.",
  'saves.retrodeckDuckstation':
    "RetroDECK donne à DuckStation une seule carte mémoire partagée par tous les jeux PS1 : aucune sauvegarde n'appartient donc à celui-ci. Les états de sauvegarde sont synchronisés.",
  'saves.pcsx2':
    "PCSX2 garde une seule carte mémoire partagée par tous les jeux PS2 : aucune sauvegarde n'appartient donc à celui-ci. Les états de sauvegarde sont synchronisés.",
  'saves.dolphin':
    "Dolphin garde une carte mémoire GameCube par région et une seule NAND Wii pour tous les jeux : aucune sauvegarde n'appartient donc à celui-ci. Les états de sauvegarde sont synchronisés.",
  'saves.primehack':
    "PrimeHack garde une seule carte mémoire pour tous les jeux : aucune sauvegarde n'appartient donc à celui-ci. Les états de sauvegarde sont synchronisés.",
  'saves.ppsspp':
    "PPSSPP classe ses sauvegardes sous l'identifiant de jeu inscrit dans l'image disque plutôt que sous le nom de la ROM, et RomMix ne peut pas le lire depuis l'extérieur de l'émulateur.",
  'saves.rpcs3':
    "RPCS3 classe ses sauvegardes sous l'identifiant de titre PS3 plutôt que sous le nom de la ROM, que RomMix ne peut pas rattacher à ce jeu.",
  'saves.cemu':
    "Cemu classe ses sauvegardes sous l'identifiant de titre Wii U plutôt que sous le nom de la ROM, que RomMix ne peut pas rattacher à ce jeu.",
  'saves.vita3k':
    "Vita3K classe ses sauvegardes sous l'identifiant de titre Vita plutôt que sous le nom de la ROM, que RomMix ne peut pas rattacher à ce jeu.",
  'saves.xenia':
    "Xenia classe ses sauvegardes sous l'identifiant de titre Xbox 360 plutôt que sous le nom de la ROM, que RomMix ne peut pas rattacher à ce jeu.",
  'saves.flycast':
    "Flycast garde deux cartes mémoire VMU partagées par tous les jeux Dreamcast : aucune sauvegarde n'appartient donc à celui-ci. Les états de sauvegarde sont synchronisés.",
  'saves.xemu':
    "xemu garde un seul disque dur Xbox émulé pour tous les jeux : aucune sauvegarde n'appartient donc à celui-ci.",
  'saves.xroar': "XRoar n'écrit aucune sauvegarde sur pile ; seuls ses états sont synchronisés.",
  'saves.azahar':
    'Azahar range ses sauvegardes dans une arborescence de carte SD émulée indexée par identifiant de titre, que RomMix ne peut pas rattacher à ce jeu.',
  'saves.azaharStates':
    'Azahar range ses sauvegardes dans une arborescence de carte SD émulée indexée par identifiant de titre, que RomMix ne peut pas rattacher à ce jeu. Les états de sauvegarde sont synchronisés.',
  'saves.shadps4NoData': "RomMix n'a pas trouvé où shadPS4 range ses données de sauvegarde.",
  'saves.shadps4NoSerial':
    "Ce jeu n'indique aucun numéro de série PS4 : RomMix ne peut donc pas savoir lequel des dossiers de sauvegarde de shadPS4 lui appartient.",
  'setup.edenRoms': 'Ajoutez le dossier de ROM de RomMix à Eden : File → Game Directories.',
  'setup.edenFirmware':
    'Installez le firmware dans Eden : Tools → Install Firmware. Les clés sont copiées pour vous.',
  'setup.edenControls': 'Configurez votre manette dans Eden : Emulation → Configure → Controls.',
  'setup.edenExitConfirm':
    'Désactivez la confirmation de sortie d’Eden : Emulation → Configure → General → Confirm ' +
    'exit while emulation is running.',
  'setup.edenStaging':
    'Installez le firmware dans Eden : Tools → Install Firmware, en le pointant sur le fichier ci-dessous.',
  'setup.shadps4Roms':
    'Ajoutez le dossier de ROM de RomMix à shadPS4, pour que sa liste de jeux trouve ce que vous téléchargez.',

  'saves.switchNoTitleId':
    'RomMix n’a pas pu lire d’identifiant de titre pour ce jeu, qui est ce avec quoi {emulator} ' +
    'nomme son dossier de sauvegarde. Une ROM qui porte son identifiant de titre dans le nom de ' +
    'fichier, ou un NSP ou XCI non modifié, se résout automatiquement.',
  'saves.switchNoProfile':
    '{emulator} n’a pas encore de profil utilisateur : une sauvegarde n’a nulle part où aller. ' +
    'Lancez-le une fois et créez un profil.',

  // -- les détails d'un jeu -------------------------------------------------

  'details.company': 'Éditeur',
  'details.series': 'Série',
  'details.released': 'Sortie',
  'details.players': 'Joueurs',
  'details.modes': 'Modes',
  'details.languages': 'Langues',
  'details.tags': 'Étiquettes',
  'details.lastPlayed': 'Dernière partie',
  'details.installedTo': 'Installé dans',
  'details.systemFolder': 'Dossier système',
  'details.downloadedFor': 'Téléchargé pour',
  'details.onDisk': 'Sur le disque',
  'details.downloaded': 'Téléchargé',
  'details.romMixFolder': 'Le dossier propre à RomMix',
  'details.empty': 'RomM n’en sait pas plus sur ce jeu.',

  'files.tagBoth': 'Les deux',
  'files.tagServer': 'RomM',
  'files.tagDevice': 'Appareil',
  'files.hintBoth': 'Sur le serveur et sur cet appareil.',
  'files.hintServer': 'Uniquement sur le serveur. Téléchargez le jeu pour l’obtenir.',
  'files.hintDevice': 'Uniquement sur cet appareil. RomM ne le liste pas.',
  'files.empty': 'RomM ne liste aucun fichier pour ce jeu, et il n’y en a aucun sur cet appareil.',
  'shots.empty': 'RomM n’a aucune capture pour ce jeu.',
  'shots.view': 'Voir',
  'shots.previous': 'Capture précédente',
  'shots.next': 'Capture suivante',
  'shots.position': '{index} sur {total}',

  // -- réglages -------------------------------------------------------------

  'settings.title': 'Réglages',
  'settings.tabGeneral': 'Général',
  'settings.tabGames': 'Jeux',
  'settings.tabSystem': 'Système',

  'settings.server': 'Serveur',
  'settings.address': 'Adresse',
  'settings.signedInAs': 'Connecté en tant que',
  'settings.rommVersion': 'Version de RomM',
  'settings.disconnect': 'Se déconnecter',
  'settings.disconnected': 'Déconnecté de RomM',
  'settings.interface': 'Interface',
  'settings.scaleHint': 'Auto suit l’écran : deux fois plus grand sur un téléviseur 4K.',
  'settings.language': 'Langue',
  'settings.languageHint': 'Auto suit la langue configurée sur cette machine.',
  'settings.support': 'Soutenir RomMix',
  'settings.supportBody':
    'RomMix est gratuit et le restera. S’il vous a épargné un après-midi à câbler des émulateurs ' +
    'entre eux, vous pouvez m’offrir un café.',
  'settings.buyCoffee': 'M’offrir un café',
  'settings.scanOrOpen':
    'Scannez ceci avec votre téléphone, ou ouvrez-le dans un navigateur sur cette machine.',
  'settings.application': 'Application',
  'settings.toggleFullscreen': 'Basculer en plein écran',

  'settings.gamesOnDisk': 'Jeux sur le disque',
  'settings.storageToRomMix':
    'Les nouveaux téléchargements vont dans le dossier RomMix — indiquez-le à chaque émulateur',
  'settings.storageToEmulator':
    'Les nouveaux téléchargements vont dans le dossier propre à chaque émulateur',
  'settings.sharedFolderNote':
    'Les jeux sont écrits dans {path}/roms/<système>. Les jeux déjà téléchargés dans le dossier ' +
    'd’un émulateur y restent et sont de nouveau proposés au téléchargement ; revenez en arrière ' +
    'et ils réapparaissent.',
  'settings.saveSync': 'Synchronisation des sauvegardes',
  'settings.syncDown': 'Télécharger les sauvegardes plus récentes avant de jouer',
  'settings.syncDownHint':
    'Seulement si elles sont strictement plus récentes. Le fichier local est conservé en ' +
    '*.rommix-bak.',
  'settings.syncUp': 'Envoyer les sauvegardes après avoir joué',
  'settings.syncUpHint': 'Seul ce que la session a écrit est envoyé.',
  'settings.confirmPush': 'Demander avant d’envoyer des sauvegardes à RomM',
  'settings.confirmPushHint': 'Montre ce qui sera envoyé avant de l’envoyer.',
  'settings.downloads': 'Téléchargements',
  'settings.confirmUninstall': 'Demander avant de supprimer un jeu téléchargé',
  'settings.confirmUninstallHint':
    'Désinstaller n’est qu’à une pression de A de la suppression d’un fichier de plusieurs ' +
    'gigaoctets.',

  'emulators.explainer':
    'Ce que RomMix a trouvé sur cette machine, et combien de plateformes chacun couvre. L’ordre ' +
    'est la préférence : une plateforme sans choix propre est lancée par le premier émulateur de ' +
    'la liste qui est installé et la couvre, donc en remonter un en fait le choix par défaut pour ' +
    'tout ce qu’il sait faire. Les plateformes que vous avez réglées individuellement ci-dessous ' +
    'ne sont pas touchées.',
  'emulators.platforms': 'Plateformes',
  'emulators.platformsExplainer':
    'Quel émulateur fait tourner chaque plateforme de votre bibliothèque. Chaque plateforme part ' +
    'd’un choix par défaut tiré de ce que ces émulateurs prennent en charge habituellement ; ' +
    'changez-en un et RomMix utilise votre choix pour cette plateforme uniquement, et le dit ' +
    'plutôt que de lui substituer autre chose en silence s’il manque.',

  // -- un émulateur ---------------------------------------------------------

  'emulator.notChecked': 'Non vérifié',
  'emulator.installed': 'Installé',
  'emulator.needsSetup': 'À configurer',
  'emulator.notInstalled': 'Non installé',
  'emulator.kindFlatpak': 'Flatpak',
  'emulator.kindBinary': 'Programme',
  'emulator.kindAppImage': 'AppImage',
  'emulator.kindScripts': 'Lanceurs',
  'emulator.groupGeneral': 'Général',
  'emulator.groupFolders': 'Dossiers',
  'emulator.platforms_one': '{count} plateforme',
  'emulator.platforms_other': '{count} plateformes',
  'emulator.homepage': 'Site',
  'emulator.home': 'Racine',
  'emulator.roms': 'Roms',
  'emulator.saves': 'Sauvegardes',
  'emulator.bios': 'Bios',
  'emulator.notFound': 'introuvable',
  'emulator.setByYou': '(défini par vous)',
  'emulator.homeFolder': 'Dossier racine',
  'emulator.homeFolderHint':
    'Les roms, sauvegardes, états et BIOS sont lus depuis ce dossier. Laissez-le vide pour ' +
    'revenir à la détection automatique.',
  'emulator.useThisFolder': 'Utiliser ce dossier',
  'emulator.changeVersion': 'Changer de version',
  'emulator.run': 'Lancer',
  'emulator.movedUp': '{name} est monté',
  'emulator.movedDown': '{name} est descendu',
  'emulator.rootSet': '{name} sera lu depuis {path}',
  'emulator.rootCleared': 'Le dossier de {name} est de nouveau trouvé automatiquement',
  'emulator.installedTitle': '{name} est installé',
  'emulator.setupTitle': 'Configurer {name}',
  'emulator.setupSteps': 'Étapes de configuration',
  'emulator.setupIntro':
    'Ce qui reste se passe dans {name} même — RomMix ne peut ni le faire depuis l’extérieur ni ' +
    'vérifier que c’est fait :',
  'emulator.installedToast': '{name} installé',
  'emulator.installingFlathub': 'Installation depuis Flathub',
  'emulator.contactingFlathub': 'Contact de Flathub…',
  'emulator.installTitle': 'Installer {name}',
  'emulator.fromFlathub': '{appId}, depuis Flathub',
  'emulator.buildIntoRomMix': 'la version que vous choisissez, dans le dossier propre à RomMix',
  'emulator.manualInstall': '{name} doit être installé à la main.',
  'emulator.manualInstallFrom': '{name} doit être installé à la main, depuis {homepage}.',
  'emulator.reasonNotInstalled': '{name} n’est pas installé.',
  'emulator.reasonNotRun': '{name} n’a jamais été lancé, ses dossiers n’existent donc pas.',

  'platforms.connectFirst':
    'Connectez-vous à RomM pour voir les plateformes de votre bibliothèque.',
  'platforms.noneCovers': 'Aucun émulateur ne la couvre',
  'platforms.noneInstalled': 'Aucun installé',
  'platforms.meta_one': '{system} · {count} jeu',
  'platforms.meta_other': '{system} · {count} jeux',
  'platforms.default': '(par défaut)',

  // -- choisir une version à installer --------------------------------------

  'install.installing': 'Installation de {name}',
  'install.title': 'Installer {name}',
  'install.noBuilds': 'Aucune version n’a été publiée pour cette machine.',
  'install.whichVersion': 'Quelle version ?',
  'install.publishedAt': 'Publié sur {url}.',
  'install.latest': 'La plus récente',
  'install.prerelease': 'Préversion',
  'install.noDate': 'sans date de publication',
  'install.builds_one': '{count} build pour cette machine',
  'install.builds_other': '{count} builds pour cette machine',
  'install.chooseVersion': 'Choisir cette version',
  'install.chooseBuild': 'Installer ce build',
  'install.whichBuild':
    'Quel build ? Prenez celui qui correspond à votre matériel — dans le doute, le nom le plus ' +
    'simple est celui à tout faire.',
  'install.otherVersions': 'Autres versions',

  // -- les mises à jour de RomMix -------------------------------------------

  'update.label': 'Nouvelles versions de RomMix',
  'update.policyAuto': 'Automatique',
  'update.policyNotify': 'Me prévenir',
  'update.policyOff': 'Désactivé',
  'update.hintAuto':
    'Les nouvelles versions sont téléchargées en arrière-plan et utilisées au prochain démarrage ' +
    'de RomMix.',
  'update.hintNotify':
    'RomMix signale la publication d’une nouvelle version et attend que vous la récupériez.',
  'update.hintOff': 'RomMix ne regarde jamais de lui-même. Le bouton ci-dessous, si.',
  'update.installed': 'Installée',
  'update.newestPublished': 'Dernière publiée',
  'update.checking': 'vérification…',
  'update.notCheckedYet': 'pas encore vérifié',
  'update.lastChecked': 'Dernière vérification',
  'update.available': 'RomMix {version} est disponible.',
  'update.availableBlocked': 'Téléchargez-le depuis la page des versions.',
  'update.availableAuto': 'Il est en cours de récupération.',
  'update.availableManual':
    'Récupérez-le quand cela vous arrange — rien n’est téléchargé tant que vous ne le faites pas.',
  'update.downloadingLine': 'Téléchargement de RomMix {version} : {size}',
  'update.ready': 'RomMix {version} est prêt.',
  'update.readyDefault':
    'Il sera utilisé au prochain démarrage de RomMix, ou tout de suite si vous redémarrez.',
  'update.upToDate': 'RomMix est à jour.',
  'update.checkNow': 'Vérifier maintenant',
  'update.downloadVersion': 'Télécharger {version}',
  'update.downloadAction': 'Télécharger la nouvelle version',
  'update.restartNow': 'Redémarrer maintenant',
  'update.releasesPage': 'Page des versions',
  'update.newest': 'RomMix {version} est la version la plus récente',
  'update.steamBlocked':
    'Steam a lancé RomMix, et il ne laisse pas un programme se relancer lui-même. Quittez RomMix ' +
    'et appuyez de nouveau sur Jouer — la nouvelle version est déjà en place.',
  'update.noBuildForMachine': 'La version {version} n’a aucun build pour cette machine ({arch}).',
  'update.noVersionTag': 'La version la plus récente n’a pas d’étiquette de version',
  'update.nothingToDownload': 'Il n’y a aucune nouvelle version à télécharger',
  'update.nothingToRestartInto': 'Il n’y a aucune version téléchargée vers laquelle redémarrer',
  'update.devBuild': 'Ceci est un build de développement, RomMix ne le remplacera pas.',
  'update.notAppImage':
    'RomMix n’a pas été lancé depuis une AppImage, il ne peut donc pas se remplacer lui-même. ' +
    'Téléchargez la nouvelle version depuis la page des versions.',
  'update.cannotWrite':
    'RomMix ne peut pas écrire dans {dir}, il ne peut donc pas s’y remplacer. Déplacez ' +
    'l’AppImage à un endroit qui vous appartient, ou téléchargez la nouvelle version depuis la ' +
    'page des versions.',
  'update.noRoom': 'Il ne reste pas assez de place sur {dir} pour la nouvelle version.',
  'update.githubResponded': 'GitHub a répondu {status}',
  'update.downloadFailed': 'Échec du téléchargement : {url} a répondu {status}',

  // -- l'installation elle-même ---------------------------------------------

  'system.updates': 'Mises à jour',
  'system.romMixFolder': 'Dossier RomMix',
  'system.folderExplainer':
    'Les réglages, les identifiants, l’index des téléchargements et tout émulateur installé par ' +
    'RomMix. Déplacez ce dossier pour déplacer toute l’installation.',
  'system.folder': 'Dossier',
  'system.folderHintEnv': 'Défini par ROMMIX_HOME, qui l’emporte sur tout ce qui est choisi ici.',
  'system.folderHint':
    'Les réglages sont copiés dans le nouveau dossier ; les émulateurs et les ROM restent où ils ' +
    'sont.',
  'system.moveAndRestart': 'Déplacer et redémarrer',
  'system.folderMoved': 'Dossier RomMix déplacé — redémarrage',
  'system.preflight': 'Vérification préalable',
  'system.flatpakAvailable': 'Flatpak disponible',
  'system.flathubSetUp': 'Flathub configuré',
  'system.flathubOnFirstInstall': 'non — ajouté à la première installation',
  'system.emulatorsInstalled': 'Émulateurs installés',
  'system.countOf': '{count} sur {total}',
  'system.romsWritable': 'Dossiers de ROM accessibles en écriture',
  'system.controller': 'Manette',
  'system.noController': 'aucune détectée — appuyez sur un de ses boutons',
  'system.logFile': 'Fichier journal',
  'system.allReady': 'Tout a l’air prêt pour jouer.',
  'system.rerunCheck': 'Relancer la vérification',
  'system.checkedReady': 'Vérifié — tout a l’air prêt pour jouer',
  'system.checkedProblems_one': 'Vérifié — {count} point à régler',
  'system.checkedProblems_other': 'Vérifié — {count} points à régler',

  'change.title': 'Changer l’émulateur qui fait tourner cela ?',
  'change.body':
    'Chaque émulateur garde ses propres fichiers, et rien ne suit quand vous en changez :',
  'change.bios': 'Les fichiers BIOS devront être réinstallés pour le nouvel émulateur.',
  'change.gamesShared':
    'Les jeux restent où ils sont — ils sont dans le dossier propre à RomMix, celui que vous ' +
    'indiquez à chaque émulateur.',
  'change.gamesPerEmulator':
    'Les jeux téléchargés restent dans le dossier de l’ancien émulateur et devront être ' +
    'retéléchargés.',
  'change.saves':
    'Les sauvegardes vivent dans l’arborescence de l’ancien émulateur. Récupérez-les depuis RomM ' +
    'après le changement.',
  'change.confirm': 'Changer',
  'change.confirmNoAsk': 'Changer et ne plus demander',

  // -- ce que rapporte la vérification préalable ----------------------------

  'diagnostics.noFlatpak':
    'flatpak n’est pas installé : RomMix ne peut donc ni trouver ni installer les émulateurs ' +
    'distribués de cette façon. Installez-le depuis votre distribution, puis relancez cette ' +
    'vérification.',
  'diagnostics.noFlathub':
    'Flathub n’est pas configuré pour votre utilisateur : il n’y a donc pas encore d’endroit d’où ' +
    'installer les émulateurs flatpak. RomMix l’ajoute la première fois que vous en installez un, ' +
    'ou vous pouvez l’ajouter vous-même avec : flatpak remote-add --user --if-not-exists flathub ' +
    'https://dl.flathub.org/repo/flathub.flatpakrepo',
  'diagnostics.noEmulatorSuggest':
    'Aucun émulateur trouvé. Installez {name}, qui couvre la plupart des systèmes, depuis la ' +
    'section Émulateurs ci-dessus.',
  'diagnostics.noEmulator':
    'Aucun émulateur trouvé. Installez-en un depuis la section Émulateurs ci-dessus.',
  'diagnostics.romsNotWritable':
    'Le dossier de ROM de {name}, {path}, n’est pas accessible en écriture. Vérifiez ses ' +
    'permissions, ou que le disque sur lequel il se trouve est bien monté.',
  'diagnostics.sharedFolder':
    'Les jeux sont téléchargés dans {path}. Ajoutez ce dossier aux répertoires de jeux de chaque ' +
    'émulateur, sinon ils ne listeront pas ce que RomMix a téléchargé.',

  // -- les échecs rapportés par le processus principal ----------------------

  'error.serverAddressEmpty': 'L’adresse du serveur est vide',
  'error.noServerConfigured': 'Aucun serveur RomM configuré',
  'error.cannotReach': 'Impossible de joindre {url} : {reason}',
  'error.notAuthorised': 'Non autorisé — reconnectez-vous',
  'error.permissionDenied': 'Permission refusée : {detail}',
  'error.rommReturned': 'RomM a répondu {status} : {detail}',
  'error.wrongCredentials': 'Identifiant ou mot de passe incorrect',
  'error.sessionExpired': 'Session expirée — reconnectez-vous',
  'error.emptyResponseBody': 'RomM a renvoyé un corps de réponse vide',
  'error.emptyAssetBody': 'Corps de fichier vide',
  'error.credentialsRequired': 'L’identifiant et le mot de passe sont obligatoires',
  'error.tokenRequired': 'Un jeton API est obligatoire',
  'error.couldNotSignIn': 'Connexion impossible',

  'error.notDownloadedForEmulator':
    'Cette ROM n’est pas téléchargée pour l’émulateur qu’utilise cette plateforme',
  'error.notDownloadedYet': 'Cette ROM n’est pas encore téléchargée',
  'error.downloadedForOther':
    'Cette copie a été téléchargée pour un autre émulateur. Téléchargez-la de nouveau pour celui ' +
    'que cette plateforme utilise désormais.',
  'error.noEmulatorForSystem': 'Aucun émulateur installé ne peut faire tourner « {system} ».',
  'error.noEmulatorInstallOne':
    'Aucun émulateur installé ne peut faire tourner « {system} ». Installez {name}, puis ' +
    'réessayez.',
  'error.noFolderMapping':
    'RomMix ignore à quel dossier « {platform} » correspond. Ajoutez une correspondance pour ' +
    '« {slug} » dans settings.systemOverrides.',
  'error.noRomFolder': 'RomMix ignore où {name} range ses jeux',

  'error.unknownEmulator': 'RomMix ne connaît aucun émulateur appelé {id}',
  'error.emulatorNotInstalled': '{name} n’est pas installé',
  'error.cannotInstall': 'RomMix ne peut pas installer {name} pour vous',
  'error.assetNotRunnable': '{asset} n’est pas quelque chose que RomMix sait exécuter',
  'error.assetWrongArch': '{asset} n’est pas compilé pour cette machine ({arch})',
  'error.notAFlatpak': '{name} n’est pas distribué sous forme de flatpak',

  'error.rootMustBeAbsolute': 'Le dossier RomMix doit être un chemin absolu',
  'error.romMixHomeSet':
    'ROMMIX_HOME est défini, et il l’emporte sur le dossier choisi ici. Retirez-le et relancez ' +
    'RomMix pour déplacer le dossier depuis les Réglages.',
  'error.onlyWebAddresses': 'RomMix n’ouvre que des adresses web',

  'error.biosListFailed': 'Impossible de lire les fichiers BIOS sur le serveur : {reason}',
  'error.biosGone': 'Ce fichier BIOS n’est plus sur le serveur',
  'error.biosNowhere': 'RomMix n’a nulle part où mettre ce fichier BIOS',

  'error.assetGone': '{file} n’est plus là pour être supprimé',
  'error.assetNotLocal': '{file} n’est pas sur cet appareil pour être supprimé',
  'error.assetNotRemote': '{file} n’est pas sur RomM pour être supprimé',

  'error.cannotOpenArchive': 'Impossible d’ouvrir l’archive',
  'error.badZipEntry': 'Entrée zip invalide',
  'error.releasesResponded': '{api} a répondu {status}',
  'error.assetDownloadFailed': 'Échec du téléchargement : {url} a répondu {status}',
  'error.noAppImageInArchive': '{archive} ne contient aucune AppImage',

  // -- lancer un jeu --------------------------------------------------------

  'launch.installingCore': 'Installation du cœur {core}…',
  'launch.installingCorePercent': 'Installation du cœur {core}… {percent} %',
  'launch.alreadyRunning': 'Un jeu est déjà en cours',
  'launch.cannotRunSystem':
    '{emulator} ne peut pas faire tourner « {system} ». Choisissez un autre émulateur pour cette ' +
    'plateforme dans les Réglages, ou installez-en un qui la couvre.',
  'launch.launcherMissing':
    '{emulator} n’a aucun lanceur installé pour « {system} ». Ajoutez-en un depuis {emulator}, ou ' +
    'choisissez un autre émulateur pour cette plateforme dans les Réglages.',
  'launch.stoppedBeforeStart': 'Arrêté avant le démarrage du jeu',
  'launch.syncWarning': 'Avertissement de synchronisation : {details}',
  'launch.couldNotStartEmulator': 'Impossible de démarrer l’émulateur : {reason}',
  'launch.couldNotStartNamed': 'Impossible de démarrer {name} : {reason}',
  'launch.emulatorReported': 'L’émulateur a signalé : {detail}',
  'launch.quitImmediatelyDetail': 'L’émulateur a quitté immédiatement : {detail}',
  'launch.quitImmediately': 'L’émulateur a quitté immédiatement.',
  'launch.quitImmediatelyCode': 'L’émulateur a quitté immédiatement (code {code}).',
  'launch.emulatorQuitDetail': '{name} a quitté immédiatement : {detail}',
  'launch.emulatorQuitCode': '{name} a quitté immédiatement (code {code}).',

  'core.noneForMachine':
    'Aucun cœur {core} n’est publié pour cette machine. Installez-le depuis l’Online Updater de ' +
    'l’émulateur.',
  'core.downloadFailed': 'Impossible de télécharger le cœur {core} : {url} a répondu {status}',
  'core.missingFile': 'Le téléchargement de {core} ne contenait pas {file}',

  'host.addingFlathub': 'Ajout du dépôt Flathub…',
  'host.flathubFailed':
    'Impossible d’ajouter le dépôt Flathub. Ajoutez-le à la main avec :  flatpak remote-add ' +
    '--user --if-not-exists {remote} {repo}',
  'host.suspiciousAppId':
    'Installation refusée pour un identifiant d’application suspect : {appId}',
  'host.flatpakFailed': 'Impossible d’exécuter flatpak : {reason}'
}
