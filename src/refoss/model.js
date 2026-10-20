// -----------------------------------------------------------------------------
// What a Refoss device is made of, whatever its generation.
//
// Two generations share the brand:
//
//   rpc      R11, R21, P11S, EM01P, EM06P, EM16P (current models): a JSON-RPC
//            API over a WebSocket (`ws://<ip>/rpc`), which pushes every change
//            (`NotifyStatus`, `NotifyEvent`). Components are named
//            `switch:1`, `cover:1`, `em:3`, `input:1`, `sys`…
//   legacy   R10, EM06, EM16 (first models): the Meross-style protocol, signed
//            JSON messages posted over HTTP, polled (`Appliance.Control.ToggleX`,
//            `Appliance.Control.ElectricityX`).
//
// Both are read into the same snapshot: a unit (the box, identified by its
// MAC address) holds channels, and every channel becomes one Gladys device:
//
//   switch   a relay or a plug outlet: on / off, + power, voltage, current and
//            energy when the model measures them (P11S, R11, R21)
//   cover    a shutter motor wired on R11 / R21 in cover mode
//   em       a current clamp of an energy monitor (A1…C6): power, voltage,
//            current, energy consumed and energy returned
//
// Units: every value of a snapshot is in W, V, A and kWh; the conversions
// from the device units (mW, mV, mA, Wh on some components) happen here.
// -----------------------------------------------------------------------------

export const GENERATIONS = { RPC: 'rpc', LEGACY: 'legacy' };
export const KINDS = { SWITCH: 'switch', COVER: 'cover', EM: 'em' };

// Names of the clamps, as printed on the case and in the Refoss app.
const EM06_LABELS = ['A1', 'B1', 'C1', 'A2', 'B2', 'C2'];
const EM16_LABELS = ['A', 'B', 'C'].flatMap((phase) =>
  [1, 2, 3, 4, 5, 6].map((index) => `${phase}${index}`),
);

const MODEL_NAMES = {
  r10: 'R10',
  r11: 'R11',
  r21: 'R21',
  p11s: 'P11S',
  em01p: 'EM01P',
  em06: 'EM06',
  em06p: 'EM06P',
  em16: 'EM16',
  em16p: 'EM16P',
};

/**
 * @description Normalize a model code: `EM06P`, `refoss-em06p`, `em06p` -> `em06p`.
 * @param {string} value - What the device says.
 * @returns {string} Lower case code, '' when unknown.
 */
export function modelCode(value) {
  const text = String(value ?? '')
    .toLowerCase()
    .replace(/^refoss[-_ ]?/, '');
  const known = Object.keys(MODEL_NAMES).find((code) => text === code);
  if (known) {
    return known;
  }
  // `em06p-v2`, `p11s_eu`: the code first.
  return (
    Object.keys(MODEL_NAMES)
      .sort((a, b) => b.length - a.length)
      .find((code) => text.startsWith(code)) ?? text.replace(/[^a-z0-9]/g, '')
  );
}

/** Display name of a model: `em06p` -> `EM06P`. */
export const modelName = (code) =>
  MODEL_NAMES[code] ?? (String(code || '').toUpperCase() || 'Refoss');

/**
 * @description The clamp label of an energy monitor channel.
 * @param {string} model - Model code.
 * @param {number} id - Channel number (1-based).
 * @returns {string} `A1`, `B2`… or `CH<id>` when the model is unknown.
 */
export function channelLabel(model, id) {
  if (/^em06/.test(model)) {
    return EM06_LABELS[id - 1] ?? `CH${id}`;
  }
  if (/^em16/.test(model)) {
    return EM16_LABELS[id - 1] ?? `CH${id}`;
  }
  if (model === 'em01p') {
    return 'A1';
  }
  return `CH${id}`;
}

/**
 * @description A MAC address as 12 lower case hex digits (`c4e7ae01abcd`).
 * @param {string} value - `C4:E7:AE:01:AB:CD`, `c4e7ae01abcd`…
 * @returns {string} The MAC, '' when it is not one.
 */
export function normalizeMac(value) {
  const hex = String(value ?? '')
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
  return hex.length === 12 ? hex : '';
}

const finite = (value) => {
  const number = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(number)
    ? number
    : null;
};
const scaled = (value, divider) => {
  const number = finite(value);
  return number === null ? null : number / divider;
};

