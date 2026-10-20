// -----------------------------------------------------------------------------
// The Refoss boxes and their connections.
//
// Each box seen gets an entry keyed by its MAC address: its address, its
// generation, its channels (src/refoss/model.js) and how to reach it.
//
//   rpc      one WebSocket kept open: the box pushes every change. A dropped
//            socket is reopened (5 s, then up to a minute apart); the status
//            is also read again every minute, in case a push was lost.
//   legacy   no push: the box is read on a timer (the refresh interval of the
//            configuration). Two failed reads in a row: unreachable.
//
// `onUpdate(entry, what, data)` tells the app what happened:
//   connection   the box answers, or not (`entry.reachable`)
//   ready        the channels were read (first time, or the structure changed)
//   status       values changed (data: `{ before }`, the channels before)
//   event        a button was pushed (data: the `NotifyEvent` events)
//   auth         the box wants a password, or refused it (`entry.authError`)
// -----------------------------------------------------------------------------

import { createLegacyClient } from './refoss/legacy.js';
import {
  GENERATIONS,
  isLegacyMeter,
  KINDS,
  legacySwitchChannel,
  mergeStatus,
  normalizeMac,
  readLegacyElectricity,
  readLegacyToggles,
  readRpcDevice,
} from './refoss/model.js';
import { fetchDeviceInfo, openRpc, RpcError } from './refoss/rpc.js';

const RETRY_MS = [5000, 10000, 20000, 40000, 60000];
const AUTH_RETRY_MS = 10 * 60 * 1000;
const RPC_REFRESH_MS = 60 * 1000;
const LEGACY_FAILURES = 2;

/** HTTP and WebSocket addresses of a box (tests: local ports). */
export const endpointsOf = (host, port = 80) => {
  const authority = port === 80 ? host : `${host}:${port}`;
  return { http: `http://${authority}`, ws: `ws://${authority}/rpc` };
};

const sameChannels = (a, b) =>
  a.size === b.size &&
  [...a.values()].every(
    (channel) =>
      b.has(channel.key) &&
      b.get(channel.key).metering === channel.metering &&
      Boolean(b.get(channel.key).cover?.calibrated) === Boolean(channel.cover?.calibrated) &&
      b.get(channel.key).name === channel.name,
  );

/**
 * @description Create the hub.
 * @param {object} deps - Dependencies.
 * @param {Function} [deps.endpoints] - `(host, port)` -> `{ http, ws }`.
 * @param {Function} [deps.fetch] - fetch.
 * @param {object} deps.logger - Logger.
 * @param {Function} deps.onUpdate - `(entry, what, data)`.
 * @param {Function} deps.password - `() => string`, the password of the configuration.
 * @param {Function} deps.pollMs - `() => number`, the refresh interval of the legacy boxes.
 * @param {object} [deps.timings] - `{ retryMs, timeoutMs, pingMs, refreshMs }` (tests: short).
 * @returns {object} The hub.
 */
