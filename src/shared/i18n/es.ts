import type { Catalog } from './catalog.ts'

/**
 * RomMix en español.
 *
 * Declarado como `Catalog`: una entrada añadida a `en.ts` y olvidada aquí falla
 * en la comprobación de tipos, en lugar de salir calladamente en inglés.
 *
 * Los nombres propios no se traducen — RomM, RomMix, Flatpak, Flathub,
 * AppImage, BIOS — ni las etiquetas que el usuario va a buscar dentro de otro
 * programa: «Tools → Install Firmware» está escrito en un menú que sigue en
 * inglés.
 *
 * Se tutea, que es como habla el resto de una interfaz de salón.
 */
export const es: Catalog = {
  // -- palabras compartidas -------------------------------------------------

  'action.back': 'Atrás',
  'action.cancel': 'Cancelar',
  'action.pause': 'Pausar',
  'action.resume': 'Reanudar',
  'action.close': 'Cerrar',
  'action.keep': 'Conservarlo',
  'action.delete': 'Eliminar',
  'action.next': 'Siguiente',
  'action.select': 'Elegir',
  'action.open': 'Abrir',
  'action.search': 'Buscar',
  'action.navigate': 'Navegar',
  'action.menu': 'Menú',
  'action.type': 'Escribir',
  'action.install': 'Instalar',
  'action.installAll': 'Instalar todo',
  'action.reinstall': 'Reinstalar',
  'action.uninstall': 'Desinstalar',
  'action.download': 'Descargar',
  'action.tryAgain': 'Reintentar',
  'action.trying': 'Reintentando…',
  'action.checking': 'Comprobando…',
  'action.installing': 'Instalando…',
  'action.starting': 'Arrancando…',
  'action.expand': 'Desplegar',
  'action.collapse': 'Plegar',
  'action.moveUp': 'Subir',
  'action.moveDown': 'Bajar',
  'action.previousTab': 'Pestaña anterior',
  'action.nextTab': 'Pestaña siguiente',
  'action.rowActions': 'Acciones de la fila',
  'action.openInBrowser': 'Abrir en un navegador',

  'value.on': 'Activado',
  'value.off': 'Desactivado',
  'value.yes': 'sí',
  'value.no': 'no',
  'value.yesTitle': 'Sí',
  'value.noTitle': 'No',
  'value.auto': 'Auto',
  'value.none': 'Ninguno',
  'value.unknown': 'desconocida',
  'value.never': 'nunca',
  'value.notConfigured': 'Sin configurar',

  'key.enter': 'Intro',
  'key.esc': 'Esc',

  // -- el armazón de la aplicación ------------------------------------------

  'nav.home': 'Inicio',
  'nav.library': 'Biblioteca',
  'nav.collections': 'Colecciones',
  'nav.downloads': 'Descargas',
  'nav.emulators': 'Emuladores',
  'nav.bios': 'BIOS',
  'nav.settings': 'Ajustes',

  'app.notConnected': 'Sin conexión',
  'app.offline': 'Sin conexión',
  'app.offlineNotice':
    'RomMix está en modo sin conexión: no se puede contactar con el servidor RomM.',
  'app.loading': 'Cargando',
  'app.qrCode': 'Código QR',
  'app.credit': 'Desarrollado con {heart} por leclercb',
  'app.quitTitle': '¿Salir de RomMix?',
  'app.stay': 'Quedarse',
  'app.quit': 'Salir',
  'app.quitRomMix': 'Salir de RomMix',
  'app.gettingReady': 'Preparando',
  'app.gameRunning': 'Juego en marcha',
  'app.emulatorHasFocus': 'El emulador tiene el control. Ciérralo para volver.',
  'app.emulatorRunning': '{name} está en marcha',
  'app.holdToClose': 'Mantén {key} para cerrarlo desde aquí.',
  'app.closeEmulator': 'Cerrar el emulador',
  'app.notClosing': 'No se ha cerrado. Forzarlo pierde todo lo que no haya guardado.',
  'app.holdToForce': 'Mantén {key} otra vez para forzarlo.',
  'app.forceClose': 'Forzar el cierre',
  'app.askingEmulatorToQuit': 'Pidiendo al emulador que se cierre…',
  'app.closingEmulatorNow': 'Cerrándolo ahora…',
  'app.couldNotClose': 'Sigue en ejecución. RomMix no tiene otra forma de cerrarlo.',

  // -- avisos del armazón ---------------------------------------------------

  'toast.updateAvailable': 'RomMix {version} está disponible',
  'toast.updateAvailableSettings': 'RomMix {version} está disponible — mira en Ajustes',
  'toast.updateReadyRestart': 'RomMix {version} está listo — reinicia para usarlo',
  'toast.updateReadyQuit': 'RomMix {version} está listo — sal y vuelve a abrirlo',
  'toast.downloadComplete': 'Descarga terminada',
  'toast.downloadPaused': 'Descarga en pausa',
  'toast.downloadResumed': 'Descarga reanudada',
  'toast.downloadRequeued': 'De vuelta en la cola',
  'toast.downloadCancelled': 'Descarga cancelada',
  'toast.adoptedOne': 'Ya estaba en el disco — añadido a tu biblioteca',
  'toast.adoptedMany_one': '{count} juego ya estaba en el disco — añadido a tu biblioteca',
  'toast.adoptedMany_other': '{count} juegos ya estaban en el disco — añadidos a tu biblioteca',

  // -- la demo publicada ----------------------------------------------------

  'demo.notAvailable': 'No disponible en la vista previa web',
  'demo.noEmulator': 'No hay ningún emulador en la vista previa web',
  'demo.noFirmware': 'No existe ese firmware',
  'demo.nothingToReplace': 'Esta es la vista previa web, así que aquí no hay nada que reemplazar.',
  'demo.nothingChecked': 'Esta es la vista previa web: en realidad no se ha comprobado nada.',
  'demo.connectionClosed':
    'El servidor cerró la conexión antes de que el archivo estuviera completo.',
  'demo.variantFaster': 'más rápido, menos fiel',
  'demo.variantDefault': 'la elección de RomMix',
  'demo.title': 'RomMix — demo',
  'demo.description':
    'La interfaz de RomMix, sobre la biblioteca homebrew de la demo pública de RomM. No hay ' +
    'ningún servidor ni emulador de por medio, y no se descarga nada.',

  // -- primera configuración ------------------------------------------------

  'setup.stepOf': 'Paso {step} de {total}',
  'setup.scaleTitle': '¿De qué tamaño quieres RomMix?',
  'setup.scaleSubtitle':
    'Auto sigue a la pantalla — el doble de grande en un televisor 4K. Elige un tamaño que puedas ' +
    'leer desde donde te sientas; podrás cambiarlo luego en Ajustes.',
  'setup.scaleHint': 'Toda la interfaz, no solo el texto.',
  'setup.storageTitle': '¿Dónde deben ir los juegos descargados?',
  'setup.storageSubtitle':
    'Esto decide dónde aterriza cada ROM, así que es mucho más fácil responder ahora que cuando ya ' +
    'haya juegos en el disco en el otro sitio.',

  // -- ajustes que el asistente comparte ------------------------------------

  'control.scale': 'Escala',
  'storage.label': 'Dónde van los juegos descargados',
  'storage.hintShared':
    'Una sola carpeta para todo, que hay que indicar una vez a cada emulador. Cambiar de emulador ' +
    'no mueve nada, y un juego se puede descargar antes incluso de que esté instalado lo que lo ' +
    'ejecuta.',
  'storage.hintPerEmulator':
    'La carpeta de ROM propia de cada emulador, para que los juegos aparezcan en su lista cuando ' +
    'lo abras tú. Cambiar de emulador para una plataforma obliga a descargar sus juegos otra vez.',
  'storage.toEmulatorTitle': '¿Guardar los juegos en la carpeta de cada emulador?',
  'storage.toEmulatorBody':
    'Las descargas irán a la carpeta de ROM del emulador que ejecute su plataforma. Eso es lo que ' +
    'las pone en su propia lista de juegos cuando lo abres tú, y lo que las ata a él:',
  'storage.toEmulatorChange':
    'Cambiar de emulador para una plataforma deja sus juegos en la carpeta del anterior. RomMix ' +
    'deja de contarlos como descargados y vuelve a ofrecerlos.',
  'storage.toEmulatorMissing':
    'Un juego no se puede descargar para una plataforma que aún no tiene ningún emulador ' +
    'instalado.',
  'storage.toEmulatorExisting':
    'Los juegos que ya están en la carpeta de RomMix se quedan ahí y se vuelven a ofrecer; vuelve ' +
    'atrás y reaparecen.',
  'storage.toEmulatorKeep': 'Mantener una sola carpeta',
  'storage.toEmulatorConfirm': 'Usar la carpeta de cada emulador',
  'storage.toSharedTitle': '¿Guardar todos los juegos en una sola carpeta?',
  'storage.toSharedBody':
    'Las descargas irán a la carpeta de ROM propia de RomMix, que no es una carpeta que ningún ' +
    'emulador lea hasta que se le indique:',
  'storage.toSharedSetup':
    'Añade esa carpeta a los directorios de juegos de cada emulador, o no listarán lo que RomMix ' +
    'haya descargado. La comprobación previa dice cuál es la carpeta.',
  'storage.toSharedFree':
    'Cambiar de emulador para una plataforma ya no moverá nada ni obligará a descargar nada otra ' +
    'vez, y un juego se puede descargar antes de que esté instalado lo que lo ejecuta.',
  'storage.toSharedExisting':
    'Los juegos que ya están en la carpeta de un emulador se quedan ahí y se vuelven a ofrecer; ' +
    'vuelve atrás y reaparecen.',
  'storage.toSharedKeep': 'Mantener la carpeta de cada emulador',
  'storage.toSharedConfirm': 'Usar una sola carpeta',
  'storage.optionEmulator': 'La carpeta de cada emulador',
  'storage.optionRomMix': 'Carpeta de RomMix',

  // -- conexión -------------------------------------------------------------

  'connect.title': 'Conectar con RomM',
  'connect.subtitle': 'Apunta RomMix a tu servidor RomM para explorar y descargar tu biblioteca.',
  'connect.serverAddress': 'Dirección del servidor',
  'connect.serverAddressHint': 'La misma dirección que usas para la interfaz web de RomM.',
  'connect.howSignIn': '¿Cómo quieres iniciar sesión?',
  'connect.modeDevice': 'Emparejar este dispositivo',
  'connect.modeToken': 'Token de API',
  'connect.modePassword': 'Usuario y contraseña',
  'connect.deviceExplainer':
    'RomMix muestra un código corto que apruebas desde RomM en cualquier navegador — sin escribir ' +
    'contraseñas desde el sofá.',
  'connect.tokenHint': 'Crea uno en RomM, en Administration → Client tokens.',
  'connect.username': 'Usuario',
  'connect.password': 'Contraseña',
  'connect.contacting': 'Contactando con el servidor…',
  'connect.startPairing': 'Empezar el emparejamiento',
  'connect.connecting': 'Conectando…',
  'connect.connect': 'Conectar',
  'connect.connectedAs': 'Conectado a RomM como {user}',
  'connect.someone': 'usuario',
  'connect.pairTitle': 'Aprobar este dispositivo',
  'connect.pairExplainer':
    'Escanea esto con el móvil, o abre la dirección de abajo en cualquier dispositivo, y luego ' +
    'introduce el código para dejar entrar a RomMix en tu biblioteca.',
  'connect.pairOpen': 'Abrir en un navegador',
  'connect.pairExpiresIn': 'El código caduca en',
  'connect.pairTimeLeft': '{minutes} min {seconds} s',
  'connect.pairExpired': 'El código de emparejamiento ha caducado. Inténtalo de nuevo.',

  // -- inicio ---------------------------------------------------------------

  'home.title': 'Inicio',
  'home.continuePlaying': 'Seguir jugando',
  'home.readyToPlay': 'Listos para jugar',
  'home.favourites': 'Favoritos',
  'home.recentlyAdded': 'Añadidos hace poco',
  'home.empty':
    'Tu biblioteca de RomM parece vacía. Añade algunas ROM en el servidor y lanza un análisis.',
  'home.emptyOffline': 'Todavía no hay nada descargado en este dispositivo.',
  'home.pressToOpen': 'Pulsa {key} para abrir',

  // -- biblioteca -----------------------------------------------------------

  'library.title': 'Biblioteca',
  'library.browseAll': 'Explora todo lo que hay en tu servidor RomM',
  'library.count_one': '{count} juego',
  'library.count_other': '{count} juegos',
  'library.countOnPlatform_one': '{count} juego de {platform}',
  'library.countOnPlatform_other': '{count} juegos de {platform}',
  'library.searchPlaceholder': 'Título del juego…',
  'library.searchHint': 'Pulsa {key} para venir aquí, Esc para salir del campo.',
  'library.allPlatforms': 'Todas las plataformas',
  'library.scopeLabel': 'Mostrar:',
  'library.searchLabel': 'Buscar:',
  'library.platformLabel': 'Plataforma:',
  'library.scopeAll': 'Todos los juegos',
  'library.scopeDownloaded': 'Solo descargados',
  'library.noneDownloaded': 'Todavía no hay juegos descargados.',
  'library.platformChip': '{name} ({count})',
  'library.noMatches': 'Ningún juego coincide con esa búsqueda.',
  'library.thatIsAll_one': 'Eso es todo: {count} en total.',
  'library.thatIsAll_other': 'Eso es todo: {count} en total.',
  'library.downloadedMark': 'Descargado',

  // -- las estanterías del usuario en RomM -----------------------------------

  'collections.mine': 'Colecciones',
  'collections.derived': 'Colecciones virtuales',
  'collections.count_one': '{count} colección',
  'collections.count_other': '{count} colecciones',
  'collections.openExpand': 'Abrir · Desplegar',
  'collections.subtitle': 'Las colecciones que has hecho en RomM, y las que RomM construye solo.',
  'collections.empty': 'Aún no hay colecciones en tu servidor RomM.',
  'collections.emptyShelf': 'No hay nada en esta colección.',
  'status.button': 'Progreso',
  'status.dialogTitle': '¿Por dónde vas?',
  'status.none': 'Sin indicar',
  'status.incomplete': 'Jugando',
  'status.finished': 'Terminado',
  'status.completed_100': 'Completado al 100 %',
  'status.retired': 'Abandonado',
  'status.never_playing': 'No es para mí',
  'status.set': 'Marcado como {status}',
  'status.cleared': 'Progreso borrado',
  'collections.button': 'Colecciones',
  'collections.dialogTitle': '¿En qué colecciones?',
  'collections.none': 'Aún no tienes colecciones en RomM. Crea una allí y aparecerá aquí.',
  'collections.on': 'Dentro',
  'collections.off': 'Añadir',
  'collections.add': 'Añadir a esta colección',
  'collections.remove': 'Quitar de esta colección',

  // -- descargas ------------------------------------------------------------

  'downloads.onDisk_one': '{count} juego en el disco · {size}',
  'downloads.onDisk_other': '{count} juegos en el disco · {size}',
  'downloads.now': 'Descargar ahora',
  'downloads.next': 'Descargar a continuación',
  'downloads.notResumable': 'no se puede reanudar',
  'downloads.state.paused': 'En pausa',
  'downloads.state.queued': 'En espera',
  'downloads.state.downloading': 'Descargando',
  'downloads.state.extracting': 'Extrayendo',
  'downloads.state.done': 'Instalado',
  'downloads.state.error': 'Fallido',
  'downloads.state.cancelled': 'Cancelado',
  'downloads.sort.recent': 'Añadidos hace poco',
  'downloads.sort.largest': 'Los más grandes primero',
  'downloads.sort.name': 'Nombre',
  'downloads.tabActivity': 'Actividad',
  'downloads.tabDevice': 'En este dispositivo',
  'downloads.checkingTitle': 'Comprobando tu biblioteca',
  'downloads.checkedOf': '{checked} de {total} juegos comprobados',
  'downloads.askingRomM': 'Preguntando a RomM qué tienes…',
  'downloads.checkExplainer':
    'Cada juego del servidor se compara con la carpeta en la que se instalaría.',
  'downloads.nothingTransferring': 'No hay transferencias. Elige un juego y pulsa Descargar.',
  'downloads.recent': 'Recientes',
  'downloads.clearFinished': 'Limpiar las terminadas',
  'downloads.cleared_one': '{count} transferencia terminada eliminada',
  'downloads.cleared_other': '{count} transferencias terminadas eliminadas',
  'downloads.sortBy': 'Orden: {mode}',
  'downloads.groupBySystem': 'Agrupar por sistema: {value}',
  'downloads.syncWithDisk': 'Contrastar con el disco',
  'downloads.nothingDownloaded': 'Aún no hay nada descargado. Elige un juego y pulsa Descargar.',
  'downloads.showMore': 'Mostrar {count} más de {total}',
  'downloads.openExpand': 'Abrir · Desplegar',
  'downloads.groupMeta_one': '{count} juego · {size}',
  'downloads.groupMeta_other': '{count} juegos · {size}',
  'downloads.fileCount_one': '{count} archivo',
  'downloads.fileCount_other': '{count} archivos',
  'downloads.syncFound_one': '{count} encontrado en el disco',
  'downloads.syncFound_other': '{count} encontrados en el disco',
  'downloads.syncRemoved_one': '{count} que ya no está',
  'downloads.syncRemoved_other': '{count} que ya no están',
  'downloads.syncUnchanged_one': '{count} juego comprobado — nada ha cambiado',
  'downloads.syncUnchanged_other': '{count} juegos comprobados — nada ha cambiado',
  'downloads.uninstalled': 'Desinstalado',

  'uninstall.title': '¿Desinstalar este juego?',
  'uninstall.body': 'El juego se borrará de {folder}. Tus partidas guardadas en RomM se conservan.',
  'uninstall.freeing': 'Desinstalar y liberar {size}',

  // -- BIOS -----------------------------------------------------------------

  'bios.allInPlace': 'Todos los archivos BIOS que RomMix conoce están en su sitio.',
  'bios.missingSummary_one': 'Falta {count} archivo, {fetchable} de ellos en tu servidor RomM',
  'bios.missingSummary_other': 'Faltan {count} archivos, {fetchable} de ellos en tu servidor RomM',
  'bios.explainer':
    'Los archivos BIOS vienen de tu propio servidor RomM — súbelos allí bajo una plataforma y ' +
    'RomMix los copia al emulador que ejecute esa plataforma. No se descarga nada de ningún otro ' +
    'sitio.',
  'bios.nothingToInstall': 'Nada que instalar',
  'bios.recheck': 'Volver a comprobar',
  'bios.noPlatforms': 'Aún no hay plataformas en tu servidor RomM.',
  'bios.installingTitle': 'Instalando archivos BIOS',
  'bios.workingOut': 'Averiguando qué falta…',
  'bios.progress': '{done} de {total}',
  'bios.checkedAllInPlace': 'Comprobado — todos los archivos BIOS están en su sitio',
  'bios.checkedMissing_one': 'Comprobado — sigue faltando {count} archivo',
  'bios.checkedMissing_other': 'Comprobado — siguen faltando {count} archivos',
  'bios.fileInstalled': '{file} instalado',
  'bios.syncInstalled_one': '{count} instalado',
  'bios.syncInstalled_other': '{count} instalados',
  'bios.syncFailed_one': '{count} fallido',
  'bios.syncFailed_other': '{count} fallidos',
  'bios.syncUnavailable_one': '{count} que no está en el servidor',
  'bios.syncUnavailable_other': '{count} que no están en el servidor',
  'bios.statusUnknown': 'Desconocido',
  'bios.statusMissing_one': 'Falta {count}',
  'bios.statusMissing_other': 'Faltan {count}',
  'bios.statusReady': 'Listo',
  'bios.itemInstalled': 'Instalado',
  'bios.itemRequired': 'Obligatorio',
  'bios.itemOptional': 'Opcional',
  'bios.itemVerified': 'Verificado',
  'bios.uploadedForPlatform': 'Subido a RomM para esta plataforma',
  'bios.notOnServer': 'No está en tu servidor',

  // Qué es cada archivo BIOS, en la línea bajo su nombre.

  'bios.note.scph5500': 'BIOS de PlayStation — Japón',
  'bios.note.scph5501': 'BIOS de PlayStation — Norteamérica',
  'bios.note.scph5502': 'BIOS de PlayStation — Europa',
  'bios.note.sega101': 'BIOS de Saturn — Japón',
  'bios.note.mpr17933': 'BIOS de Saturn — Norteamérica y Europa',
  'bios.note.segaCdU': 'BIOS de Sega CD — Norteamérica',
  'bios.note.segaCdE': 'BIOS de Mega-CD — Europa',
  'bios.note.segaCdJ': 'BIOS de Mega-CD — Japón',
  'bios.note.dcBoot': 'ROM de arranque de Dreamcast',
  'bios.note.dcFlash': 'Flash de Dreamcast, guarda el reloj y la región',
  'bios.note.syscard3': 'PC Engine CD System Card 3',
  'bios.note.neogeo': 'Conjunto de BIOS de Neo Geo',
  'bios.note.neocd': 'BIOS de Neo Geo CD — modelo de carga superior',
  'bios.note.disksys': 'BIOS del Famicom Disk System',
  'bios.note.gbaBios': 'BIOS de Game Boy Advance — mejora la precisión',
  'bios.note.ndsBios7': 'BIOS ARM7 de Nintendo DS',
  'bios.note.ndsBios9': 'BIOS ARM9 de Nintendo DS',
  'bios.note.ndsFirmware': 'Firmware de Nintendo DS',
  'bios.note.prodKeys': 'Claves maestras de la consola — sin ellas no se descifra nada',
  'bios.note.titleKeys': 'Claves por título, para juegos instalados, actualizaciones y DLC',
  'bios.note.panafz10': 'BIOS de 3DO — Panasonic FZ-10',
  'bios.note.lynxboot': 'ROM de arranque de Atari Lynx',
  'bios.note.atari5200': 'BIOS de Atari 5200',
  'bios.note.atari7800': 'BIOS de Atari 7800 — Norteamérica',
  'bios.note.colecovision': 'BIOS de ColecoVision',
  'bios.note.pcfx': 'BIOS de PC-FX',
  'bios.note.x68000Ipl': 'ROM IPL de X68000',
  'bios.note.x68000Cgrom': 'ROM del generador de caracteres de X68000',
  'bios.note.kickstart13': 'Kickstart 1.3 — Amiga 500',
  'bios.note.kickstart31A1200': 'Kickstart 3.1 — Amiga 1200',
  'bios.note.kickstart31Cd32': 'Kickstart 3.1 — CD32',

  // Sistemas cuyo BIOS es más que un archivo que copiar.

  'bios.setup.ps2':
    'La PlayStation 2 necesita un BIOS extraído de una consola real. El nombre del archivo varía ' +
    'según el modelo, así que todo lo que se suba a RomM para esta plataforma se instala tal cual.',
  'bios.setup.ps3': 'La PlayStation 3 necesita su firmware, instalado por el propio RPCS3.',
  'bios.setup.psvita': 'La PlayStation Vita necesita un volcado de firmware instalado por Vita3K.',
  'bios.setup.n3ds':
    'La 3DS necesita sus fuentes compartidas y sus claves AES extraídas de una consola.',
  'bios.setup.switch':
    'La Switch necesita prod.keys y un volcado de firmware sacados de una consola.',
  'bios.setup.wiiu': 'La Wii U necesita claves y un volcado OTP sacados de una consola.',

  // Por qué el BIOS de una plataforma no puede colocarse en absoluto.

  'bios.blockedNoMapping':
    'RomMix no tiene ninguna correspondencia de carpeta para {platform}, así que no sabe qué ' +
    'emulador la ejecuta. Añade una en settings.systemOverrides.',
  'bios.blockedNoEmulator': 'Ningún emulador instalado ejecuta {system}.',
  'bios.blockedNoFolder': 'RomMix no sabe dónde guarda {name} sus archivos BIOS.',

  // -- un juego -------------------------------------------------------------

  'game.fallbackTitle': 'Juego',
  'game.play': 'Jugar',
  'game.running': 'En marcha…',
  'game.resumeDownload': 'Reanudar la descarga ({percent} %)',
  'game.pauseDownload': 'Pausar la descarga ({percent} %)',
  'game.cancelDownload': 'Cancelar la descarga ({percent} %)',
  'game.addFavourite': 'Añadir a favoritos',
  'game.removeFavourite': 'Quitar de favoritos',
  'game.runWith': 'Ejecutar con',
  'game.pullSaves': 'Traer las partidas',
  'game.pushSaves': 'Enviar las partidas',
  'game.openBios': 'Abrir BIOS',
  'setup.dontShowAgain': 'No mostrar esto otra vez',
  'game.readMore': 'Leer más',
  'game.showLess': 'Mostrar menos',
  'game.tabDetails': 'Detalles',
  'game.tabSaves': 'Partidas',
  'game.tabFiles': 'Archivos',
  'game.tabScreenshots': 'Capturas',
  'game.revision': 'Rev. {revision}',
  'game.ratingOutOf': '/ 100',
  'game.runningAsk':
    'El juego está en marcha. RomMix preguntará qué enviar a RomM cuando cierres el emulador.',
  'game.runningAuto':
    'El juego está en marcha. RomMix devolverá tus partidas a RomM cuando cierres el emulador.',
  'game.biosMissing_one':
    '{platform} necesita {files} para arrancar la mayoría de los juegos, y no está instalado.',
  'game.biosMissing_other':
    '{platform} necesita {files} para arrancar la mayoría de los juegos, y no están instalados.',
  'game.biosSetup': '{platform} necesita su BIOS en su sitio antes de que los juegos arranquen.',
  'setup.hidden': 'Pasos de configuración ocultos para {emulator}',
  'game.alreadyDownloaded': 'Ya estaba descargado',
  'game.downloadStarted': 'Descarga iniciada',
  'game.downloadQueued': 'Añadido a la cola',
  'game.couldNotStart': 'El juego no ha podido arrancar',
  'game.sessionEnded': 'Sesión terminada',
  'game.sessionPending_one': 'Sesión terminada — {count} archivo por enviar',
  'game.sessionPending_other': 'Sesión terminada — {count} archivos por enviar',
  'game.sessionSent_one': 'Sesión terminada — {count} partida enviada a RomM',
  'game.sessionSent_other': 'Sesión terminada — {count} partidas enviadas a RomM',
  'game.favouriteAdded': 'Añadido a favoritos en RomM',
  'game.favouriteRemoved': 'Quitado de favoritos',

  // Las cuatro preguntas antes de algo que no tiene vuelta atrás.

  'game.variantTitle': '¿Cómo deben ejecutarse los juegos de {system}?',
  'game.variantBody':
    '{emulator} ofrece varios. Recordado para {system} — cámbialo luego con Ejecutar con',
  'game.deleteSaveTitle': '¿Borrar esta partida?',
  'game.deleteStateTitle': '¿Borrar este estado?',
  'game.deleteAssetBody': '{file} — {location}',
  'game.deleteOnlyCopy': 'Es la única copia.',
  'game.deleteAt': 'Borrar {where}',
  'game.pushTitle_one': '¿Enviar {count} archivo a RomM?',
  'game.pushTitle_other': '¿Enviar {count} archivos a RomM?',
  'game.pushUploadedAs': 'Subido como {device}.',
  'game.pushSend': 'Enviar a RomM',
  'game.pushSendNoAsk': 'Enviar y no volver a preguntar',

  // -- lo que un envío está a punto de mandar -------------------------------

  'push.folderAsZip': 'carpeta, enviada como un único zip',
  'push.replaces': '{local} → RomM {remote}',
  'push.replacesFrom': '{local} → RomM {remote} · desde {device}',
  'push.sendsNew': '{local} → nuevo en RomM',
  'push.thisDevice': 'este dispositivo',
  'push.anotherDevice': 'otro dispositivo',
  'push.andMore_one': 'y {count} archivo más.',
  'push.andMore_other': 'y {count} archivos más.',

  // -- partidas guardadas ---------------------------------------------------

  'asset.save': 'Partida',
  'asset.state': 'Estado',

  'saves.synced': 'Sincronizada',
  'saves.syncedHint': 'Este dispositivo y RomM tienen el mismo archivo.',
  'saves.localNewer': 'Más reciente aquí',
  'saves.localNewerHint': 'Jugado desde la última subida. Enviar las partidas la mandará.',
  'saves.localOnly': 'No está en RomM',
  'saves.localOnlyHint': 'Solo en este dispositivo. Enviar las partidas la mandará.',
  'saves.unchecked': 'En este dispositivo',
  'saves.uncheckedHint':
    'En este dispositivo. No se ha podido preguntar a RomM, así que nada dice aquí si tiene este archivo.',
  'saves.remoteNewer': 'Más reciente en RomM',
  'saves.remoteNewerHint': 'RomM tiene una copia más reciente. Traer las partidas la bajará.',
  'saves.remoteOnly': 'No está en este dispositivo',
  'saves.remoteOnlyHint': 'Solo en RomM. Traer las partidas la bajará.',
  'saves.fromDevice': 'desde {device}',
  'saves.scopeLocal': 'de este dispositivo',
  'saves.scopeRemote': 'de RomM',
  'saves.empty': 'No hay partidas de este juego, ni aquí ni en RomM.',
  'saves.emptyPlayIt': 'Juega una vez y su partida aparecerá aquí.',
  'saves.nothingNewer': 'No hay nada más reciente en RomM',
  'saves.noLocalSaves': 'No hay partidas locales que enviar',
  'saves.allInSync': 'RomM ya tiene todas las partidas de este dispositivo',
  'saves.pulled_one': '{count} archivo descargado',
  'saves.pulled_other': '{count} archivos descargados',
  'saves.pushed_one': '{count} archivo enviado a RomM',
  'saves.pushed_other': '{count} archivos enviados a RomM',
  'saves.nothingSent': 'No se ha enviado nada',
  'saves.noAskAgain': 'Las partidas se enviarán sin preguntar',
  'saves.deleted': '{file} borrado {where}',
  // -- lo que un emulador concreto no puede sincronizar, y lo que le falta ----
  'saves.retrodeckPcsx2':
    'RetroDECK da a PCSX2 una sola tarjeta de memoria compartida por todos los juegos de PS2, así que no hay ninguna partida guardada que pertenezca a este. Los estados guardados sí se sincronizan.',
  'saves.retrodeckDuckstation':
    'RetroDECK da a DuckStation una sola tarjeta de memoria compartida por todos los juegos de PS1, así que no hay ninguna partida guardada que pertenezca a este. Los estados guardados sí se sincronizan.',
  'saves.pcsx2':
    'PCSX2 mantiene una sola tarjeta de memoria compartida por todos los juegos de PS2, así que no hay ninguna partida guardada que pertenezca a este. Los estados guardados sí se sincronizan.',
  'saves.dolphin':
    'Dolphin mantiene una tarjeta de memoria de GameCube por región y una sola NAND de Wii para todos los juegos, así que no hay ninguna partida guardada que pertenezca a este. Los estados guardados sí se sincronizan.',
  'saves.primehack':
    'PrimeHack mantiene una sola tarjeta de memoria para todos los juegos, así que no hay ninguna partida guardada que pertenezca a este. Los estados guardados sí se sincronizan.',
  'saves.ppsspp':
    'PPSSPP archiva las partidas bajo el identificador de juego impreso dentro de la imagen de disco en lugar del nombre de la ROM, y RomMix no puede leerlo desde fuera del emulador.',
  'saves.rpcs3':
    'RPCS3 archiva las partidas bajo el identificador de título de PS3 en lugar del nombre de la ROM, que RomMix no puede asociar a este juego.',
  'saves.cemu':
    'Cemu archiva las partidas bajo el identificador de título de Wii U en lugar del nombre de la ROM, que RomMix no puede asociar a este juego.',
  'saves.vita3k':
    'Vita3K archiva las partidas bajo el identificador de título de Vita en lugar del nombre de la ROM, que RomMix no puede asociar a este juego.',
  'saves.xenia':
    'Xenia archiva las partidas bajo el identificador de título de Xbox 360 en lugar del nombre de la ROM, que RomMix no puede asociar a este juego.',
  'saves.flycast':
    'Flycast mantiene dos tarjetas de memoria VMU compartidas por todos los juegos de Dreamcast, así que no hay ninguna partida guardada que pertenezca a este. Los estados guardados sí se sincronizan.',
  'saves.xemu':
    'xemu mantiene un solo disco duro de Xbox emulado para todos los juegos, así que no hay ninguna partida guardada que pertenezca a este.',
  'saves.xroar': 'XRoar no escribe partidas en batería; solo se sincronizan sus estados.',
  'saves.azahar':
    'Azahar guarda las partidas dentro de un árbol de tarjeta SD emulada indexado por identificador de título, que RomMix no puede asociar a este juego.',
  'saves.azaharStates':
    'Azahar guarda las partidas dentro de un árbol de tarjeta SD emulada indexado por identificador de título, que RomMix no puede asociar a este juego. Los estados guardados sí se sincronizan.',
  'saves.shadps4NoData': 'RomMix no ha encontrado dónde guarda shadPS4 sus datos de partida.',
  'saves.shadps4NoSerial':
    'Este juego no indica ningún número de serie de PS4, así que RomMix no puede saber cuál de las carpetas de guardado de shadPS4 es la suya.',
  'setup.edenRoms': 'Añade la carpeta de ROM de RomMix a Eden: File → Game Directories.',
  'setup.edenFirmware':
    'Instala el firmware en Eden: Tools → Install Firmware. Las claves se copian por ti.',
  'setup.edenControls': 'Configura tu mando en Eden: Emulation → Configure → Controls.',
  'setup.edenExitConfirm':
    'Desactiva la confirmación de salida de Eden: Emulation → Configure → General → Confirm ' +
    'exit while emulation is running.',
  'setup.edenStaging':
    'Instala el firmware en Eden: Tools → Install Firmware, apuntando al archivo de abajo.',
  'setup.shadps4Roms':
    'Añade la carpeta de ROM de RomMix a shadPS4, para que su lista de juegos encuentre lo que descargas.',

  'saves.switchNoTitleId':
    'RomMix no ha podido leer un identificador de título para este juego, que es con lo que ' +
    '{emulator} nombra su carpeta de partidas. Una ROM que lleve su identificador de título en el ' +
    'nombre del archivo, o un NSP o XCI sin modificar, se resuelve sola.',
  'saves.switchNoProfile':
    '{emulator} aún no tiene ningún perfil de usuario, así que una partida no tiene adónde ir. ' +
    'Ábrelo una vez y crea un perfil.',

  // -- los detalles de un juego ---------------------------------------------

  'details.company': 'Empresa',
  'details.series': 'Saga',
  'details.released': 'Lanzamiento',
  'details.players': 'Jugadores',
  'details.modes': 'Modos',
  'details.languages': 'Idiomas',
  'details.tags': 'Etiquetas',
  'details.lastPlayed': 'Última partida',
  'details.installedTo': 'Instalado en',
  'details.systemFolder': 'Carpeta del sistema',
  'details.downloadedFor': 'Descargado para',
  'details.onDisk': 'En el disco',
  'details.downloaded': 'Descargado',
  'details.romMixFolder': 'La carpeta propia de RomMix',
  'details.empty': 'RomM no sabe nada más sobre este juego.',

  'files.tagBoth': 'Ambos',
  'files.tagServer': 'RomM',
  'files.tagDevice': 'Dispositivo',
  'files.hintBoth': 'En el servidor y en este dispositivo.',
  'files.hintServer': 'Solo en el servidor. Descarga el juego para tenerlo.',
  'files.hintDevice': 'Solo en este dispositivo. RomM no lo lista.',
  'files.empty':
    'RomM no lista ningún archivo de este juego, y en este dispositivo no hay ninguno.',
  'shots.empty': 'RomM no tiene capturas de este juego.',
  'shots.view': 'Ver',
  'shots.previous': 'Captura anterior',
  'shots.next': 'Captura siguiente',
  'shots.position': '{index} de {total}',

  // -- ajustes --------------------------------------------------------------

  'settings.tabGeneral': 'General',
  'settings.tabGames': 'Juegos',
  'settings.tabSystem': 'Sistema',

  'settings.server': 'Servidor',
  'settings.address': 'Dirección',
  'settings.signedInAs': 'Sesión iniciada como',
  'settings.rommVersion': 'Versión de RomM',
  'settings.disconnect': 'Desconectar',
  'settings.disconnected': 'Desconectado de RomM',
  'settings.interface': 'Interfaz',
  'settings.sounds': 'Sonidos de navegación',
  'settings.soundsHint':
    'Un clic discreto cuando se mueve la selección, al elegir y al volver atrás.',
  'settings.scaleHint': 'Auto sigue a la pantalla: el doble de grande en un televisor 4K.',
  'settings.language': 'Idioma',
  'settings.languageHint': 'Auto sigue el idioma configurado en esta máquina.',
  'settings.dateFormat': 'Formato de fecha',
  'settings.dateFormatHint':
    'Cómo se escribe cada fecha — {example}. La hora siempre es de 24 horas.',
  'settings.date.dmy': 'Día primero',
  'settings.date.mdy': 'Mes primero',
  'settings.date.iso': 'ISO 8601',
  'settings.date.language': 'Seguir el idioma',
  'settings.support': 'Apoyar a RomMix',
  'settings.supportBody':
    'RomMix es gratis y siempre lo será. Si te ha ahorrado una tarde cableando emuladores, puedes ' +
    'invitarme a un café.',
  'settings.buyCoffee': 'Invitarme a un café',
  'settings.scanOrOpen': 'Escanea esto con el móvil, o ábrelo en un navegador de esta máquina.',
  'settings.application': 'Aplicación',
  'settings.toggleFullscreen': 'Alternar pantalla completa',

  'settings.gamesOnDisk': 'Juegos en el disco',
  'settings.storageToRomMix':
    'Las descargas nuevas van a la carpeta de RomMix — indícasela a cada emulador',
  'settings.storageToEmulator': 'Las descargas nuevas van a la carpeta propia de cada emulador',
  'settings.sharedFolderNote':
    'Los juegos se escriben en {path}/roms/<sistema>. Los juegos ya descargados en la carpeta ' +
    'propia de un emulador se quedan ahí y se vuelven a ofrecer para descarga; vuelve atrás y ' +
    'reaparecen.',
  'settings.saveSync': 'Sincronización de partidas',
  'settings.syncDown': 'Descargar las partidas más recientes antes de jugar',
  'settings.syncDownHint':
    'Solo cuando sean estrictamente más recientes. El archivo local se conserva como *.rommix-bak.',
  'settings.syncUp': 'Subir las partidas después de jugar',
  'settings.syncUpHint': 'Solo se envía lo que la sesión haya escrito.',
  'settings.confirmPush': 'Preguntar antes de enviar partidas a RomM',
  'settings.confirmPushHint': 'Muestra lo que se va a enviar antes de enviarlo.',
  'settings.confirmUninstall': 'Preguntar antes de borrar un juego descargado',
  'settings.confirmUninstallHint':
    'Desinstalar está a una pulsación de A de borrar un archivo de varios gigabytes.',

  'emulators.explainer':
    'Lo que RomMix ha encontrado en esta máquina, y cuántas plataformas cubre cada uno. El orden ' +
    'es la preferencia: una plataforma sin elección propia la ejecuta el primer emulador de esta ' +
    'lista que esté instalado y la cubra, así que subir uno lo convierte en el predeterminado ' +
    'para todo lo que sepa ejecutar. Las plataformas que hayas configurado una a una más abajo no ' +
    'se ven afectadas.',
  'emulators.platforms': 'Plataformas',
  'emulators.platformsExplainer':
    'Qué emulador ejecuta cada plataforma de tu biblioteca. Cada plataforma parte de un valor ' +
    'predeterminado sacado de lo que estos emuladores suelen manejar; cambia uno y RomMix usará tu ' +
    'elección solo para esa plataforma, y lo dirá en vez de sustituirla en silencio si falta.',

  // -- un emulador ----------------------------------------------------------

  'emulator.notChecked': 'Sin comprobar',
  'emulator.installed': 'Instalado',
  'emulator.needsSetup': 'Falta configurarlo',
  'emulator.notInstalled': 'No instalado',
  'emulator.kindFlatpak': 'Flatpak',
  'emulator.kindBinary': 'Programa',
  'emulator.kindAppImage': 'AppImage',
  'emulator.kindScripts': 'Lanzadores',
  'emulator.groupGeneral': 'General',
  'emulator.groupFolders': 'Carpetas',
  'emulator.platforms_one': '{count} plataforma',
  'emulator.platforms_other': '{count} plataformas',
  'emulator.homepage': 'Web',
  'emulator.home': 'Raíz',
  'emulator.roms': 'Roms',
  'emulator.saves': 'Partidas',
  'emulator.bios': 'Bios',
  'emulator.notFound': 'no encontrada',
  'emulator.setByYou': '(fijada por ti)',
  'emulator.homeFolder': 'Carpeta raíz',
  'emulator.homeFolderHint':
    'Las roms, partidas, estados y BIOS se leen dentro de esta carpeta. Déjala vacía para volver ' +
    'a buscarla automáticamente.',
  'emulator.useThisFolder': 'Usar esta carpeta',
  'emulator.changeVersion': 'Cambiar de versión',
  'emulator.run': 'Ejecutar',
  'emulator.movedUp': '{name} ha subido',
  'emulator.movedDown': '{name} ha bajado',
  'emulator.rootSet': '{name} se leerá desde {path}',
  'emulator.rootCleared': 'La carpeta de {name} vuelve a encontrarse automáticamente',
  'emulator.installedTitle': '{name} está instalado',
  'emulator.setupTitle': 'Configurar {name}',
  'emulator.setupSteps': 'Pasos de configuración',
  'emulator.setupIntro':
    'Lo que queda pasa dentro del propio {name} — RomMix no puede hacerlo desde fuera ni ' +
    'comprobar que se ha hecho:',
  'emulator.installedToast': '{name} instalado',
  'emulator.installingFlathub': 'Instalando desde Flathub',
  'emulator.contactingFlathub': 'Contactando con Flathub…',
  'emulator.installTitle': 'Instalar {name}',
  'emulator.fromFlathub': '{appId}, desde Flathub',
  'emulator.buildIntoRomMix': 'la compilación que elijas, en la carpeta propia de RomMix',
  'emulator.manualInstall': '{name} hay que instalarlo a mano.',
  'emulator.manualInstallFrom': '{name} hay que instalarlo a mano, desde {homepage}.',
  'emulator.reasonNotInstalled': '{name} no está instalado.',
  'emulator.reasonNotRun': '{name} no se ha ejecutado nunca, así que sus carpetas no existen.',

  'platforms.connectFirst': 'Conéctate a RomM para ver las plataformas de tu biblioteca.',
  'platforms.noneCovers': 'Ningún emulador la cubre',
  'platforms.noneInstalled': 'Ninguno instalado',
  'platforms.meta_one': '{system} · {count} juego',
  'platforms.meta_other': '{system} · {count} juegos',
  'platforms.default': '(predeterminado)',

  // -- elegir una compilación que instalar ----------------------------------

  'install.installing': 'Instalando {name}',
  'install.title': 'Instalar {name}',
  'install.noBuilds': 'No se ha publicado ninguna compilación para esta máquina.',
  'install.whichVersion': '¿Qué versión?',
  'install.publishedAt': 'Publicado en {url}.',
  'install.latest': 'La más reciente',
  'install.prerelease': 'Versión previa',
  'install.noDate': 'sin fecha de publicación',
  'install.builds_one': '{count} compilación para esta máquina',
  'install.builds_other': '{count} compilaciones para esta máquina',
  'install.chooseVersion': 'Elegir esta versión',
  'install.chooseBuild': 'Instalar esta compilación',
  'install.whichBuild':
    '¿Qué compilación? Elige la que encaje con tu hardware — en la duda, el nombre más simple es ' +
    'el de uso general.',
  'install.otherVersions': 'Otras versiones',

  // -- las actualizaciones del propio RomMix --------------------------------

  'update.label': 'Nuevas versiones de RomMix',
  'update.policyAuto': 'Automático',
  'update.policyNotify': 'Avísame',
  'update.policyOff': 'Desactivado',
  'update.hintAuto':
    'Las nuevas versiones se descargan en segundo plano y se usan la próxima vez que RomMix ' +
    'arranque.',
  'update.hintNotify':
    'RomMix avisa cuando se publica una versión nueva y espera a que tú la descargues.',
  'update.hintOff': 'RomMix nunca mira por su cuenta. El botón de abajo sí.',
  'update.prereleases': 'Versiones candidatas',
  'update.prereleasesHint':
    'Ofrecer también las versiones publicadas para probar, etiquetadas como 1.0.0-rc.1. ' +
    'Llegan antes que una versión terminada y se han usado menos.',
  'update.installed': 'Instalada',
  'update.newestPublished': 'Última publicada',
  'update.checking': 'comprobando…',
  'update.notCheckedYet': 'aún sin comprobar',
  'update.lastChecked': 'Última comprobación',
  'update.available': 'RomMix {version} está disponible.',
  'update.availableBlocked': 'Descárgalo desde la página de versiones.',
  'update.availableAuto': 'Se está descargando ahora.',
  'update.availableManual': 'Descárgalo cuando te venga bien — no se baja nada hasta que lo hagas.',
  'update.downloadingLine': 'Descargando RomMix {version}: {size}',
  'update.ready': 'RomMix {version} está listo.',
  'update.readyDefault': 'Se usará la próxima vez que RomMix arranque, o ahora mismo si reinicias.',
  'update.upToDate': 'RomMix está al día.',
  'update.checkNow': 'Comprobar ahora',
  'update.downloadVersion': 'Descargar {version}',
  'update.downloadAction': 'Descargar la nueva versión',
  'update.restartNow': 'Reiniciar ahora',
  'update.releasesPage': 'Página de versiones',
  'update.newest': 'RomMix {version} es la versión más reciente',
  'update.steamBlocked':
    'Steam ha iniciado RomMix, y no deja que un programa se reinicie a sí mismo. Sal de RomMix y ' +
    'vuelve a pulsar Jugar — la nueva versión ya está en su sitio.',
  'update.noBuildForMachine':
    'La versión {version} no tiene ninguna compilación para esta máquina ({arch}).',
  'update.noVersionTag': 'La versión más reciente no tiene etiqueta de versión',
  'update.nothingToDownload': 'No hay ninguna versión nueva que descargar',
  'update.nothingToRestartInto': 'No hay ninguna versión descargada a la que reiniciar',
  'update.devBuild': 'Esto es una compilación de desarrollo, RomMix no la reemplazará.',
  'update.notAppImage':
    'RomMix no se ha iniciado desde una AppImage, así que no puede reemplazarse a sí mismo. ' +
    'Descarga la nueva versión desde la página de versiones.',
  'update.cannotWrite':
    'RomMix no puede escribir en {dir}, así que no puede reemplazarse allí. Mueve la AppImage a ' +
    'un sitio que sea tuyo, o descarga la nueva versión desde la página de versiones.',
  'update.noRoom': 'No queda sitio suficiente en {dir} para la nueva versión.',
  'update.githubResponded': 'GitHub respondió {status}',
  'update.downloadFailed': 'Descarga fallida: {url} respondió {status}',

  // -- la instalación en sí -------------------------------------------------

  'system.updates': 'Actualizaciones',
  'system.romMixFolder': 'Carpeta de RomMix',
  'system.folderExplainer':
    'Los ajustes, las credenciales, el índice de descargas y cualquier emulador que RomMix haya ' +
    'instalado. Mueve esta carpeta para mover toda la instalación.',
  'system.folder': 'Carpeta',
  'system.folderHintEnv': 'Fijada por ROMMIX_HOME, que manda sobre cualquier cosa elegida aquí.',
  'system.folderHint':
    'Los ajustes se copian a la nueva carpeta; los emuladores y las ROM se quedan donde están.',
  'system.moveAndRestart': 'Mover y reiniciar',
  'system.folderMoved': 'Carpeta de RomMix movida — reiniciando',
  'system.preflight': 'Comprobación previa',
  'system.flatpakAvailable': 'Flatpak disponible',
  'system.flathubSetUp': 'Flathub configurado',
  'system.flathubOnFirstInstall': 'no — se añade en la primera instalación',
  'system.emulatorsInstalled': 'Emuladores instalados',
  'system.countOf': '{count} de {total}',
  'system.romsWritable': 'Carpetas de ROM con permiso de escritura',
  'system.controller': 'Mando',
  'system.noController': 'ninguno detectado — pulsa uno de sus botones',
  'system.logFile': 'Archivo de registro',
  'system.allReady': 'Todo parece listo para jugar.',
  'system.rerunCheck': 'Repetir la comprobación',
  'system.checkedReady': 'Comprobado — todo parece listo para jugar',
  'system.checkedProblems_one': 'Comprobado — {count} cosa por resolver',
  'system.checkedProblems_other': 'Comprobado — {count} cosas por resolver',

  'change.title': '¿Cambiar el emulador que ejecuta esto?',
  'change.body': 'Cada emulador guarda sus propios archivos, y al cambiar no se mueve ninguno:',
  'change.bios': 'Los archivos BIOS habrá que instalarlos otra vez para el nuevo emulador.',
  'change.gamesShared':
    'Los juegos se quedan donde están — están en la carpeta propia de RomMix, la que le indicas a ' +
    'cada emulador.',
  'change.gamesPerEmulator':
    'Los juegos descargados se quedan en la carpeta del emulador antiguo y habrá que descargarlos ' +
    'otra vez.',
  'change.saves':
    'Las partidas viven en el árbol del emulador antiguo. Tráelas desde RomM después del cambio.',
  'change.confirm': 'Cambiarlo',
  'change.confirmNoAsk': 'Cambiarlo y no volver a preguntar',

  // -- lo que informa la comprobación previa --------------------------------

  'diagnostics.noFlatpak':
    'flatpak no está instalado, así que RomMix no puede encontrar ni instalar los emuladores que ' +
    'se distribuyen así. Instálalo desde tu distribución y repite esta comprobación.',
  'diagnostics.noFlathub':
    'Flathub no está configurado para tu usuario, así que todavía no hay de dónde instalar los ' +
    'emuladores flatpak. RomMix lo añade la primera vez que instalas uno, o puedes añadirlo tú ' +
    'con: flatpak remote-add --user --if-not-exists flathub ' +
    'https://dl.flathub.org/repo/flathub.flatpakrepo',
  'diagnostics.noEmulatorSuggest':
    'No se ha encontrado ningún emulador. Instala {name}, que cubre la mayoría de los sistemas, ' +
    'desde la sección Emuladores de arriba.',
  'diagnostics.noEmulator':
    'No se ha encontrado ningún emulador. Instala uno desde la sección Emuladores de arriba.',
  'diagnostics.romsNotWritable':
    'La carpeta de ROM de {name}, {path}, no admite escritura. Comprueba sus permisos, o que la ' +
    'unidad en la que está esté montada.',
  'diagnostics.sharedFolder':
    'Los juegos se descargan en {path}. Añade esa carpeta a los directorios de juegos de cada ' +
    'emulador, o no listarán lo que RomMix haya descargado.',

  // -- los fallos que informa el proceso principal --------------------------

  'error.serverAddressEmpty': 'La dirección del servidor está vacía',
  'error.noServerConfigured': 'No hay ningún servidor RomM configurado',
  'error.cannotReach': 'No se puede llegar a {url}: {reason}',
  'error.serverTimedOut': 'El servidor RomM en {url} no ha respondido a tiempo.',
  'error.notAuthorised': 'No autorizado — inicia sesión otra vez',
  'error.permissionDenied': 'Permiso denegado: {detail}',
  'error.rommReturned': 'RomM respondió {status}: {detail}',
  'error.wrongCredentials': 'Usuario o contraseña incorrectos',
  'error.sessionExpired': 'Sesión caducada — inicia sesión otra vez',
  'error.downloadInterrupted':
    'La transferencia desde RomM se interrumpió una y otra vez, tras {received} de {total}',
  'error.unsafeName': '{name} no es un nombre que RomMix vaya a escribir en el disco.',
  'error.downloadNotPublished':
    '{name} no es el archivo que se publicó. Se ha eliminado en lugar de instalarlo.',
  'error.downloadCorrupt':
    'Lo que ha llegado no es el archivo que RomM tiene, así que se ha descartado',
  'error.emptyResponseBody': 'RomM ha devuelto un cuerpo de respuesta vacío',
  'error.emptyAssetBody': 'Cuerpo de archivo vacío',
  'error.credentialsRequired': 'El usuario y la contraseña son obligatorios',
  'error.tokenRequired': 'Hace falta un token de API',
  'error.couldNotSignIn': 'No se ha podido iniciar sesión',

  'error.notDownloadedForEmulator':
    'Esa ROM no está descargada para el emulador que usa esta plataforma',
  'error.notDownloadedYet': 'Esa ROM todavía no está descargada',
  'error.downloadedForOther':
    'Esta copia se descargó para otro emulador. Descárgala otra vez para el que usa ahora esta ' +
    'plataforma.',
  'error.noEmulatorForSystem': 'Ningún emulador instalado puede ejecutar «{system}».',
  'error.noEmulatorInstallOne':
    'Ningún emulador instalado puede ejecutar «{system}». Instala {name} y vuelve a intentarlo.',
  'error.noFolderMapping':
    'RomMix no sabe a qué carpeta corresponde «{platform}». Añade una correspondencia para ' +
    '«{slug}» en settings.systemOverrides.',
  'error.noRomFolder': 'RomMix no sabe dónde guarda {name} sus juegos',

  'error.unknownEmulator': 'RomMix no conoce ningún emulador llamado {id}',
  'error.emulatorNotInstalled': '{name} no está instalado',
  'error.cannotInstall': 'RomMix no puede instalar {name} por ti',
  'error.assetNotRunnable': '{asset} no es algo que RomMix pueda ejecutar',
  'error.assetWrongArch': '{asset} no está compilado para esta máquina ({arch})',
  'error.notAFlatpak': '{name} no se distribuye como flatpak',

  'error.rootMustBeAbsolute': 'La carpeta de RomMix debe ser una ruta absoluta',
  'error.romMixHomeSet':
    'ROMMIX_HOME está definida, y manda sobre la carpeta elegida aquí. Quítala y reinicia RomMix ' +
    'para mover la carpeta desde Ajustes.',
  'error.onlyWebAddresses': 'RomMix solo abre direcciones web',

  'error.biosListFailed': 'No se pueden leer los archivos BIOS del servidor: {reason}',
  'error.biosGone': 'Ese archivo BIOS ya no está en el servidor',
  'error.biosNowhere': 'RomMix no tiene dónde poner ese archivo BIOS',

  'error.assetGone': '{file} ya no está ahí para borrarlo',
  'error.assetNotLocal': '{file} no está en este dispositivo para borrarlo',
  'error.assetNotRemote': '{file} no está en RomM para borrarlo',

  'error.cannotOpenArchive': 'No se puede abrir el archivo comprimido',
  'error.badZipEntry': 'Entrada de zip incorrecta',
  'error.releasesResponded': '{api} respondió {status}',
  'error.assetDownloadFailed': 'Descarga fallida: {url} respondió {status}',
  'error.noAppImageInArchive': '{archive} no contiene ninguna AppImage',

  // -- arrancar un juego ----------------------------------------------------

  'launch.installingCore': 'Instalando el núcleo {core}…',
  'launch.installingCorePercent': 'Instalando el núcleo {core}… {percent} %',
  'launch.alreadyRunning': 'Ya hay un juego en marcha',
  'launch.cannotRunSystem':
    '{emulator} no puede ejecutar «{system}». Elige otro emulador para esta plataforma en Ajustes, ' +
    'o instala uno que la cubra.',
  'launch.launcherMissing':
    '{emulator} no tiene ningún lanzador instalado para «{system}». Añade uno desde {emulator}, o ' +
    'elige otro emulador para esta plataforma en Ajustes.',
  'launch.stoppedBeforeStart': 'Detenido antes de que el juego arrancara',
  'launch.syncWarning': 'Aviso de sincronización de partidas: {details}',
  'launch.couldNotStartEmulator': 'No se ha podido arrancar el emulador: {reason}',
  'launch.couldNotStartNamed': 'No se ha podido arrancar {name}: {reason}',
  'launch.emulatorReported': 'El emulador ha informado: {detail}',
  'launch.quitImmediatelyDetail': 'El emulador se cerró de inmediato: {detail}',
  'launch.quitImmediately': 'El emulador se cerró de inmediato.',
  'launch.quitImmediatelyCode': 'El emulador se cerró de inmediato (código {code}).',
  'launch.emulatorQuitDetail': '{name} se cerró de inmediato: {detail}',
  'launch.emulatorQuitCode': '{name} se cerró de inmediato (código {code}).',

  'core.noneForMachine':
    'No hay ningún núcleo {core} publicado para esta máquina. Instálalo desde el Online Updater ' +
    'del propio emulador.',
  'core.downloadFailed': 'No se ha podido descargar el núcleo {core}: {url} respondió {status}',
  'core.missingFile': 'La descarga de {core} no contenía {file}',

  'host.addingFlathub': 'Añadiendo el repositorio de Flathub…',
  'host.flathubFailed':
    'No se ha podido añadir el repositorio de Flathub. Añádelo a mano con:  flatpak remote-add ' +
    '--user --if-not-exists {remote} {repo}',
  'host.suspiciousAppId': 'Instalación rechazada por un identificador de app sospechoso: {appId}',
  'host.flatpakFailed': 'No se ha podido ejecutar flatpak: {reason}'
}
