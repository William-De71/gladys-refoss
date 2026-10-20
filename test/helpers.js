// Test helpers: a clock, a silent logger, waiting, and a fake LAN of Refoss
// devices on real local sockets (test/helpers/fake-refoss.js) that the
// integration reaches through its real code. Nothing leaves 127.0.0.1.

import { FakeLegacyDevice, FakeNetwork, FakeRpcDevice } from './helpers/fake-refoss.js';

export { FakeLegacyDevice, FakeNetwork, FakeRpcDevice };

export const PLUG_MAC = 'c4e7ae000001';
export const SHUTTER_MAC = 'c4e7ae000002';
export const METER_MAC = 'c4e7ae000003';
export const OLD_METER_MAC = '48e1e9000004';
export const OLD_RELAY_MAC = '48e1e9000005';
export const PASSWORD = 'refoss-2026';

export function fakeClock(start = Date.parse('2026-10-20T18:00:00Z')) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
  };
}

export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * @description Wait until a condition holds (real sockets take a few ms).
 * @param {Function} condition - `() => boolean`.
 * @param {number} [timeoutMs] - Give up after.
 * @returns {Promise<void>} Resolves when true, rejects on timeout.
 */
export async function until(condition, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > end) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A P11S plug behind the washing machine, off, its button set as a push button. */
export const plug = (options = {}) =>
  new FakeRpcDevice({
    mac: PLUG_MAC,
    host: '192.168.1.50',
    model: 'p11s',
    name: 'Prise buanderie',
    status: {
      'switch:1': {
        id: 1,
        output: false,
        // Milliwatts, millivolts, milliamperes, watt-hours: the firmware units.
        apower: 1500,
        voltage: 231400,
        current: 20,
        month_consumption: 12345,
        errors: [],
      },
      'input:1': { id: 1, state: false },
      sys: { temperature: { tc: 38.5 }, uptime: 3600, errors: [] },
      wifi: { rssi: -58 },
      cloud: { connected: true },
    },
    config: { 'switch:1': { name: 'Lave-linge' }, 'input:1': { type: 'button' } },
    ...options,
  });

/** An R21 wired to a roller shutter (cover mode), calibrated, closed. */
export const shutter = (options = {}) =>
  new FakeRpcDevice({
    mac: SHUTTER_MAC,
    host: '192.168.1.51',
    model: 'r21',
    name: '',
    status: {
      'cover:1': {
        id: 1,
        state: 'closed',
        current_pos: 0,
        cali_state: 'success',
        aenergy: { total: 812 },
        errors: [],
      },
      'input:1': { id: 1, state: false },
      'input:2': { id: 2, state: false },
      sys: { temperature: { tc: 41 }, errors: [] },
    },
    config: { 'cover:1': { name: 'Volet séjour' } },
    ...options,
  });

/** An EM06P energy monitor, protected by a password: six clamps, one on the solar line. */
export const meter = (options = {}) =>
  new FakeRpcDevice({
    mac: METER_MAC,
    host: '192.168.1.52',
    model: 'em06p',
    name: 'Tableau',
    password: PASSWORD,
    status: Object.fromEntries(
      [
        [1, 1520.4, 6.62, 4.1, 120.5],
        [2, 0, 0, 0, 0],
        [3, 2950.7, 12.8, 9.85, 310.2],
        [4, -812.3, 3.6, 0.2, 2.1],
        [5, 48.2, 0.31, 0.5, 18.4],
        [6, 0, 0, 0, 0],
      ].map(([id, power, current, day, month]) => [
        `em:${id}`,
        {
          id,
          power,
          voltage: 230.1,
          current,
          pf: 0.97,
          day_energy: day,
          week_energy: day * 4,
          month_energy: month,
          day_ret_energy: id === 4 ? -5.4 : 0,
          week_ret_energy: id === 4 ? -21.3 : 0,
          month_ret_energy: id === 4 ? -96.8 : 0,
        },
      ]),
    ),
    config: {
      'em:1': { name: 'Chauffe-eau' },
      'em:3': { name: 'Four' },
      'em:4': { name: 'Solaire' },
    },
    ...options,
  });

/** A first generation EM06, reached at its typed address. */
export const oldMeter = (options = {}) =>
  new FakeLegacyDevice({
    mac: OLD_METER_MAC,
    uuid: '2310166363058874000134298f1f41e8',
    host: '127.0.0.2',
    model: 'em06',
    name: 'em06',
    channels: [1, 2, 3, 4, 5, 6],
    electricity: [1, 2, 3, 4, 5, 6].map((channel) => ({
      channel,
      // Milliwatts, millivolts, milliamperes; signed watt-hours this month.
      power: channel === 1 ? 845600 : channel === 2 ? -350000 : 0,
      voltage: 229800,
      current: channel === 1 ? 3680 : channel === 2 ? 1520 : 0,
      factor: 0.95,
      mConsume: channel === 1 ? 45210 : channel === 2 ? -15300 : 0,
    })),
    ...options,
  });

/** A first generation R10 relay, on, reached at its typed address. */
export const oldRelay = (options = {}) =>
  new FakeLegacyDevice({
    mac: OLD_RELAY_MAC,
    uuid: '2207287890123400000148e1e9000005',
    host: '127.0.0.3',
    model: 'r10',
    name: 'Pompe piscine',
    channels: [0],
    toggles: { 0: true },
    ...options,
  });
