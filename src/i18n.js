// -----------------------------------------------------------------------------
// Runtime texts, in the four languages of the Gladys UI.
//
// `t(key, vars)` returns a multi-language object `{ en, fr, de, es }`
// (configuration button, widgets, connection status); `text(key, language,
// vars)` returns one string (feature and device names, scene action errors:
// Gladys does not send the language of the user with a scan, a command or a
// scene action, see `language` in config.js). `number(value, digits)` formats
// a number the way each language writes it (1 234,5 / 1,234.5).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

const MESSAGES = {
  // --- Feature and device names -------------------------------------------------
  feature_state: {
    en: 'On / off',
    fr: 'Marche / arrêt',
    de: 'Ein / aus',
    es: 'Encendido / apagado',
  },
  feature_position: { en: 'Position', fr: 'Position', de: 'Position', es: 'Posición' },
  feature_power: { en: 'Power', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },
  feature_voltage: { en: 'Voltage', fr: 'Tension', de: 'Spannung', es: 'Tensión' },
  feature_current: { en: 'Current', fr: 'Intensité', de: 'Stromstärke', es: 'Intensidad' },
  feature_energy: {
    en: 'Energy consumed',
    fr: 'Énergie consommée',
    de: 'Verbrauchte Energie',
    es: 'Energía consumida',
  },
  feature_returned: {
    en: 'Energy returned',
    fr: 'Énergie renvoyée',
    de: 'Zurückgespeiste Energie',
    es: 'Energía devuelta',
  },
  nameOutput: { en: 'output {id}', fr: 'sortie {id}', de: 'Ausgang {id}', es: 'salida {id}' },
  nameCover: { en: 'shutter {id}', fr: 'volet {id}', de: 'Rollladen {id}', es: 'persiana {id}' },

  // --- Connection status (Integrations page) -----------------------------------
  statusConnected: {
    en: '{count} of {total} Refoss device(s) connected.',
    fr: '{count} appareil(s) Refoss sur {total} connecté(s).',
    de: '{count} von {total} Refoss-Gerät(en) verbunden.',
    es: '{count} de {total} dispositivo(s) Refoss conectado(s).',
  },
  statusNone: {
    en: 'No Refoss device found yet. Type the address of the older models (R10, EM06, EM16) in the configuration.',
    fr: 'Aucun appareil Refoss trouvé pour l’instant. Saisissez l’adresse des anciens modèles (R10, EM06, EM16) dans la configuration.',
    de: 'Noch kein Refoss-Gerät gefunden. Geben Sie die Adresse der älteren Modelle (R10, EM06, EM16) in der Konfiguration ein.',
    es: 'Aún no se ha encontrado ningún dispositivo Refoss. Escriba la dirección de los modelos antiguos (R10, EM06, EM16) en la configuración.',
  },
  statusAllOff: {
    en: 'No Refoss device answers: powered and on the network?',
    fr: 'Aucun appareil Refoss ne répond : alimenté et sur le réseau ?',
    de: 'Kein Refoss-Gerät antwortet: Strom und Netzwerk vorhanden?',
    es: 'Ningún dispositivo Refoss responde: ¿alimentado y en la red?',
  },
  statusPassword: {
    en: '{name} is protected by a password: type it in the configuration.',
    fr: '{name} est protégé par un mot de passe : saisissez-le dans la configuration.',
    de: '{name} ist durch ein Passwort geschützt: Geben Sie es in der Konfiguration ein.',
    es: '{name} está protegido con contraseña: escríbala en la configuración.',
  },
  statusWrongPassword: {
    en: '{name} refuses the password of the configuration.',
    fr: '{name} refuse le mot de passe de la configuration.',
    de: '{name} lehnt das Passwort der Konfiguration ab.',
    es: '{name} rechaza la contraseña de la configuración.',
  },
  statusScanForbidden: {
    en: 'Gladys refused the network search: reinstall the integration and accept its network discovery, or type the addresses of your devices.',
    fr: 'Gladys a refusé la recherche réseau : réinstallez l’intégration en acceptant sa découverte réseau, ou saisissez l’adresse de vos appareils.',
    de: 'Gladys hat die Netzwerksuche abgelehnt: Installieren Sie die Integration neu und erlauben Sie die Netzwerkerkennung, oder geben Sie die Adressen Ihrer Geräte ein.',
    es: 'Gladys rechazó la búsqueda en la red: reinstale la integración aceptando su detección de red, o escriba las direcciones de sus dispositivos.',
  },

  // --- Configuration button ----------------------------------------------------
  testOk: {
    en: '{count} device(s) found: {list}.',
    fr: '{count} appareil(s) trouvé(s) : {list}.',
    de: '{count} Gerät(e) gefunden: {list}.',
    es: '{count} dispositivo(s) encontrado(s): {list}.',
  },
  testNone: {
    en: 'No Refoss device found. Check that it is on the same network as Gladys; for an R10, EM06 or EM16, type its address in the configuration.',
    fr: 'Aucun appareil Refoss trouvé. Vérifiez qu’il est sur le même réseau que Gladys ; pour un R10, un EM06 ou un EM16, saisissez son adresse dans la configuration.',
    de: 'Kein Refoss-Gerät gefunden. Prüfen Sie, ob es im selben Netzwerk wie Gladys ist; bei einem R10, EM06 oder EM16 geben Sie seine Adresse in der Konfiguration ein.',
    es: 'No se ha encontrado ningún dispositivo Refoss. Compruebe que está en la misma red que Gladys; para un R10, EM06 o EM16, escriba su dirección en la configuración.',
  },
  testFirmware: { en: 'firmware', fr: 'micrologiciel', de: 'Firmware', es: 'firmware' },
  testChannels: {
    en: '{count} channel(s)',
    fr: '{count} canal(aux)',
    de: '{count} Kanal/Kanäle',
    es: '{count} canal(es)',
  },
  testUnreachable: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  testPassword: {
    en: 'password needed',
    fr: 'mot de passe requis',
    de: 'Passwort nötig',
    es: 'contraseña necesaria',
  },
  testWrongPassword: {
    en: 'wrong password',
    fr: 'mot de passe refusé',
    de: 'falsches Passwort',
    es: 'contraseña incorrecta',
  },

  // --- Errors (scene actions, commands) ----------------------------------------
  errorUnknownDevice: {
    en: 'This Refoss device is not known (yet): run a search in the Discover tab.',
    fr: 'Cet appareil Refoss n’est pas (encore) connu : lancez une recherche dans l’onglet Découverte.',
    de: 'Dieses Refoss-Gerät ist (noch) nicht bekannt: Starten Sie eine Suche im Tab Erkennung.',
    es: 'Este dispositivo Refoss no se conoce (aún): lance una búsqueda en la pestaña Descubrir.',
  },
  errorRefused: {
    en: '{name} refused the command: {error}',
    fr: '{name} a refusé la commande : {error}',
    de: '{name} hat den Befehl abgelehnt: {error}',
    es: '{name} rechazó la orden: {error}',
  },
  errorUnreachable: {
    en: '{name} does not answer ({error}).',
    fr: '{name} ne répond pas ({error}).',
    de: '{name} antwortet nicht ({error}).',
    es: '{name} no responde ({error}).',
  },
  errorValue: {
    en: 'Value not supported: {value}',
    fr: 'Valeur non prise en charge : {value}',
    de: 'Wert nicht unterstützt: {value}',
    es: 'Valor no admitido: {value}',
  },
  errorNotASwitch: {
    en: '{name} is not an outlet nor a relay.',
    fr: '{name} n’est ni une prise ni un relais.',
    de: '{name} ist weder eine Steckdose noch ein Relais.',
    es: '{name} no es un enchufe ni un relé.',
  },
  errorNoEnergy: {
    en: '{name} does not measure energy.',
    fr: '{name} ne mesure pas l’énergie.',
    de: '{name} misst keine Energie.',
    es: '{name} no mide la energía.',
  },
  errorMinutes: {
    en: 'Duration out of range: from 1 to {max} minutes.',
    fr: 'Durée hors limites : de 1 à {max} minutes.',
    de: 'Dauer außerhalb des Bereichs: 1 bis {max} Minuten.',
    es: 'Duración fuera de rango: de 1 a {max} minutos.',
  },

  // --- Widgets -----------------------------------------------------------------
  stateOn: { en: 'On', fr: 'Allumé', de: 'Ein', es: 'Encendido' },
  stateOff: { en: 'Off', fr: 'Éteint', de: 'Aus', es: 'Apagado' },
  stateOpen: { en: 'Open', fr: 'Ouvert', de: 'Offen', es: 'Abierta' },
  stateClosed: { en: 'Closed', fr: 'Fermé', de: 'Geschlossen', es: 'Cerrada' },
  stateOpening: { en: 'Opening', fr: 'Ouverture', de: 'Öffnet', es: 'Abriendo' },
  stateClosing: { en: 'Closing', fr: 'Fermeture', de: 'Schließt', es: 'Cerrando' },
  stateStopped: { en: 'Stopped', fr: 'Arrêté', de: 'Gestoppt', es: 'Detenida' },
  stateConsuming: { en: 'Consuming', fr: 'Consomme', de: 'Verbraucht', es: 'Consumiendo' },
  stateIdle: { en: 'Idle', fr: 'Au repos', de: 'Im Leerlauf', es: 'En reposo' },
  stateReturning: {
    en: 'Sending back',
    fr: 'Renvoie',
    de: 'Speist zurück',
    es: 'Devolviendo',
  },
  stateUnreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  widgetChooseDevice: {
    en: 'Choose a Refoss device in the settings of this widget.',
    fr: 'Choisissez un appareil Refoss dans les réglages de ce widget.',
    de: 'Wählen Sie ein Refoss-Gerät in den Einstellungen dieses Widgets.',
    es: 'Elija un dispositivo Refoss en los ajustes de este widget.',
  },
  widgetNoDevice: {
    en: 'No Refoss device in Gladys yet: add them from the Discover tab.',
    fr: 'Aucun appareil Refoss dans Gladys : ajoutez-les depuis l’onglet Découverte.',
    de: 'Noch kein Refoss-Gerät in Gladys: im Tab Erkennung hinzufügen.',
    es: 'Aún no hay dispositivos Refoss en Gladys: añádalos en Descubrir.',
  },
  widgetSummary: {
    en: '{count} measured, {on} switched on',
    fr: '{count} mesuré(s), {on} allumé(s)',
    de: '{count} gemessen, {on} eingeschaltet',
    es: '{count} medido(s), {on} encendido(s)',
  },
  widgetMonth: { en: 'This month', fr: 'Ce mois-ci', de: 'Diesen Monat', es: 'Este mes' },
  widgetToday: { en: 'Today', fr: 'Aujourd’hui', de: 'Heute', es: 'Hoy' },
  widgetReturnedMonth: {
    en: 'Returned this month',
    fr: 'Renvoyé ce mois',
    de: 'Zurück diesen Monat',
    es: 'Devuelto este mes',
  },
  widgetMonthShort: {
    en: '{energy} this month',
    fr: '{energy} ce mois-ci',
    de: '{energy} diesen Monat',
    es: '{energy} este mes',
  },
  widgetReturnedShort: {
    en: '{energy} returned this month',
    fr: '{energy} renvoyés ce mois-ci',
    de: '{energy} diesen Monat zurück',
    es: '{energy} devueltos este mes',
  },
  widgetPower: { en: 'Power', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },
  widgetPowerChart: {
    en: 'Power, last 24 h',
    fr: 'Puissance, dernières 24 h',
    de: 'Leistung, letzte 24 h',
    es: 'Potencia, últimas 24 h',
  },
  widgetPosition: { en: 'Position', fr: 'Position', de: 'Position', es: 'Posición' },
  widgetState: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
  widgetOffline: {
    en: 'Does not answer',
    fr: 'Ne répond pas',
    de: 'Antwortet nicht',
    es: 'No responde',
  },
  widgetPasswordNeeded: {
    en: 'Password needed',
    fr: 'Mot de passe requis',
    de: 'Passwort nötig',
    es: 'Contraseña necesaria',
  },
  widgetProtection: { en: 'Protection', fr: 'Protection', de: 'Schutz', es: 'Protección' },
  widgetBoxes: {
    en: 'Refoss devices',
    fr: 'Appareils Refoss',
    de: 'Refoss-Geräte',
    es: 'Dispositivos Refoss',
  },
  widgetAllOnline: {
    en: '{count} connected',
    fr: '{count} connecté(s)',
    de: '{count} verbunden',
    es: '{count} conectado(s)',
  },
  widgetTurnOn: { en: 'Turn on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
  widgetTurnOff: { en: 'Turn off', fr: 'Éteindre', de: 'Ausschalten', es: 'Apagar' },
  widgetOpen: { en: 'Open', fr: 'Ouvrir', de: 'Öffnen', es: 'Abrir' },
  widgetStop: { en: 'Stop', fr: 'Stop', de: 'Stopp', es: 'Parar' },
  widgetClose: { en: 'Close', fr: 'Fermer', de: 'Schließen', es: 'Cerrar' },

  // --- Protections ---------------------------------------------------------------
  protection_overpower: {
    en: 'Overpower',
    fr: 'Surpuissance',
    de: 'Überlast',
    es: 'Sobrepotencia',
  },
  protection_overvoltage: {
    en: 'Overvoltage',
    fr: 'Surtension',
    de: 'Überspannung',
    es: 'Sobretensión',
  },
  protection_overcurrent: {
    en: 'Overcurrent',
    fr: 'Surintensité',
    de: 'Überstrom',
    es: 'Sobrecorriente',
  },
  protection_undervoltage: {
    en: 'Undervoltage',
    fr: 'Sous-tension',
    de: 'Unterspannung',
    es: 'Subtensión',
  },
  protection_overtemp: {
    en: 'Overheating',
    fr: 'Surchauffe',
    de: 'Überhitzung',
    es: 'Sobrecalentamiento',
  },
};

/**
 * @description A number written the way each language writes it.
 * @param {number} value - The number.
 * @param {number} digits - Decimals.
 * @param {string} [unit] - Appended after a non-breaking space.
 * @returns {{en: string, fr: string, de: string, es: string}} The texts.
 */
export function number(value, digits, unit = '') {
  return Object.fromEntries(
    LANGUAGES.map((language) => {
      const formatted = new Intl.NumberFormat(LOCALES[language], {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        // Spanish skips the separator below 10 000: keep it everywhere.
        useGrouping: 'always',
      }).format(value);
      return [language, unit ? `${formatted}\u00a0${unit}` : formatted];
    }),
  );
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] === undefined || vars[name] === null ? match : String(vars[name]),
  );
}

