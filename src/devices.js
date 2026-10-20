// -----------------------------------------------------------------------------
// From a Refoss channel to a Gladys device, and back.
//
//   switch   relay or plug outlet  -> switch: on / off
//                                     + power, voltage, current (switch)
//                                     + energy index (energy-sensor/index)
//                                       when the device reports them (P11S, relays)
//   cover    shutter motor         -> shutter: state (open / stop / close)
//                                     + position once the motor is calibrated
//   em       energy monitor clamp  -> energy-sensor: power (signed: below zero
//                                     the clamp sees energy going back),
//                                     voltage, current, energy index
//                                     + energy-production-sensor: index of the
//                                     energy returned (a solar line, a battery)
//
// One Gladys device per channel, not per box: an EM16P measures 18 circuits
// the user wants to name one by one ("Oven", "Water heater"), and an energy
// index per device is what the Gladys energy monitoring adds up.
//
// External ids: `<MAC>-<channel key>` (`c4e7ae01abcd-em3`): the MAC survives
// a new IP address, a rename, a firmware update. Feature keys are part of the
// external ids: permanent.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { KINDS, modelName } from './refoss/model.js';
import { text } from './i18n.js';

export const DEVICE_TYPES = { SWITCH: 'switch', COVER: 'cover', METER: 'meter' };

export const FEATURE_KEYS = {
  STATE: 'state',
  POSITION: 'position',
  POWER: 'power',
  VOLTAGE: 'voltage',
  CURRENT: 'current',
  ENERGY: 'energy',
  RETURNED: 'returned',
};

// Features refreshed on a timer (src/app.js): the others go out at once.
export const MEASUREMENTS = new Set([
  FEATURE_KEYS.POWER,
  FEATURE_KEYS.VOLTAGE,
  FEATURE_KEYS.CURRENT,
  FEATURE_KEYS.ENERGY,
  FEATURE_KEYS.RETURNED,
]);

export const COVER = { OPEN: 1, STOP: 0, CLOSE: -1 };

const TYPE_OF_KIND = {
  [KINDS.SWITCH]: DEVICE_TYPES.SWITCH,
  [KINDS.COVER]: DEVICE_TYPES.COVER,
  [KINDS.EM]: DEVICE_TYPES.METER,
};

/** The Gladys device type of a channel. */
export const deviceTypeOf = (channel) => TYPE_OF_KIND[channel.kind];

/** The id of a channel in the external ids: `<MAC>-<key>`. */
export const platformId = (unit, channel) => `${unit.mac}-${channel.key}`;

const feature = (key, language, spec) => ({
  key,
  name: text(`feature_${key}`, language),
  keep_history: true,
  read_only: true,
  has_feedback: false,
  ...spec,
});

const measures = (category, language) => [
  feature(FEATURE_KEYS.POWER, language, {
    category,
    type: TYPES.SWITCH.POWER,
    unit: UNITS.WATT,
    min: 0,
    max: 10000,
  }),
  feature(FEATURE_KEYS.VOLTAGE, language, {
    category,
    type: TYPES.SWITCH.VOLTAGE,
    unit: UNITS.VOLT,
    min: 0,
    max: 400,
  }),
  feature(FEATURE_KEYS.CURRENT, language, {
    category,
    type: TYPES.SWITCH.CURRENT,
    unit: UNITS.AMPERE,
    min: 0,
    max: 100,
  }),
];

const energyIndex = (language) =>
  feature(FEATURE_KEYS.ENERGY, language, {
    category: CATEGORIES.ENERGY_SENSOR,
    type: TYPES.ENERGY_SENSOR.INDEX,
    unit: UNITS.KILOWATT_HOUR,
    min: 0,
    max: 10000000,
  });

/**
 * @description The features of a channel, without their external ids.
 * @param {object} channel - Channel (src/refoss/model.js).
 * @param {string} language - Language of the names.
 * @returns {Array<object>} Feature specs (`key` + Gladys fields).
 */
