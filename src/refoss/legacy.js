// -----------------------------------------------------------------------------
// The first generation of Refoss devices (R10, EM06, EM16): the Meross-style
// local protocol.
//
// Search: a JSON datagram `{"id":"48cbd88f969eb3c486085cfe7b5eb1e4","devName":"*"}`
// to UDP port 9988; the device answers with its uuid, model, MAC, address and
// channels, to UDP port 9989 of the sender. That answer goes to a fixed port,
// not to the port the search left from: the mediated broadcast of the Gladys
// core (a one-shot socket on a random port) would never hear it. The
// integration therefore asks the addresses typed in its configuration
// itself, from a socket bound to 9989: through the NAT of the Docker bridge,
// the answer comes back the way the question went.
//
// Commands: a signed message posted to `http://<ip>/config` (R10) or
// `/public` (energy monitors). The signature is md5(messageId + key +
// timestamp) with an empty key on the local network. The device answers with
// the same messageId and the method followed by `ACK`.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import { readLegacyAnnounce } from './model.js';

export const SEARCH_PORT = 9988;
export const ANSWER_PORT = 9989;
export const SEARCH_PAYLOAD = JSON.stringify({
  id: '48cbd88f969eb3c486085cfe7b5eb1e4',
  devName: '*',
});

export const NAMESPACES = {
  SYSTEM_ALL: 'Appliance.System.All',
  ABILITY: 'Appliance.System.Ability',
  TOGGLEX: 'Appliance.Control.ToggleX',
  ELECTRICITYX: 'Appliance.Control.ElectricityX',
};

const ALL_CHANNELS = 65535;
const TIMEOUT_MS = 8000;

export class LegacyError extends Error {
  constructor(message, kind = 'network') {
    super(message);
    this.name = 'LegacyError';
    this.kind = kind;
  }
}

const md5 = (value) => createHash('md5').update(value).digest('hex');

/**
 * @description Build a signed message.
 * @param {object} options - `{ method, namespace, payload, uuid, now }`.
 * @returns {{ message: object, messageId: string }} The message and its id.
 */
export function buildMessage({ method, namespace, payload, uuid = '', now = Date.now }) {
  const random = randomBytes(8).toString('hex').toUpperCase();
  const messageId = md5(random);
  const timestamp = Math.round(now() / 1000);
  return {
    messageId,
    message: {
      header: {
        from: `/app/${random}/subscribe`,
        messageId,
        method,
        namespace,
        payloadVersion: 1,
        sign: md5(`${messageId}${timestamp}`),
        timestamp,
        triggerSrc: 'Gladys',
        uuid,
      },
      payload,
    },
  };
}

/** The HTTP path of a model: the R10 relay answers on /config, the others on /public. */
export const pathOf = (model) => (model === 'r10' ? '/config' : '/public');

/**
 * @description Create the client of one legacy device.
 * @param {object} options - Options.
 * @param {string} options.host - IPv4 address.
 * @param {string} options.model - Model code (`r10`, `em06`…).
 * @param {string} options.uuid - Device uuid (from the search).
 * @param {Function} [options.fetch] - fetch.
 * @param {Function} [options.base] - host -> base URL (tests: a local port).
 * @param {number} [options.timeoutMs] - Request timeout.
 * @returns {object} `{ request, toggles, electricity, setToggle }`.
 */
export function createLegacyClient({
  host,
  model,
  uuid,
  fetch = globalThis.fetch,
  base = (address) => `http://${address}`,
  timeoutMs = TIMEOUT_MS,
}) {
  const request = async (method, namespace, payload, path = pathOf(model)) => {
    const { message, messageId } = buildMessage({ method, namespace, payload, uuid });
    let response;
    try {
      response = await fetch(`${base(host)}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new LegacyError(error?.cause?.code ?? error?.message ?? String(error));
    }
    if (!response.ok) {
      throw new LegacyError(`HTTP ${response.status}`, 'device');
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new LegacyError('invalid answer', 'device');
    }
    const header = data?.header ?? {};
    if (header.method === 'ERROR') {
      throw new LegacyError(JSON.stringify(data.payload ?? {}).slice(0, 200), 'device');
    }
    if (header.messageId !== messageId || header.method !== `${method}ACK`) {
      throw new LegacyError('unexpected answer', 'device');
    }
    return data.payload ?? {};
  };

  return {
    request,

    /** @returns {Promise<Array|object>} `payload.togglex`. */
    toggles: async () =>
      (await request('GET', NAMESPACES.TOGGLEX, { togglex: { channel: ALL_CHANNELS } })).togglex,

    /** @returns {Promise<Array|object>} `payload.electricity`. */
    electricity: async () =>
      (await request('GET', NAMESPACES.ELECTRICITYX, { electricity: { channel: ALL_CHANNELS } }))
        .electricity,

    /**
     * @param {number} channel - Channel.
     * @param {boolean} on - On or off.
     */
    setToggle: (channel, on) =>
      request('SET', NAMESPACES.TOGGLEX, { togglex: { channel, onoff: on ? 1 : 0 } }),
  };
}

/**
 * @description Ask legacy devices for their identity, at the given addresses.
 * @param {string[]} hosts - IPv4 addresses.
 * @param {object} [options] - `{ timeoutMs, searchPort, answerPort, logger }`
 * (tests: other ports).
 * @returns {Promise<object[]>} `readLegacyAnnounce` results, one per device.
 */
export async function probeLegacy(
  hosts,
  {
    timeoutMs = 3000,
    searchPort = SEARCH_PORT,
    answerPort = ANSWER_PORT,
    bindAddress,
    logger,
  } = {},
) {
  if (hosts.length === 0) {
    return [];
  }
  const found = new Map();
  const answered = new Set();
  let allAnswered = () => {};
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('message', (buffer, remote) => {
    let reply;
    try {
      reply = JSON.parse(buffer.toString('utf8'));
    } catch {
      return;
    }
    const announce = readLegacyAnnounce(reply);
    if (!announce) {
      return;
    }
    // The address asked wins over the one the device says (another subnet, NAT).
    const host = hosts.includes(remote.address) ? remote.address : announce.host || remote.address;
    found.set(announce.uuid, { ...announce, host });
    answered.add(host);
    if (hosts.every((asked) => answered.has(asked))) {
      allAnswered();
    }
  });
  const bound = await new Promise((resolve) => {
    socket.once('error', (error) => {
      logger?.info(`Refoss: UDP port ${answerPort} unavailable (${error.message})`);
      resolve(false);
    });
    socket.bind({ port: answerPort, address: bindAddress }, () => resolve(true));
  });
  if (!bound) {
    socket.close();
    return [];
  }
  socket.on('error', () => {});
  const payload = Buffer.from(SEARCH_PAYLOAD);
  // Twice: one lost datagram on Wi-Fi is common.
  for (const round of [0, 1]) {
    for (const host of hosts) {
      socket.send(payload, searchPort, host, () => {});
    }
    if (round === 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, timeoutMs / 3)));
    }
  }
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    allAnswered = () => {
      clearTimeout(timer);
      resolve();
    };
    if (hosts.every((asked) => answered.has(asked))) {
      allAnswered();
    }
  });
  socket.close();
  return [...found.values()];
}
