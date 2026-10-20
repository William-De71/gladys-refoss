// -----------------------------------------------------------------------------
// The integration: every Gladys handler, registered before connect().
//
//   discovery   mediated mDNS scan (`_http._tcp`, names `refoss…`) through
//               Gladys + the addresses of the configuration: RPC boxes are
//               identified over HTTP, the others are asked over UDP (legacy)
//   states      RPC boxes push their changes over a socket, legacy boxes are
//               read on a timer (src/hub.js). On / off and shutters go out at
//               once; power, voltage, current and energy indexes on the
//               refresh interval, for the devices the user created only
//   energy      the counters of the boxes become indexes that only go up
//               (src/energy.js), what the Gladys energy monitoring needs
//   commands    Gladys features, scene actions -> the box
//   scenes      button pushes, protections, boxes lost and found -> scene events
//
// A box is identified by its MAC address: when its address changes (DHCP),
// the next scan finds it again. The boxes seen are kept in /data so a
// restart connects them at once.
// -----------------------------------------------------------------------------

import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  buildDevice,
  channelCounters,
  channelValues,
  commandFor,
  deviceTypeOf,
  FEATURE_KEYS,
  MEASUREMENTS,
  platformId,
} from './devices.js';
import { createEnergyIndexes } from './energy.js';
import { createHub } from './hub.js';
import { t, text, truncate, truncateAll } from './i18n.js';
import { probeLegacy } from './refoss/legacy.js';
import { isIpv4, mdnsScan } from './refoss/discovery.js';
import {
  GENERATIONS,
  INPUT_EVENTS,
  KINDS,
  modelCode,
  modelName,
  normalizeMac,
  PROTECTIONS,
} from './refoss/model.js';
import { RpcError } from './refoss/rpc.js';
import { MAX_MINUTES, SCENE_ACTIONS, SCENE_TRIGGERS } from './scenes.js';
import { createStatePublisher } from './states.js';
import { createStorage } from './storage.js';
import { buildDeviceWidget, buildPowerWidget, WIDGETS } from './widgets.js';

export const ACTIONS = { TEST: 'test_connection' };

const MINUTE = 60 * 1000;
const RESCAN_SPACING_MS = MINUTE;
const OFFLINE_AFTER_MS = MINUTE;
const WIDGET_REFRESH_SPACING_MS = 11 * 1000;
const MAX_MESSAGE = 1800;
const LANGUAGES = ['en', 'fr', 'de', 'es'];
const LEGACY_MODELS = new Set(['r10', 'em06', 'em16']);

/**
 * @description Wire the integration.
 * @param {object} gladys - SDK client (or the fake one of the tests).
 * @param {object} [deps] - Dependencies.
 * @param {Function} [deps.endpoints] - `(host, port)` -> `{ http, ws }` (tests: local ports).
 * @param {object} [deps.legacyProbe] - Options of the UDP search (tests: other ports).
 * @param {object} [deps.storage] - src/storage.js storage.
 * @param {object} [deps.logger] - Logger.
 * @param {Function} [deps.now] - Clock (ms).
 * @param {object} [deps.timings] - `{ offlineAfterMs, retryMs, timeoutMs, pingMs, refreshMs }` (tests: short).
 * @returns {object} `{ start, stop, scan, … }`.
 */