const emptyChannel = (kind, id) => ({
  key: `${kind}${id}`,
  kind,
  id,
  name: '',
  label: '',
  metering: false,
  on: null,
  power: null,
  voltage: null,
  current: null,
  // Counters of the device, kWh: they restart every day / week / month.
  today: null,
  week: null,
  month: null,
  monthReturned: null,
  // Lifetime counters, kWh, when the firmware has them.
  total: null,
  totalReturned: null,
  cover: null,
  errors: [],
});

// --- RPC generation ----------------------------------------------------------------

/**
 * @description The components of an RPC status: `switch:1` -> `{ kind, id }`.
 * @param {object} status - `Refoss.Status.Get` result.
 * @returns {Array<{ component: string, kind: string, id: number }>} Channels, in order.
 */
export function rpcComponents(status) {
  const list = [];
  for (const component of Object.keys(status ?? {})) {
    const match = /^(switch|cover|em):(\d{1,3})$/.exec(component);
    if (match) {
      list.push({ component, kind: match[1], id: Number(match[2]) });
    }
  }
  const order = { cover: 0, switch: 1, em: 2 };
  // A relay in cover mode reports its motor only (`cover:1`), never both.
  return list.sort((a, b) => order[a.kind] - order[b.kind] || a.id - b.id);
}

const COVER_STATES = { open: 'open', closed: 'closed', opening: 'opening', closing: 'closing' };

/**
 * @description Read one RPC component into a channel.
 * @param {string} model - Model code.
 * @param {string} kind - `switch`, `cover` or `em`.
 * @param {number} id - Component id.
 * @param {object} status - The component status (`status['switch:1']`).
 * @param {object} [config] - The component configuration (its `name`).
 * @returns {object} The channel.
 */
export function readRpcChannel(model, kind, id, status = {}, config = {}) {
  const channel = emptyChannel(kind, id);
  channel.name = String(config?.name ?? '').trim();
  channel.errors = Array.isArray(status.errors) ? status.errors.map(String) : [];
  if (kind === KINDS.SWITCH) {
    channel.on = status.output === undefined ? null : Boolean(status.output);
    // P11S, R11, R21: milliwatts, millivolts, milliamperes, watt-hours.
    channel.metering = status.apower !== undefined;
    channel.power = scaled(status.apower, 1000);
    channel.voltage = scaled(status.voltage, 1000);
    channel.current = scaled(status.current, 1000);
    channel.month = scaled(status.month_consumption, 1000);
  } else if (kind === KINDS.COVER) {
    const calibrated = status.cali_state === 'success';
    channel.cover = {
      state: COVER_STATES[status.state] ?? 'stopped',
      position: calibrated ? finite(status.current_pos) : null,
      calibrated,
    };
    channel.total = finite(status.aenergy?.total);
    if (channel.total !== null) {
      // Watt-hours on the motor output.
      channel.total /= 1000;
    }
  } else {
    channel.label = channelLabel(model, id);
    channel.metering = true;
    // Energy monitors: watts, volts, amperes, kilowatt-hours already.
    channel.power = finite(status.power);
    channel.voltage = finite(status.voltage);
    channel.current = finite(status.current);
    channel.today = finite(status.day_energy);
    channel.week = finite(status.week_energy);
    channel.month = finite(status.month_energy);
    const returned = finite(status.month_ret_energy);
    channel.monthReturned = returned === null ? null : Math.abs(returned);
    channel.total = finite(status.total_energy);
    const totalReturned = finite(status.total_ret_energy);
    channel.totalReturned = totalReturned === null ? null : Math.abs(totalReturned);
  }
  return channel;
}

/**
 * @description Read a whole RPC device.
 * @param {object} info - `Refoss.DeviceInfo.Get` result.
 * @param {object} status - `Refoss.Status.Get` result.
 * @param {object} [config] - `Refoss.Config.Get` result.
 * @returns {object} `{ mac, model, name, firmware, channels: Map, inputs, sys }`.
 */