export function createHub({
  endpoints = endpointsOf,
  fetch,
  logger,
  onUpdate,
  password = () => '',
  pollMs = () => 30000,
  timings = {},
}) {
  const entries = new Map(); // MAC -> entry
  let stopped = true;

  const retryDelays = timings.retryMs ? [timings.retryMs] : RETRY_MS;
  const refreshMs = timings.refreshMs ?? RPC_REFRESH_MS;
  const fetchOptions = fetch ? { fetch } : {};

  const setReachable = (entry, reachable) => {
    if (entry.reachable !== reachable) {
      entry.reachable = reachable;
      onUpdate(entry, 'connection');
    }
  };

  const setAuthError = (entry, error) => {
    if (entry.authError !== error) {
      entry.authError = error;
      onUpdate(entry, 'auth');
    }
  };

  const nameOf = (entry) => entry.name || `${entry.model} ${entry.mac}`;

  // --- Applying what was read -----------------------------------------------------------

  /** Replace the channels; tell the app whether the structure or only values changed. */
  const applyChannels = (entry, channels) => {
    const before = entry.channels;
    entry.channels = channels;
    const structure = !entry.ready || !sameChannels(before, channels);
    entry.ready = true;
    if (structure) {
      onUpdate(entry, 'ready', { before });
    } else {
      onUpdate(entry, 'status', { before });
    }
  };

  const applyRpc = (entry) => {
    const device = readRpcDevice(entry.info, entry.status, entry.config);
    entry.model = device.model || entry.model;
    entry.name = device.name || entry.name;
    entry.firmware = device.firmware || entry.firmware;
    entry.temperature = device.temperature;
    entry.sysErrors = device.sysErrors;
    entry.rssi = device.rssi;
    applyChannels(entry, device.channels);
  };

  // --- RPC boxes -----------------------------------------------------------------------------

  const scheduleRetry = (entry, delay) => {
    if (stopped || entry.retryTimer || !entry.wanted) {
      return;
    }
    const wait = delay ?? retryDelays[Math.min(entry.failures, retryDelays.length - 1)];
    entry.failures += 1;
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null;
      hub.connect(entry).catch(() => {});
    }, wait);
    entry.retryTimer.unref?.();
  };

  const onNotify = (entry, method, params) => {
    if (method === 'NotifyStatus' && entry.status && params) {
      mergeStatus(entry.status, params);
      applyRpc(entry);
    } else if (method === 'NotifyEvent' && Array.isArray(params?.events)) {
      const events = params.events;
      // A configuration change (a channel renamed, cover mode): read everything again.
      if (events.some((event) => /config_changed/i.test(String(event?.event ?? '')))) {
        refreshRpc(entry, true).catch(() => {});
      }
      onUpdate(entry, 'event', events);
    }
  };

  async function refreshRpc(entry, withConfig = false) {
    const socket = entry.rpc;
    if (!socket?.isOpen()) {
      return;
    }
    if (withConfig) {
      entry.config = await socket.call('Refoss.Config.Get');
    }
    entry.status = await socket.call('Refoss.Status.Get');
    applyRpc(entry);
  }

  const connectRpc = async (entry) => {
    if (entry.rpc?.isOpen()) {
      await refreshRpc(entry);
      return;
    }
    const host = entry.host;
    const { ws } = endpoints(host, entry.port);
    const socket = await openRpc({
      url: ws,
      password: password(),
      onNotify: (method, params) => onNotify(entry, method, params),
      onClose: () => {
        if (entry.rpc !== socket) {
          return;
        }
        entry.rpc = null;
        clearInterval(entry.refreshTimer);
        entry.refreshTimer = null;
        if (stopped || !entry.wanted) {
          return;
        }
        logger.info(`Refoss: lost the connection to ${nameOf(entry)}`);
        setReachable(entry, false);
        scheduleRetry(entry);
      },
      ...(timings.timeoutMs ? { timeoutMs: timings.timeoutMs } : {}),
      ...(timings.pingMs ? { pingMs: timings.pingMs } : {}),
    });
    entry.rpc = socket;
    try {
      const info = await socket.call('Refoss.DeviceInfo.Get');
      if (entry.mac && info.mac && normalizeMac(info.mac) !== entry.mac) {
        // Another box answers at this address now (DHCP): the scan finds ours again.
        throw new RpcError(`${host} is now another device`, 'device');
      }
      entry.info = info;
      entry.config = await socket.call('Refoss.Config.Get');
      entry.status = await socket.call('Refoss.Status.Get');
    } catch (error) {
      entry.rpc = null;
      socket.close();
      throw error;
    }
    if (stopped || !entry.wanted || entry.host !== host) {
      entry.rpc = null;
      socket.close();
      return;
    }
    setAuthError(entry, null);
    applyRpc(entry);
    clearInterval(entry.refreshTimer);
    entry.refreshTimer = setInterval(() => {
      refreshRpc(entry).catch((error) =>
        logger.debug?.(`Refoss: reading ${nameOf(entry)} failed: ${error.message}`),
      );
    }, refreshMs);
    entry.refreshTimer.unref?.();
  };

  // --- Legacy boxes ----------------------------------------------------------------------------

  const legacyClient = (entry) =>
    createLegacyClient({
      host: entry.host,
      model: entry.model,
      uuid: entry.uuid,
      ...fetchOptions,
      base: (host) => endpoints(host, entry.port).http,
      ...(timings.timeoutMs ? { timeoutMs: timings.timeoutMs } : {}),
    });

  const readLegacy = async (entry) => {
    const client = legacyClient(entry);
    let channels;
    if (isLegacyMeter(entry.model)) {
      channels = readLegacyElectricity(entry.model, await client.electricity());
    } else {
      const states = readLegacyToggles(await client.toggles());
      const ids = entry.legacyChannels?.length ? entry.legacyChannels : [...states.keys()];
      channels = new Map(
        ids.map((id) => {
          const channel = legacySwitchChannel(id, states.get(id) ?? null);
          return [channel.key, channel];
        }),
      );
    }
    entry.legacyFailures = 0;
    setReachable(entry, true);
    applyChannels(entry, channels);
  };

  const scheduleLegacyPoll = (entry) => {
    clearTimeout(entry.pollTimer);
    entry.pollTimer = null;
    if (stopped || !entry.wanted) {
      return;
    }
    entry.pollTimer = setTimeout(async () => {
      entry.pollTimer = null;
      try {
        await readLegacy(entry);
      } catch (error) {
        entry.legacyFailures = (entry.legacyFailures ?? 0) + 1;
        if (entry.legacyFailures >= LEGACY_FAILURES) {
          if (entry.reachable !== false) {
            logger.info(
              `Refoss: ${nameOf(entry)} (${entry.host}) does not answer: ${error.message}`,
            );
          }
          setReachable(entry, false);
        }
      }
      scheduleLegacyPoll(entry);
    }, pollMs());
    entry.pollTimer.unref?.();
  };

  // --- The hub -----------------------------------------------------------------------------------

  const hub = {
    entries,

    /**
     * @description The entry of a box, created when new; a new address moves it.
     * @param {string} mac - MAC address (12 hex digits).
     * @param {object} data - `{ host, port, generation, model, name, uuid, channels }`.
     * @returns {object} The entry.
     */
    entryOf(mac, data = {}) {
      let entry = entries.get(mac);
      if (!entry) {
        entry = {
          mac,
          host: data.host,
          port: data.port ?? 80,
          generation: data.generation ?? GENERATIONS.RPC,
          model: data.model ?? '',
          name: data.name ?? '',
          uuid: data.uuid ?? '',
          legacyChannels: data.channels ?? [],
          firmware: data.firmware ?? '',
          channels: new Map(),
          reachable: null,
          ready: false,
          wanted: false,
          failures: 0,
          authError: null,
          rpc: null,
          info: null,
          status: null,
          config: null,
          sysErrors: [],
          temperature: null,
          rssi: null,
        };
        entries.set(mac, entry);
        return entry;
      }
      for (const key of ['generation', 'model', 'uuid', 'firmware']) {
        if (data[key]) {
          entry[key] = data[key];
        }
      }
      if (data.name && !entry.name) {
        entry.name = data.name;
      }
      if (data.channels?.length) {
        entry.legacyChannels = data.channels;
      }
      if (data.host && (entry.host !== data.host || (data.port && entry.port !== data.port))) {
        logger.info(`Refoss: ${nameOf(entry)} moved to ${data.host}`);
        entry.host = data.host;
        entry.port = data.port ?? entry.port;
        const socket = entry.rpc;
        entry.rpc = null;
        socket?.close();
      }
      return entry;
    },

    /**
     * @description Identify an RPC box at an address, without keeping anything.
     * @param {string} host - IPv4 address.
     * @param {number} [port] - HTTP port.
     * @returns {Promise<object>} `Refoss.DeviceInfo.Get`; rejects with an
     * RpcError (`auth` when it wants a password and none or a wrong one is set).
     */
    async probe(host, port = 80) {
      try {
        return await fetchDeviceInfo(endpoints(host, port).http, fetchOptions);
      } catch (error) {
        if (error.kind !== 'auth') {
          throw error;
        }
      }
      // EM16P 3.1.11+: even the identity wants the password, over the socket.
      const socket = await openRpc({
        url: endpoints(host, port).ws,
        password: password(),
        onNotify: () => {},
        onClose: () => {},
        ...(timings.timeoutMs ? { timeoutMs: timings.timeoutMs } : {}),
      });
      try {
        return await socket.call('Refoss.DeviceInfo.Get');
      } finally {
        socket.close();
      }
    },

    /**
     * @description Connect a box and keep it connected (RPC) or read (legacy).
     * @param {object} entry - Entry.
     * @returns {Promise<void>} Resolves once read, rejects when it does not answer.
     */
    async connect(entry) {
      entry.wanted = true;
      if (entry.connecting) {
        return entry.connecting;
      }
      clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
      const task =
        entry.generation === GENERATIONS.LEGACY
          ? readLegacy(entry).finally(() => scheduleLegacyPoll(entry))
          : connectRpc(entry);
      entry.connecting = task
        .then(() => {
          entry.failures = 0;
          setReachable(entry, true);
        })
        .catch((error) => {
          logger.info(`Refoss: ${nameOf(entry)} (${entry.host}) does not answer: ${error.message}`);
          if (error instanceof RpcError && error.kind === 'auth') {
            setAuthError(entry, password() ? 'wrong' : 'required');
            setReachable(entry, false);
            scheduleRetry(entry, AUTH_RETRY_MS);
          } else if (entry.generation !== GENERATIONS.LEGACY) {
            setReachable(entry, false);
            scheduleRetry(entry);
          } else {
            setReachable(entry, false);
          }
          throw error;
        })
        .finally(() => {
          entry.connecting = null;
        });
      return entry.connecting;
    },

    /**
     * @description Send a command to a channel.
     * @param {object} entry - Entry.
     * @param {object} channel - Channel.
     * @param {{ action: string, value?: number }} command - src/devices.js `commandFor`.
     * @returns {Promise<void>} Resolves once the box accepted it.
     */
    async command(entry, channel, command) {
      if (entry.generation === GENERATIONS.LEGACY) {
        if (command.action !== 'switch' || channel.kind !== KINDS.SWITCH) {
          throw new RangeError(command.action);
        }
        await legacyClient(entry).setToggle(channel.id, command.value === 1);
        // No push on this generation: read the result back at once.
        channel.on = command.value === 1;
        readLegacy(entry).catch(() => {});
        return;
      }
      if (!entry.rpc?.isOpen()) {
        await hub.connect(entry);
      }
      const call = (method, params) => entry.rpc.call(method, params);
      if (command.action === 'switch') {
        await call('Switch.Action.Set', { id: channel.id, action: command.value ? 'on' : 'off' });
      } else if (command.action === 'cover') {
        const action = { 1: 'open', 0: 'stop', '-1': 'close' }[command.value];
        await call('Cover.Action.Set', { id: channel.id, action });
      } else if (command.action === 'position') {
        await call('Cover.Pos.Set', { id: channel.id, pos: command.value });
      } else {
        throw new RangeError(command.action);
      }
    },

    /**
     * @description Restart a box (RPC generation only).
     * @param {object} entry - Entry.
     */
    async reboot(entry) {
      if (entry.generation === GENERATIONS.LEGACY) {
        throw new RangeError('reboot');
      }
      if (!entry.rpc?.isOpen()) {
        await hub.connect(entry);
      }
      await entry.rpc.call('Refoss.Device.Reboot');
    },

    /** Reconnect every RPC box (the password changed). */
    reconnectAll() {
      for (const entry of entries.values()) {
        if (entry.wanted && entry.generation === GENERATIONS.RPC) {
          const socket = entry.rpc;
          entry.rpc = null;
          socket?.close();
          clearTimeout(entry.retryTimer);
          entry.retryTimer = null;
          hub.connect(entry).catch(() => {});
        }
      }
    },

    /** Restart the timers of the legacy boxes (the refresh interval changed). */
    reschedule() {
      for (const entry of entries.values()) {
        if (entry.wanted && entry.generation === GENERATIONS.LEGACY && entry.pollTimer) {
          scheduleLegacyPoll(entry);
        }
      }
    },

    start() {
      stopped = false;
    },

    stop() {
      stopped = true;
      for (const entry of entries.values()) {
        clearTimeout(entry.retryTimer);
        clearTimeout(entry.pollTimer);
        clearInterval(entry.refreshTimer);
        entry.retryTimer = null;
        entry.pollTimer = null;
        entry.refreshTimer = null;
        const socket = entry.rpc;
        entry.rpc = null;
        socket?.close();
      }
    },
  };
  return hub;
}