export function channelSpecs(channel, language) {
  if (channel.kind === KINDS.SWITCH) {
    const list = [
      feature(FEATURE_KEYS.STATE, language, {
        category: CATEGORIES.SWITCH,
        type: TYPES.SWITCH.BINARY,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: true,
      }),
    ];
    if (channel.metering) {
      list.push(...measures(CATEGORIES.SWITCH, language), energyIndex(language));
    }
    return list;
  }
  if (channel.kind === KINDS.COVER) {
    const list = [
      feature(FEATURE_KEYS.STATE, language, {
        category: CATEGORIES.SHUTTER,
        type: TYPES.SHUTTER.STATE,
        min: -1,
        max: 1,
        read_only: false,
        has_feedback: true,
        keep_history: false,
      }),
    ];
    if (channel.cover?.calibrated) {
      list.push(
        feature(FEATURE_KEYS.POSITION, language, {
          category: CATEGORIES.SHUTTER,
          type: TYPES.SHUTTER.POSITION,
          unit: UNITS.PERCENT,
          min: 0,
          max: 100,
          read_only: false,
          has_feedback: true,
        }),
      );
    }
    return list;
  }
  // A clamp measures both ways: a solar line sends energy back to the grid.
  return [
    feature(FEATURE_KEYS.POWER, language, {
      category: CATEGORIES.ENERGY_SENSOR,
      type: TYPES.ENERGY_SENSOR.POWER,
      unit: UNITS.WATT,
      min: -100000,
      max: 100000,
    }),
    feature(FEATURE_KEYS.VOLTAGE, language, {
      category: CATEGORIES.ENERGY_SENSOR,
      type: TYPES.ENERGY_SENSOR.VOLTAGE,
      unit: UNITS.VOLT,
      min: 0,
      max: 400,
    }),
    feature(FEATURE_KEYS.CURRENT, language, {
      category: CATEGORIES.ENERGY_SENSOR,
      type: TYPES.ENERGY_SENSOR.CURRENT,
      unit: UNITS.AMPERE,
      min: 0,
      max: 1000,
    }),
    energyIndex(language),
    feature(FEATURE_KEYS.RETURNED, language, {
      category: CATEGORIES.ENERGY_PRODUCTION_SENSOR,
      type: TYPES.ENERGY_PRODUCTION_SENSOR.INDEX,
      unit: UNITS.KILOWATT_HOUR,
      min: 0,
      max: 10000000,
    }),
  ];
}

/**
 * @description The default name of a channel device: the name given in the
 * Refoss app, else the box name and the channel.
 * @param {object} unit - Unit (`name`, `model`, `mac`, `channels`).
 * @param {object} channel - Channel.
 * @param {string} language - Language.
 * @returns {string} The name.
 */
export function channelName(unit, channel, language) {
  if (channel.name) {
    return channel.name;
  }
  const box = unit.name || `Refoss ${modelName(unit.model)} ${unit.mac.slice(-4).toUpperCase()}`;
  if (channel.kind === KINDS.EM) {
    return `${box} ${channel.label}`;
  }
  const sameKind = [...unit.channels.values()].filter((item) => item.kind === channel.kind);
  if (sameKind.length <= 1) {
    return box;
  }
  return `${box} ${text(channel.kind === KINDS.COVER ? 'nameCover' : 'nameOutput', language, { id: channel.id })}`;
}

/**
 * @description The Gladys device of a channel.
 * @param {object} gladys - SDK client (`externalIds`).
 * @param {object} unit - Unit.
 * @param {object} channel - Channel.
 * @param {string} language - Language of the names.
 * @returns {object} The device.
 */