export function readRpcDevice(info = {}, status = {}, config = {}) {
  const model = modelCode(info.model || info.dev_id);
  const channels = new Map();
  for (const { component, kind, id } of rpcComponents(status)) {
    const channel = readRpcChannel(model, kind, id, status[component], config?.[component]);
    channels.set(channel.key, channel);
  }
  return {
    mac: normalizeMac(info.mac),
    model,
    name: String(info.name || '').trim(),
    firmware: String(info.fw_ver ?? ''),
    hardware: String(info.hw_ver ?? ''),
    authRequired: Boolean(info.auth_en),
    channels,
    temperature: finite(status?.sys?.temperature?.tc),
    sysErrors: Array.isArray(status?.sys?.errors) ? status.sys.errors.map(String) : [],
    rssi: finite(status?.wifi?.rssi),
  };
}

/**
 * @description Deep merge of a `NotifyStatus` into a status (the device only
 * sends what changed).
 * @param {object} target - Status, modified.
 * @param {object} source - Notification params.
 * @returns {object} The target.
 */
export function mergeStatus(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      mergeStatus(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

// Button events of an input, from `NotifyEvent` -> scene filter values.
export const INPUT_EVENTS = {
  button_single_push: 'single',
  button_double_push: 'double',
  button_triple_push: 'triple',
  button_long_push: 'long',
};

// Protections that cut a relay or warn, from the `errors` of a component.
export const PROTECTIONS = ['overpower', 'overvoltage', 'overcurrent', 'undervoltage', 'overtemp'];

// --- Legacy generation -----------------------------------------------------------

/**
 * @description Read the answer of a legacy device to the UDP search.
 * @param {object} reply - `{ uuid, devName, deviceType, devSoftWare, devHardWare, ip, mac, channels }`.
 * @returns {object|null} `{ uuid, mac, model, name, firmware, host, channels: number[] }`.
 */
export function readLegacyAnnounce(reply) {
  if (!reply || typeof reply !== 'object' || !reply.uuid || reply.channels === undefined) {
    return null;
  }
  let channels = reply.channels;
  if (typeof channels === 'string') {
    try {
      channels = JSON.parse(channels);
    } catch {
      channels = [];
    }
  }
  const model = modelCode(reply.deviceType || reply.devName);
  return {
    uuid: String(reply.uuid).toLowerCase(),
    mac: normalizeMac(reply.mac),
    model,
    name: String(reply.devName ?? '').trim(),
    firmware: String(reply.devSoftWare ?? ''),
    host: String(reply.ip ?? ''),
    channels: (Array.isArray(channels) ? channels : [])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id >= 0),
  };
}

/** A legacy energy monitor (EM06, EM16), or a relay (R10). */
export const isLegacyMeter = (model) => /^em/.test(model);

/**
 * @description Read the `ElectricityX` answer of a legacy energy monitor.
 * @param {string} model - Model code.
 * @param {Array|object} electricity - `payload.electricity`.
 * @returns {Map<string, object>} Channels by key.
 */
export function readLegacyElectricity(model, electricity) {
  const channels = new Map();
  const list = Array.isArray(electricity) ? electricity : electricity ? [electricity] : [];
  for (const item of list) {
    const id = Number(item?.channel);
    if (!Number.isInteger(id) || id < 1) {
      continue;
    }
    const channel = emptyChannel(KINDS.EM, id);
    channel.label = channelLabel(model, id);
    channel.metering = true;
    // Milliwatts, millivolts, milliamperes; one signed monthly counter in
    // watt-hours (below zero: more energy returned than consumed).
    channel.power = scaled(item.power, 1000);
    channel.voltage = scaled(item.voltage, 1000);
    channel.current = scaled(item.current, 1000);
    const net = scaled(item.mConsume, 1000);
    if (net !== null) {
      channel.month = Math.max(0, net);
      channel.monthReturned = net < 0 ? -net : 0;
    }
    channels.set(channel.key, channel);
  }
  return channels;
}

/**
 * @description Read the `ToggleX` answer of a legacy relay.
 * @param {Array|object} togglex - `payload.togglex`.
 * @returns {Map<number, boolean>} Channel -> on.
 */
export function readLegacyToggles(togglex) {
  const states = new Map();
  const list = Array.isArray(togglex) ? togglex : togglex ? [togglex] : [];
  for (const item of list) {
    const id = Number(item?.channel);
    if (Number.isInteger(id) && id >= 0) {
      states.set(id, Number(item.onoff) === 1);
    }
  }
  return states;
}

/** A legacy relay channel, from its number and state. */
export function legacySwitchChannel(id, on) {
  const channel = emptyChannel(KINDS.SWITCH, id);
  channel.on = on ?? null;
  return channel;
}
