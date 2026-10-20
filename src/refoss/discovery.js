// -----------------------------------------------------------------------------
// Finding the Refoss devices on the local network.
//
// The current generation (RPC) announces itself over mDNS as an HTTP server
// (`_http._tcp`) whose instance name starts with `refoss` and ends with its
// MAC address (`refossem06p-c4e7ae01abcd`): the filter of the official Home
// Assistant integration. The integration container sits behind the Docker
// bridge, where multicast never reaches the LAN: the browse goes through the
// mediated scan of Gladys (the core runs it on the host network and relays
// the raw answers).
//
// The first generation (R10, EM06, EM16) has no mDNS; it answers a UDP
// search on port 9988 to a fixed port, which the core cannot relay (see
// legacy.js): those devices are reached at the addresses typed in the
// configuration. Addresses typed there are also tried as RPC devices
// (another subnet, a network that filters multicast).
// -----------------------------------------------------------------------------

import { normalizeMac } from './model.js';

export const MDNS_SERVICE = '_http._tcp';
export const SCAN_SECONDS = 5;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export const isIpv4 = (value) =>
  IPV4.test(String(value)) &&
  String(value)
    .split('.')
    .every((octet) => Number(octet) <= 255);

/**
 * @description The Refoss devices of an mDNS scan.
 * @param {Array} results - `scanNetwork('mdns')` results.
 * @returns {Array<{ host: string, mac: string, port: number }>} Deduplicated by address.
 */
export function mdnsDevices(results) {
  const devices = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const instance = String(result?.name ?? '').split('.')[0];
    if (!/^refoss/i.test(instance)) {
      continue;
    }
    const host = (result.addresses ?? []).find(isIpv4);
    if (!host) {
      continue;
    }
    const port = Number(result.port);
    devices.set(host, {
      host,
      mac: normalizeMac(instance.slice(instance.indexOf('-') + 1)),
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 80,
    });
  }
  return [...devices.values()];
}

/**
 * @description Run the mediated mDNS scan.
 * @param {object} gladys - SDK client.
 * @param {object} [options] - `{ logger, timeoutSeconds }`.
 * @returns {Promise<{ devices: object[], error: string|null }>} The devices
 * found and why the scan failed, if it did.
 */
export async function mdnsScan(gladys, { logger, timeoutSeconds = SCAN_SECONDS } = {}) {
  try {
    const results = await gladys.scanNetwork('mdns', { timeoutSeconds });
    return { devices: mdnsDevices(results), error: null };
  } catch (error) {
    if (error?.status === 403) {
      logger?.warn(
        'Refoss: Gladys refused the network scan (reinstall the integration to accept its network discovery)',
      );
      return { devices: [], error: 'forbidden' };
    }
    if (error?.status === 429 || error?.status === 409) {
      return { devices: [], error: 'busy' };
    }
    logger?.warn(`Refoss: network scan failed: ${error?.message ?? error}`);
    return { devices: [], error: 'failed' };
  }
}

/**
 * @description Parse the addresses typed in the configuration.
 * @param {string} value - `192.168.1.20, 192.168.1.21`.
 * @returns {string[]} The valid IPv4 addresses, deduplicated.
 */
export function parseHosts(value) {
  return [
    ...new Set(
      String(value ?? '')
        .split(/[\s,;]+/)
        .map((part) => part.trim())
        .filter(isIpv4),
    ),
  ];
}