export function buildDevice(gladys, unit, channel, language) {
  const ids = gladys.externalIds(deviceTypeOf(channel), platformId(unit, channel));
  const params = [
    { name: 'REFOSS_HOST', value: unit.host },
    { name: 'REFOSS_MAC', value: unit.mac },
    { name: 'REFOSS_MODEL', value: modelName(unit.model) },
  ];
  if (channel.label) {
    params.push({ name: 'REFOSS_CHANNEL', value: channel.label });
  }
  if (unit.uuid) {
    // First generation: its messages carry the uuid of the box.
    params.push({ name: 'REFOSS_UUID', value: unit.uuid });
  }
  return {
    name: channelName(unit, channel, language),
    external_id: ids.device,
    model: `Refoss ${modelName(unit.model)}`,
    // The integration reads the devices itself (pushed or on its own timer):
    // the Gladys scheduler never polls them.
    should_poll: false,
    params,
    features: channelSpecs(channel, language).map(({ key, ...spec }) => ({
      ...spec,
      external_id: ids.feature(key),
    })),
  };
}

const COVER_VALUES = { open: COVER.OPEN, closed: COVER.CLOSE };

const roundTo = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * @description The current values of a channel, feature key -> Gladys value.
 * Energy indexes are not here: src/energy.js keeps them.
 * @param {object} channel - Channel.
 * @returns {Array<[string, number]>} The known values (unknown ones are left out).
 */
export function channelValues(channel) {
  const values = [];
  const add = (key, value, digits) => {
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      values.push([key, roundTo(value, digits)]);
    }
  };
  if (channel.kind === KINDS.SWITCH && channel.on !== null) {
    values.push([FEATURE_KEYS.STATE, channel.on ? 1 : 0]);
  }
  if (channel.kind === KINDS.COVER && channel.cover) {
    values.push([FEATURE_KEYS.STATE, COVER_VALUES[channel.cover.state] ?? COVER.STOP]);
    if (channel.cover.calibrated) {
      add(FEATURE_KEYS.POSITION, channel.cover.position, 0);
    }
  }
  if (channel.metering) {
    add(FEATURE_KEYS.POWER, channel.power, 1);
    add(FEATURE_KEYS.VOLTAGE, channel.voltage, 0);
    add(FEATURE_KEYS.CURRENT, channel.current, 2);
  }
  return values;
}

/**
 * @description The counters an energy index follows: the lifetime total when
 * the firmware has it, else this month.
 * @param {object} channel - Channel.
 * @returns {Array<[string, number|null]>} Feature key -> counter (kWh).
 */
export function channelCounters(channel) {
  if (!channel.metering) {
    return [];
  }
  const list = [[FEATURE_KEYS.ENERGY, channel.total ?? channel.month]];
  if (channel.kind === KINDS.EM) {
    list.push([FEATURE_KEYS.RETURNED, channel.totalReturned ?? channel.monthReturned]);
  }
  return list;
}

const asBinary = (value) => {
  const number = Number(value);
  if (number !== 0 && number !== 1) {
    throw new RangeError(String(value));
  }
  return number;
};

const asCover = (value) => {
  const number = Math.round(Number(value));
  if (![COVER.OPEN, COVER.STOP, COVER.CLOSE].includes(number)) {
    throw new RangeError(String(value));
  }
  return number;
};

const asPercent = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new RangeError(String(value));
  }
  return Math.round(number);
};

/**
 * @description The command that sets a feature of a channel.
 * @param {object} channel - Channel.
 * @param {string} key - Feature key.
 * @param {number} value - Gladys value.
 * @returns {{ action: string, value?: number }} `switch` (on: 0/1),
 * `cover` (open / close / stop) or `position` (0-100).
 */
export function commandFor(channel, key, value) {
  if (channel.kind === KINDS.SWITCH && key === FEATURE_KEYS.STATE) {
    return { action: 'switch', value: asBinary(value) };
  }
  if (channel.kind === KINDS.COVER && key === FEATURE_KEYS.STATE) {
    const wanted = asCover(value);
    return { action: 'cover', value: wanted };
  }
  if (channel.kind === KINDS.COVER && key === FEATURE_KEYS.POSITION) {
    return { action: 'position', value: asPercent(value) };
  }
  throw new RangeError(key);
}