/**
 * @description A runtime text in the four languages.
 * @param {string} key - Message key.
 * @param {object} [vars] - Placeholder values, a value may itself be multi-language.
 * @returns {{en: string, fr: string, de: string, es: string}} The message.
 */
export function t(key, vars = {}) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, text(key, language, vars)]));
}

/**
 * @description A runtime text in one language (English when unknown).
 * @param {string} key - Message key.
 * @param {string} language - Language code.
 * @param {object} [vars] - Placeholder values, a value may itself be multi-language.
 * @returns {string} The text.
 */
export function text(key, language, vars = {}) {
  const message = MESSAGES[key];
  if (!message) {
    throw new Error(`Unknown message ${key}`);
  }
  const lang = LANGUAGES.includes(language) ? language : 'en';
  const resolved = Object.fromEntries(
    Object.entries(vars).map(([name, value]) => [name, pick(value, lang)]),
  );
  return fill(message[lang], resolved);
}

/**
 * @description One language of a value that may be multi-language.
 * @param {*} value - A string, a number or `{ en, fr, ... }`.
 * @param {string} language - Language code.
 * @returns {*} The value in that language.
 */
export function pick(value, language) {
  if (value && typeof value === 'object') {
    return value[language] ?? value.en;
  }
  return value;
}

/**
 * @description Cut a text to a maximum length, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - Maximum length.
 * @returns {string} The text, at most `max` characters.
 */
export function truncate(value, max) {
  const string = String(value ?? '');
  return string.length <= max ? string : `${string.slice(0, max - 1).trimEnd()}…`;
}

/**
 * @description Cut every language of a multi-language text.
 * @param {object} message - `{ en, fr, ... }`.
 * @param {number} max - Maximum length.
 * @returns {object} The message.
 */
export function truncateAll(message, max) {
  return Object.fromEntries(
    Object.entries(message).map(([language, value]) => [language, truncate(value, max)]),
  );
}

export const MESSAGE_KEYS = Object.keys(MESSAGES);
export const MESSAGES_FOR_TESTS = MESSAGES;