export function createApp(
  gladys,
  {
    endpoints,
    legacyProbe = {},
    storage = createStorage(),
    logger = sdkLogger,
    now = Date.now,
    timings = {},
  } = {},
) {
  const offlineAfterMs = timings.offlineAfterMs ?? OFFLINE_AFTER_MS;
  let config = normalizeConfig(gladys.config ?? {});
  let stopped = false;
  let scanning = null;
  let lastScanAt = 0;
  let scanError = null;
  let statusKey = '';
  let rescanTimer = null;
  let sampleTimer = null;
  const created = new Set(); // device external ids
  const gladysNames = new Map(); // device external id -> name in Gladys
  const widgetRefresh = new Map();
  const transports = new Map();
  const protections = new Map(); // device external id -> Set of active protections
  const offTimers = new Map(); // device external id -> { at, timer }

  const states = createStatePublisher(gladys, {
    logger,
    now,
    isCreated: (externalId) => created.has(externalId),
  });
  const energy = createEnergyIndexes({ storage, now, logger });

  const safely = (task, what) =>
    Promise.resolve()
      .then(task)
      .catch((error) => logger.warn(`Refoss: ${what} failed: ${error?.message ?? error}`));

  const hub = createHub({
    ...(endpoints ? { endpoints } : {}),
    logger,
    onUpdate: (entry, what, data) => onBoxUpdate(entry, what, data),
    password: () => config.password,
    pollMs: () => config.refreshMs,
    timings,
  });

  // --- Ids ------------------------------------------------------------------------------------

  const idsOf = (entry, channel) =>
    gladys.externalIds(deviceTypeOf(channel), platformId(entry, channel));
  const deviceIdOf = (entry, channel) => idsOf(entry, channel).device;

  /**
   * @description Find what a device external id points to.
   * @param {string} externalId - Device (or feature) external id.
   * @returns {{ mac: string, key: string }|null} The channel.
   */
  const parseId = (externalId) => {
    const match = /:(?:switch|cover|meter):([0-9a-f]{12})-((?:switch|cover|em)\d{1,3})(?::|$)/.exec(
      String(externalId ?? ''),
    );
    return match ? { mac: match[1], key: match[2] } : null;
  };

  const ready = () => [...hub.entries.values()].filter((entry) => entry.ready);

  const boxName = (entry) =>
    entry.name || `Refoss ${modelName(entry.model)} ${entry.mac.slice(-4).toUpperCase()}`;
  const nameOf = (deviceId, fallback) => gladysNames.get(deviceId) || fallback;

  // --- Widgets, transports, status ----------------------------------------------------------

  const refreshWidget = (key) => {
    const slot = widgetRefresh.get(key) ?? { at: 0, timer: null };
    widgetRefresh.set(key, slot);
    const wait = slot.at + WIDGET_REFRESH_SPACING_MS - now();
    if (wait <= 0) {
      slot.at = now();
      safely(() => gladys.requestWidgetRefresh(key), 'widget refresh');
    } else if (!slot.timer) {
      slot.timer = setTimeout(() => {
        slot.timer = null;
        refreshWidget(key);
      }, wait);
      slot.timer.unref?.();
    }
  };
  const refreshWidgets = () => Object.values(WIDGETS).forEach(refreshWidget);

  const createdOf = (entry) =>
    [...entry.channels.values()]
      .map((channel) => deviceIdOf(entry, channel))
      .filter((deviceId) => created.has(deviceId));

  // One channel: the badge of the catalog says it all, the per-device
  // transport only tells "local" from "unreachable".
  const publishTransports = (entry, force = false) => {
    if (entry.reachable === null) {
      return;
    }
    const transport = entry.reachable ? 'local' : 'unreachable';
    const list = createdOf(entry)
      .filter((deviceId) => force || transports.get(deviceId) !== transport)
      .map((deviceId) => {
        transports.set(deviceId, transport);
        return { external_id: deviceId, transport };
      });
    if (list.length > 0) {
      safely(() => gladys.publishTransports(list), 'transport badges');
    }
  };

  function publishStatus() {
    const known = [...hub.entries.values()].filter((entry) => entry.ready || entry.authError);
    const answering = known.filter((entry) => entry.reachable);
    const locked = known.find((entry) => entry.authError);
    let key;
    let connected = true;
    let message;
    if (scanError === 'forbidden' && known.length === 0) {
      [key, connected, message] = ['forbidden', false, t('statusScanForbidden')];
    } else if (known.length === 0) {
      [key, message] = ['none', t('statusNone')];
    } else if (locked) {
      key = `auth:${locked.mac}:${locked.authError}:${answering.length}`;
      connected = answering.length > 0;
      message = t(locked.authError === 'wrong' ? 'statusWrongPassword' : 'statusPassword', {
        name: boxName(locked),
      });
    } else if (answering.length === 0) {
      [key, connected, message] = [`off:${known.length}`, false, t('statusAllOff')];
    } else {
      key = `ok:${answering.length}:${known.length}`;
      message = t('statusConnected', { count: answering.length, total: known.length });
    }
    if (key !== statusKey) {
      statusKey = key;
      safely(() => gladys.setConnectionStatus(connected, message), 'status');
    }
  }

  // --- States ------------------------------------------------------------------------------------

  /** Push the values of a channel: all of them, or only what is not a measurement. */
  const pushChannel = (entry, channel, { measurements }) => {
    const ids = idsOf(entry, channel);
    if (!created.has(ids.device)) {
      return;
    }
    for (const [key, value] of channelValues(channel)) {
      if (measurements || !MEASUREMENTS.has(key)) {
        states.push(ids.feature(key), value);
      }
    }
    if (measurements) {
      for (const [key, counter] of channelCounters(channel)) {
        const index = energy.update(ids.feature(key), counter);
        if (index !== null) {
          states.push(ids.feature(key), index);
        }
      }
    }
  };

  const pushAll = (entry, measurements) =>
    entry.channels.forEach((channel) => pushChannel(entry, channel, { measurements }));

  /** The refresh interval: measurements of every created channel. */
  const sample = () => {
    for (const entry of ready()) {
      if (entry.reachable) {
        pushAll(entry, true);
      }
    }
  };

  const scheduleSampling = () => {
    clearInterval(sampleTimer);
    sampleTimer = null;
    if (!stopped) {
      sampleTimer = setInterval(sample, config.refreshMs);
      sampleTimer.unref?.();
    }
  };

  // --- Scene events --------------------------------------------------------------------------------

  const fire = (key, data) =>
    safely(() => gladys.publishSceneEvent(key, data), `scene event ${key}`);

  /** The channel a component of the box belongs to (`input:2` -> `switch2`). */
  const channelForInput = (entry, id) =>
    entry.channels.get(`${KINDS.SWITCH}${id}`) ??
    entry.channels.get(`${KINDS.COVER}${id}`) ??
    [...entry.channels.values()][0];

  const onEvents = (entry, events) => {
    for (const event of events) {
      const click = INPUT_EVENTS[String(event?.event ?? '')];
      const match = /^input:(\d{1,3})$/.exec(String(event?.component ?? ''));
      if (!click) {
        continue;
      }
      const id = match ? Number(match[1]) : Number(event.id);
      const channel = channelForInput(entry, id);
      if (!channel) {
        continue;
      }
      const deviceId = deviceIdOf(entry, channel);
      if (!created.has(deviceId)) {
        continue;
      }
      fire(SCENE_TRIGGERS.BUTTON_PRESSED, {
        device: deviceId,
        device_name: truncate(nameOf(deviceId, boxName(entry)), 200),
        button: Number.isInteger(id) ? id : 1,
        click,
      });
    }
  };

  /** Protections that appeared since the last reading: one event each. */
  const detectProtections = (entry) => {
    const sys = entry.sysErrors.filter((error) => PROTECTIONS.includes(error));
    let first = true;
    for (const channel of entry.channels.values()) {
      const deviceId = deviceIdOf(entry, channel);
      // Overheating is the box's: told on its first channel only.
      const active = new Set([
        ...channel.errors.filter((error) => PROTECTIONS.includes(error)),
        ...(first ? sys : []),
      ]);
      first = false;
      const before = protections.get(deviceId);
      protections.set(deviceId, active);
      if (!before || !created.has(deviceId)) {
        continue;
      }
      for (const protection of active) {
        if (!before.has(protection)) {
          fire(SCENE_TRIGGERS.PROTECTION_TRIPPED, {
            device: deviceId,
            device_name: truncate(nameOf(deviceId, boxName(entry)), 200),
            protection,
          });
        }
      }
    }
  };

  const watchReachability = (entry) => {
    clearTimeout(entry.offlineTimer);
    entry.offlineTimer = null;
    const data = () => ({
      device_name: truncate(boxName(entry), 200),
      model: modelName(entry.model),
      address: entry.host,
    });
    if (entry.reachable) {
      if (entry.offlineFired) {
        entry.offlineFired = false;
        fire(SCENE_TRIGGERS.DEVICE_ONLINE, data());
      }
      return;
    }
    if (
      entry.reachable === false &&
      !entry.offlineFired &&
      entry.ready &&
      createdOf(entry).length
    ) {
      entry.offlineTimer = setTimeout(() => {
        entry.offlineTimer = null;
        if (!stopped && entry.reachable === false && !entry.offlineFired) {
          entry.offlineFired = true;
          fire(SCENE_TRIGGERS.DEVICE_OFFLINE, data());
        }
      }, offlineAfterMs);
      entry.offlineTimer.unref?.();
    }
  };

  const stateKeysOf = (channel) =>
    channelValues(channel)
      .filter(([key]) => !MEASUREMENTS.has(key))
      .map(([key, value]) => `${key}=${value}`)
      .join(',');

  function onBoxUpdate(entry, what, data) {
    switch (what) {
      case 'connection':
        publishTransports(entry);
        publishStatus();
        watchReachability(entry);
        break;
      case 'auth':
        publishStatus();
        break;
      case 'ready':
        persist();
        publishDiscovered();
        pushAll(entry, true);
        detectProtections(entry);
        publishStatus();
        break;
      case 'status': {
        pushAll(entry, false);
        detectProtections(entry);
        // Only a change the user sees (on / off, shutter) refreshes the widgets
        // at once: the power changes all the time, the widget TTL covers it.
        const changed = [...entry.channels.values()].some(
          (channel) =>
            stateKeysOf(channel) !==
            (data?.before?.get(channel.key) ? stateKeysOf(data.before.get(channel.key)) : ''),
        );
        if (!changed) {
          return;
        }
        break;
      }
      case 'event':
        onEvents(entry, data);
        return;
      default:
        break;
    }
    refreshWidgets();
  }

  // --- Discovery ---------------------------------------------------------------------------------

  const persist = () =>
    safely(
      () =>
        storage.write(
          'devices.json',
          Object.fromEntries(
            ready().map((entry) => [
              entry.mac,
              {
                host: entry.host,
                port: entry.port,
                generation: entry.generation,
                model: entry.model,
                name: entry.name,
                uuid: entry.uuid || undefined,
                channels:
                  entry.generation === GENERATIONS.LEGACY ? entry.legacyChannels : undefined,
              },
            ]),
          ),
        ),
      'saving the devices',
    );

  function publishDiscovered() {
    return safely(
      () =>
        gladys.publishDiscoveredDevices(
          ready().flatMap((entry) =>
            [...entry.channels.values()].map((channel) =>
              buildDevice(gladys, entry, channel, config.language),
            ),
          ),
        ),
      'discovery',
    );
  }

  const scanOnce = async () => {
    lastScanAt = now();
    const found = await mdnsScan(gladys, { logger });
    scanError = found.error;
    const targets = new Set();
    const candidates = [
      ...found.devices,
      ...config.hosts.map((host) => ({ host, mac: '', port: 80, typed: true })),
    ];
    const seen = new Set();
    const legacyHosts = [];
    await Promise.all(
      candidates.map(async (candidate) => {
        const key = `${candidate.host}:${candidate.port}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        const known = [...hub.entries.values()].find(
          (entry) => entry.host === candidate.host && entry.ready,
        );
        if (known && (known.generation === GENERATIONS.LEGACY || known.rpc?.isOpen())) {
          targets.add(known);
          return;
        }
        try {
          const info = await hub.probe(candidate.host, candidate.port);
          const mac = normalizeMac(info.mac);
          if (!mac) {
            return;
          }
          targets.add(
            hub.entryOf(mac, {
              host: candidate.host,
              port: candidate.port,
              generation: GENERATIONS.RPC,
              model: modelCode(info.model || info.dev_id),
              name: String(info.name ?? ''),
              firmware: String(info.fw_ver ?? ''),
            }),
          );
        } catch (error) {
          if (error instanceof RpcError && error.kind === 'auth') {
            // A box that wants the password: known by its mDNS name, or by its address.
            const mac = candidate.mac || known?.mac;
            if (mac) {
              const entry = hub.entryOf(mac, { host: candidate.host, port: candidate.port });
              targets.add(entry);
            } else {
              logger.warn(`Refoss: ${candidate.host} wants a password`);
            }
          } else if (candidate.typed) {
            legacyHosts.push(candidate.host);
          } else {
            logger.info(`Refoss: no answer at ${candidate.host} (${error.message})`);
          }
        }
      }),
    );
    if (legacyHosts.length > 0) {
      const answers = await probeLegacy(legacyHosts, { logger, ...legacyProbe });
      for (const answer of answers) {
        if (!answer.mac) {
          logger.info(`Refoss: ${answer.host} answered without a MAC address, ignored`);
          continue;
        }
        targets.add(
          hub.entryOf(answer.mac, {
            host: answer.host,
            generation: GENERATIONS.LEGACY,
            model: answer.model,
            name: answer.name && answer.name !== answer.model ? answer.name : '',
            uuid: answer.uuid,
            channels: answer.channels,
            firmware: answer.firmware,
          }),
        );
      }
      const answered = new Set(answers.map((answer) => answer.host));
      for (const host of legacyHosts.filter((item) => !answered.has(item))) {
        logger.info(`Refoss: no Refoss device answered at ${host}`);
      }
    }
    // The boxes known from /data or from created devices, not found this time.
    for (const entry of hub.entries.values()) {
      if (entry.wanted && !targets.has(entry)) {
        targets.add(entry);
      }
    }
    await Promise.allSettled([...targets].map((entry) => hub.connect(entry)));
    persist();
    await publishDiscovered();
    publishStatus();
    return [...targets];
  };

  /** Run a scan, or join the one running. */
  const scan = () => {
    if (!scanning) {
      scanning = scanOnce().finally(() => {
        scanning = null;
      });
    }
    return scanning;
  };

  const scheduleRescan = () => {
    clearInterval(rescanTimer);
    rescanTimer = null;
    if (!stopped && config.rescanMs > 0) {
      rescanTimer = setInterval(() => safely(() => scan(), 'scan'), config.rescanMs);
      rescanTimer.unref?.();
    }
  };

  // --- Commands ----------------------------------------------------------------------------------

  const userError = (key, vars = {}) => new Error(text(key, config.language, vars));

  /**
   * @description The box and channel of a device.
   * @param {string} externalId - Device (or feature) external id.
   * @returns {{ entry: object, channel: object, deviceId: string, name: string }} The target.
   */
  const targetOf = (externalId) => {
    const parsed = parseId(externalId);
    const entry = parsed && hub.entries.get(parsed.mac);
    const channel = entry?.channels.get(parsed.key);
    if (!channel) {
      throw userError('errorUnknownDevice');
    }
    const deviceId = deviceIdOf(entry, channel);
    return { entry, channel, deviceId, name: nameOf(deviceId, boxName(entry)) };
  };

  const send = async (target, command) => {
    try {
      await hub.command(target.entry, target.channel, command);
    } catch (error) {
      if (error instanceof RangeError) {
        throw userError('errorValue', { value: truncate(error.message, 60) });
      }
      if (error?.kind === 'device') {
        throw userError('errorRefused', { name: target.name, error: truncate(error.message, 200) });
      }
      throw userError('errorUnreachable', {
        name: target.name,
        error: truncate(error?.message ?? error, 200),
      });
    }
  };

  const commandOf = (channel, key, value) => {
    try {
      return commandFor(channel, key, value);
    } catch (error) {
      if (error instanceof RangeError) {
        throw userError('errorValue', { value: truncate(error.message, 60) });
      }
      throw error;
    }
  };

  gladys.onSetValue(async (device, feature, value) => {
    const target = targetOf(device.external_id);
    const key = String(feature.external_id).split(':').pop();
    await send(target, commandOf(target.channel, key, value));
  });

  // --- Device events ----------------------------------------------------------------------------

  const trackCreated = (device) => {
    if (!device?.external_id) {
      return null;
    }
    const parsed = parseId(device.external_id);
    if (!parsed) {
      return null;
    }
    created.add(device.external_id);
    gladysNames.set(device.external_id, device.name ?? '');
    const param = (name) => device.params?.find?.((item) => item.name === name)?.value;
    const known = hub.entries.get(parsed.mac);
    if (known) {
      known.wanted = true;
      return known;
    }
    const host = param('REFOSS_HOST');
    if (!host || !isIpv4(host)) {
      return null;
    }
    const model = modelCode(param('REFOSS_MODEL'));
    const entry = hub.entryOf(parsed.mac, {
      host,
      model,
      generation: LEGACY_MODELS.has(model) ? GENERATIONS.LEGACY : GENERATIONS.RPC,
      uuid: param('REFOSS_UUID') ?? '',
    });
    entry.wanted = true;
    return entry;
  };

  gladys.onDeviceCreated(async (device) => {
    const entry = trackCreated(device);
    if (entry) {
      // States published before the creation were thrown away by Gladys.
      states.republish(device.external_id);
      pushAll(entry, true);
      protections.delete(device.external_id);
      detectProtections(entry);
      publishTransports(entry, true);
      if (!entry.rpc && !entry.connecting && !entry.pollTimer && !stopped) {
        safely(() => hub.connect(entry), 'connecting');
      }
    }
    publishStatus();
    refreshWidgets();
  });

  gladys.onDeviceUpdated(async (device) => {
    const entry = trackCreated(device);
    if (entry) {
      states.republish(device.external_id);
      pushAll(entry, true);
    }
    refreshWidgets();
  });

  gladys.onDeviceDeleted(async (device) => {
    if (device?.external_id) {
      created.delete(device.external_id);
      transports.delete(device.external_id);
      gladysNames.delete(device.external_id);
      protections.delete(device.external_id);
      states.forget(device.external_id);
    }
    publishStatus();
    refreshWidgets();
  });

  gladys.onScanRequest(async () => {
    await scan();
  });

  gladys.onConfigUpdated(async (raw) => {
    const previous = config;
    config = normalizeConfig(raw ?? {});
    if (previous.language !== config.language) {
      await publishDiscovered();
    }
    if (previous.rescanMs !== config.rescanMs) {
      scheduleRescan();
    }
    if (previous.refreshMs !== config.refreshMs) {
      scheduleSampling();
      hub.reschedule();
    }
    if (previous.password !== config.password) {
      hub.reconnectAll();
    }
    if (
      previous.hosts.join(',') !== config.hosts.join(',') ||
      previous.password !== config.password
    ) {
      await scan();
    }
  });

  // --- Configuration button ------------------------------------------------------------------------

  gladys.onAction(ACTIONS.TEST, async () => {
    if (scanning || now() - lastScanAt > RESCAN_SPACING_MS || ready().length === 0) {
      await scan();
    }
    const known = [...hub.entries.values()].filter((entry) => entry.ready || entry.authError);
    if (known.length === 0) {
      return scanError === 'forbidden' ? t('statusScanForbidden') : t('testNone');
    }
    const message = {};
    for (const language of LANGUAGES) {
      const list = known
        .map((entry) => {
          const details = [entry.host, modelName(entry.model)];
          if (entry.firmware) {
            details.push(`${text('testFirmware', language)} ${entry.firmware}`);
          }
          if (entry.authError) {
            details.push(
              text(entry.authError === 'wrong' ? 'testWrongPassword' : 'testPassword', language),
            );
          } else {
            details.push(
              entry.reachable
                ? text('testChannels', language, { count: entry.channels.size })
                : text('testUnreachable', language),
            );
          }
          return `${boxName(entry)} (${details.join(', ')})`;
        })
        .join(' ; ');
      message[language] = text('testOk', language, { count: known.length, list });
    }
    return truncateAll(message, MAX_MESSAGE);
  });

  // --- Scene actions ---------------------------------------------------------------------------------

  const saveTimers = () =>
    safely(
      () =>
        storage.write(
          'timers.json',
          offTimers.size === 0
            ? null
            : Object.fromEntries([...offTimers].map(([deviceId, { at }]) => [deviceId, at])),
        ),
      'saving the timers',
    );

  const turnOffLater = (deviceId, at) => {
    clearTimeout(offTimers.get(deviceId)?.timer);
    const timer = setTimeout(
      async () => {
        offTimers.delete(deviceId);
        saveTimers();
        try {
          const target = targetOf(deviceId);
          await send(target, { action: 'switch', value: 0 });
        } catch (error) {
          logger.warn(`Refoss: turning ${deviceId} off failed: ${error.message}`);
        }
      },
      Math.max(0, at - now()),
    );
    timer.unref?.();
    offTimers.set(deviceId, { at, timer });
  };

  gladys.onSceneAction(SCENE_ACTIONS.SWITCH_ON_FOR, async (fields = {}) => {
    const target = targetOf(fields.device);
    if (target.channel.kind !== KINDS.SWITCH) {
      throw userError('errorNotASwitch', { name: target.name });
    }
    const minutes = Number(fields.minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
      throw userError('errorMinutes', { max: MAX_MINUTES });
    }
    await send(target, { action: 'switch', value: 1 });
    const at = now() + Math.round(minutes * MINUTE);
    turnOffLater(target.deviceId, at);
    saveTimers();
    return { off_at: new Date(at).toISOString() };
  });

  gladys.onSceneAction(SCENE_ACTIONS.READ_ENERGY, async (fields = {}) => {
    const target = targetOf(fields.device);
    const { channel, entry } = target;
    if (!channel.metering) {
      throw userError('errorNoEnergy', { name: target.name });
    }
    if (!entry.reachable) {
      throw userError('errorUnreachable', { name: target.name, error: entry.host });
    }
    const round = (value, digits) =>
      Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
    const ids = idsOf(entry, channel);
    return {
      power_w: round(channel.power, 1),
      today_kwh: round(channel.today, 3),
      week_kwh: round(channel.week, 3),
      month_kwh: round(channel.month, 3),
      month_returned_kwh: round(channel.monthReturned, 3),
      index_kwh: round(energy.index(ids.feature(FEATURE_KEYS.ENERGY)), 3),
    };
  });

  // --- Widgets ---------------------------------------------------------------------------------------

  /** Snapshot of a channel for the widgets. */
  const viewOf = ({ entry, channel, deviceId, name }) => {
    const ids = idsOf(entry, channel);
    const keys = new Set(
      buildDevice(gladys, entry, channel, 'en').features.map((item) =>
        item.external_id.split(':').pop(),
      ),
    );
    const featureId = (key) => (keys.has(key) ? ids.feature(key) : null);
    return {
      deviceId,
      name,
      kind: channel.kind,
      reachable: Boolean(entry.reachable),
      authError: entry.authError,
      on: channel.on,
      cover: channel.cover,
      metering: channel.metering,
      power: channel.power,
      today: channel.today,
      month: channel.month,
      monthReturned: channel.monthReturned,
      protections: [...(protections.get(deviceId) ?? [])],
      features: {
        state: featureId(FEATURE_KEYS.STATE),
        position: featureId(FEATURE_KEYS.POSITION),
        power: featureId(FEATURE_KEYS.POWER),
      },
    };
  };

  gladys.onWidgetGet(WIDGETS.DEVICE, async ({ settings } = {}) => {
    let view = null;
    if (settings?.device && created.has(settings.device)) {
      try {
        view = viewOf(targetOf(settings.device));
      } catch {
        view = null;
      }
    }
    return buildDeviceWidget(view);
  });

  gladys.onWidgetGet(WIDGETS.POWER, async () => {
    const channels = [];
    const boxes = [];
    for (const entry of hub.entries.values()) {
      const mine = [...entry.channels.values()].filter((channel) =>
        created.has(deviceIdOf(entry, channel)),
      );
      if (mine.length === 0) {
        continue;
      }
      boxes.push({
        name: boxName(entry),
        reachable: Boolean(entry.reachable),
        authError: entry.authError,
      });
      for (const channel of mine) {
        const deviceId = deviceIdOf(entry, channel);
        channels.push(viewOf({ entry, channel, deviceId, name: nameOf(deviceId, boxName(entry)) }));
      }
    }
    return buildPowerWidget({ channels, boxes });
  });

  // --- Lifecycle ---------------------------------------------------------------------------------------

  return {
    /** Restore the known boxes, connect them, then scan. */
    async start() {
      stopped = false;
      config = normalizeConfig(gladys.config ?? {});
      created.clear();
      hub.start();
      await energy.load();
      const saved = (await storage.read('devices.json')) ?? {};
      for (const [mac, info] of Object.entries(saved)) {
        if (normalizeMac(mac) === mac && isIpv4(info?.host)) {
          const entry = hub.entryOf(mac, {
            host: info.host,
            port: Number(info.port) || 80,
            generation:
              info.generation === GENERATIONS.LEGACY ? GENERATIONS.LEGACY : GENERATIONS.RPC,
            model: String(info.model ?? ''),
            name: String(info.name ?? ''),
            uuid: String(info.uuid ?? ''),
            channels: Array.isArray(info.channels) ? info.channels : [],
          });
          entry.wanted = true;
        }
      }
      (gladys.devices ?? []).forEach((device) => trackCreated(device));
      publishStatus();
      scheduleRescan();
      scheduleSampling();
      await scan();
      // "On for" timers that survived a restart: off now if overdue.
      const timers = (await storage.read('timers.json')) ?? {};
      for (const [deviceId, at] of Object.entries(timers)) {
        if (parseId(deviceId) && Number.isFinite(at)) {
          turnOffLater(deviceId, at);
        }
      }
    },

    async stop() {
      stopped = true;
      clearInterval(rescanTimer);
      clearInterval(sampleTimer);
      widgetRefresh.forEach((slot) => clearTimeout(slot.timer));
      offTimers.forEach(({ timer }) => clearTimeout(timer));
      for (const entry of hub.entries.values()) {
        clearTimeout(entry.offlineTimer);
      }
      hub.stop();
      states.stop();
      await Promise.allSettled([scanning]);
      await energy.stop();
    },

    scan,
    sample,
    flushStates: () => states.flush(),
    hub,
    energy,
  };
}
