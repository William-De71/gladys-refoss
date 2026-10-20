// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`) and fake Refoss devices on real
// local sockets (test/helpers.js): discovery, pushed and polled states,
// energy indexes, commands, password, scene triggers and actions, widgets,
// lost devices, restarts. Nothing leaves 127.0.0.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp } from '../src/app.js';
import { SCENE_ACTION_OUTPUTS, SCENE_TRIGGER_DATA } from '../src/scenes.js';
import { memoryStorage } from '../src/storage.js';
import {
  FakeNetwork,
  fakeClock,
  meter,
  METER_MAC,
  OLD_METER_MAC,
  OLD_RELAY_MAC,
  oldMeter,
  oldRelay,
  PASSWORD,
  plug,
  PLUG_MAC,
  shutter,
  SHUTTER_MAC,
  until,
} from './helpers.js';

const CONFIG = {
  language: 'fr',
  hosts: '127.0.0.2, 127.0.0.3',
  password: PASSWORD,
  refresh_interval: '10',
};
const id = (type, mac, key) => `ext:test-integration:${type}:${mac}-${key}`;
const PLUG = id('switch', PLUG_MAC, 'switch1');
const SHUTTER = id('cover', SHUTTER_MAC, 'cover1');
const WATER_HEATER = id('meter', METER_MAC, 'em1');
const OVEN = id('meter', METER_MAC, 'em3');
const SOLAR = id('meter', METER_MAC, 'em4');
const OLD_A1 = id('meter', OLD_METER_MAC, 'em1');
const OLD_B1 = id('meter', OLD_METER_MAC, 'em2');
const POOL = id('switch', OLD_RELAY_MAC, 'switch0');

/**
 * @description An integration wired to the fake Gladys and fake devices.
 * @param {object} [options] - `{ config, create, storage, devices, gladysDevices }`.
 * @returns {Promise<object>} `{ gladys, fake, app, network, logs, clock, stop, … }`.
 */
async function setup({
  config = CONFIG,
  create = true,
  storage = memoryStorage(),
  devices,
  gladysDevices,
} = {}) {
  const list = devices ?? [plug(), shutter(), meter(), oldMeter(), oldRelay()];
  const network = await new FakeNetwork(list).start();
  const gladys = createFakeGladys({ config: structuredClone(config), devices: gladysDevices });
  gladys.scanNetwork = async (type, options) => {
    assert.equal(type, 'mdns');
    assert.ok(options.timeoutSeconds >= 1 && options.timeoutSeconds <= 30);
    return network.mdns();
  };
  const logs = [];
  const log = (line) => logs.push(String(line));
  const clock = fakeClock();
  const app = createApp(gladys, {
    endpoints: network.endpoints,
    legacyProbe: network.legacyProbe(),
    storage,
    now: clock.now,
    logger: { debug: log, info: log, warn: log, error: log },
    timings: { offlineAfterMs: 200, retryMs: 100, timeoutMs: 1000 },
  });
  try {
    await gladys.connect();
    await app.start();
    if (create) {
      for (const device of gladys.fake.discoveredDevices) {
        await gladys.fake.deviceCreated(structuredClone(device));
      }
      await settle(app);
    }
  } catch (error) {
    await app.stop();
    await network.stop();
    throw error;
  }
  const byMac = (mac) =>
    list.find((device) => device.mac.replaceAll(':', '').toLowerCase() === mac);
  const stop = async () => {
    await app.stop();
    await network.stop();
  };
  return { gladys, fake: gladys.fake, app, network, logs, clock, storage, byMac, stop };
}

const ok = (ack) => {
  assert.equal(ack.success, true, ack.error);
  return ack.data;
};
const deviceOf = (fake, externalId) =>
  structuredClone(fake.discoveredDevices.find((device) => device.external_id === externalId));
const featureOf = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`));
const last = (fake, externalId, key) => fake.lastState(`${externalId}:${key}`);
const setValue = (fake, externalId, key, value) => {
  const device = deviceOf(fake, externalId);
  return fake.setValue(device, featureOf(device, key), value);
};
async function settle(app) {
  await new Promise((resolve) => setTimeout(resolve, 60));
  await app.flushStates();
  await app.flushStates();
}
const keys = (device) => device.features.map((feature) => feature.external_id.split(':').pop());
const rpcCalls = (device, method) =>
  device.requests.filter((request) => request.transport === 'ws' && request.method === method);

test('discovery: mDNS devices, the password, the typed addresses of the old models', async () => {
  const { fake, stop } = await setup({ create: false });
  try {
    const ids = fake.discoveredDevices.map((device) => device.external_id);
    assert.equal(ids.length, 15);
    assert.ok(
      [PLUG, SHUTTER, WATER_HEATER, OVEN, SOLAR, OLD_A1, POOL].every((item) => ids.includes(item)),
    );
    // The printer announcing `_http._tcp` is not a Refoss device.
    assert.ok(!fake.discoveredDevices.some((device) => /printer/i.test(device.name)));

    const washer = deviceOf(fake, PLUG);
    assert.equal(washer.name, 'Lave-linge');
    assert.equal(washer.model, 'Refoss P11S');
    assert.equal(washer.should_poll, false);
    assert.deepEqual(keys(washer), ['state', 'power', 'voltage', 'current', 'energy']);
    assert.equal(featureOf(washer, 'state').name, 'Marche / arrêt');
    assert.deepEqual(washer.params, [
      { name: 'REFOSS_HOST', value: '192.168.1.50' },
      { name: 'REFOSS_MAC', value: PLUG_MAC },
      { name: 'REFOSS_MODEL', value: 'P11S' },
    ]);

    assert.deepEqual(keys(deviceOf(fake, SHUTTER)), ['state', 'position']);
    assert.equal(deviceOf(fake, SHUTTER).name, 'Volet séjour');

    // Clamps named in the Refoss app keep their name, the others get the box and the clamp.
    assert.equal(deviceOf(fake, OVEN).name, 'Four');
    assert.equal(deviceOf(fake, id('meter', METER_MAC, 'em2')).name, 'Tableau B1');
    assert.deepEqual(keys(deviceOf(fake, OVEN)), [
      'power',
      'voltage',
      'current',
      'energy',
      'returned',
    ]);

    // First generation: found at the typed address, uuid kept for its messages.
    const old = deviceOf(fake, OLD_A1);
    assert.equal(old.name, 'Refoss EM06 0004 A1');
    assert.ok(old.params.some((param) => param.name === 'REFOSS_UUID'));
    assert.equal(deviceOf(fake, POOL).name, 'Pompe piscine');
    assert.deepEqual(keys(deviceOf(fake, POOL)), ['state']);
  } finally {
    await stop();
  }
});

test('states: units converted, energy indexes, created devices only', async () => {
  const { fake, stop, app } = await setup({ create: false });
  try {
    await settle(app);
    assert.equal(fake.states.length, 0, 'nothing for devices not created');
    for (const device of fake.discoveredDevices) {
      await fake.deviceCreated(structuredClone(device));
    }
    await settle(app);
    // P11S: milliwatts, millivolts, milliamperes, watt-hours.
    assert.equal(last(fake, PLUG, 'state'), 0);
    assert.equal(last(fake, PLUG, 'power'), 1.5);
    assert.equal(last(fake, PLUG, 'voltage'), 231);
    assert.equal(last(fake, PLUG, 'current'), 0.02);
    assert.equal(last(fake, PLUG, 'energy'), 12.345);
    // Shutter: closed, position 0 (Gladys: how open).
    assert.equal(last(fake, SHUTTER, 'state'), -1);
    assert.equal(last(fake, SHUTTER, 'position'), 0);
    // EM06P: watts and kWh already; the solar clamp is negative and returns energy.
    assert.equal(last(fake, OVEN, 'power'), 2950.7);
    assert.equal(last(fake, OVEN, 'energy'), 310.2);
    assert.equal(last(fake, SOLAR, 'power'), -812.3);
    assert.equal(last(fake, SOLAR, 'returned'), 96.8);
    // EM06: one signed monthly counter in Wh.
    assert.equal(last(fake, OLD_A1, 'power'), 845.6);
    assert.equal(last(fake, OLD_A1, 'energy'), 45.21);
    assert.equal(last(fake, OLD_B1, 'energy'), 0);
    assert.equal(last(fake, OLD_B1, 'returned'), 15.3);
    assert.equal(last(fake, POOL, 'state'), 1);
    assert.deepEqual(
      fake.transports
        .filter((item) => item.device_external_id === PLUG)
        .map((item) => item.transport),
      ['local'],
    );
  } finally {
    await stop();
  }
});

test('pushed changes: on / off at once, measurements and indexes on the refresh interval', async () => {
  const { fake, app, byMac, stop } = await setup();
  try {
    const washer = byMac(PLUG_MAC);
    washer.notify({
      'switch:1': { output: true, apower: 2150300, current: 9450, month_consumption: 12545 },
    });
    await until(() => last(fake, PLUG, 'state') === 1 || (app.flushStates(), false));
    // The power waits for the next sample.
    assert.equal(last(fake, PLUG, 'power'), 1.5);
    app.sample();
    await settle(app);
    assert.equal(last(fake, PLUG, 'power'), 2150.3);
    assert.equal(last(fake, PLUG, 'current'), 9.45);
    assert.equal(last(fake, PLUG, 'energy'), 12.545);
    assert.ok(fake.widgetRefreshes.includes('power'));
  } finally {
    await stop();
  }
});

test('commands: plug, shutter and old relay', async () => {
  const { fake, app, byMac, stop } = await setup();
  try {
    ok(await setValue(fake, PLUG, 'state', 1));
    assert.deepEqual(rpcCalls(byMac(PLUG_MAC), 'Switch.Action.Set').at(-1).params, {
      id: 1,
      action: 'on',
    });
    await until(async () => (await app.flushStates(), last(fake, PLUG, 'state') === 1));

    ok(await setValue(fake, SHUTTER, 'state', 1));
    ok(await setValue(fake, SHUTTER, 'state', 0));
    ok(await setValue(fake, SHUTTER, 'position', 40));
    assert.deepEqual(
      rpcCalls(byMac(SHUTTER_MAC), 'Cover.Action.Set').map((call) => call.params.action),
      ['open', 'stop'],
    );
    assert.deepEqual(rpcCalls(byMac(SHUTTER_MAC), 'Cover.Pos.Set')[0].params, { id: 1, pos: 40 });
    await until(async () => (await app.flushStates(), last(fake, SHUTTER, 'position') === 40));

    ok(await setValue(fake, POOL, 'state', 0));
    const relay = byMac(OLD_RELAY_MAC);
    const set = relay.requests.find((message) => message.header.method === 'SET');
    assert.deepEqual(set.payload, { togglex: { channel: 0, onoff: 0 } });
    assert.equal(set.header.uuid, relay.uuid);
    await until(async () => (await app.flushStates(), last(fake, POOL, 'state') === 0));

    const refused = await setValue(fake, SHUTTER, 'state', 7);
    assert.equal(refused.success, false);
    assert.match(refused.error, /Valeur non prise en charge/);
  } finally {
    await stop();
  }
});

test('password: missing or wrong, then fixed in the configuration', async () => {
  const { fake, app, stop } = await setup({ config: { ...CONFIG, password: '' }, create: false });
  try {
    assert.ok(!fake.discoveredDevices.some((device) => device.external_id === OVEN));
    assert.match(fake.connectionStatus.message.fr, /Tableau est protégé par un mot de passe/);
    const report = ok(await fake.action('test_connection')).message;
    assert.match(report.fr, /mot de passe requis/);

    await fake.configUpdated({ ...CONFIG, password: 'wrong' });
    await until(() => /refuse le mot de passe/.test(fake.connectionStatus.message.fr));

    await fake.configUpdated(CONFIG);
    await until(() => fake.discoveredDevices.some((device) => device.external_id === OVEN));
    await until(() => /5 appareil\(s\) Refoss sur 5/.test(fake.connectionStatus.message.fr));
    assert.equal(fake.connectionStatus.connected, true);
    await settle(app);
  } finally {
    await stop();
  }
});

test('scene triggers: button pushes, protections, lost and found boxes', async () => {
  const { fake, app, byMac, stop } = await setup();
  try {
    const washer = byMac(PLUG_MAC);
    washer.event([{ component: 'input:1', id: 1, event: 'button_double_push', ts: 1 }]);
    washer.event([{ component: 'input:1', id: 1, event: 'button_down', ts: 2 }]);
    await until(() => fake.sceneEvents.length >= 1);
    await settle(app);
    const pushes = fake.sceneEvents.filter((event) => event.key === 'button_pressed');
    assert.deepEqual(pushes, [
      {
        key: 'button_pressed',
        data: { device: PLUG, device_name: 'Lave-linge', button: 1, click: 'double' },
      },
    ]);

    washer.notify({ 'switch:1': { output: false, errors: ['overpower'] } });
    washer.notify({ 'switch:1': { apower: 0 } });
    await until(() => fake.sceneEvents.some((event) => event.key === 'protection_tripped'));
    await settle(app);
    assert.deepEqual(
      fake.sceneEvents.filter((event) => event.key === 'protection_tripped'),
      [
        {
          key: 'protection_tripped',
          data: { device: PLUG, device_name: 'Lave-linge', protection: 'overpower' },
        },
      ],
    );

    await washer.stop();
    await until(() => fake.sceneEvents.some((event) => event.key === 'device_offline'), 4000);
    assert.deepEqual(fake.sceneEvents.find((event) => event.key === 'device_offline').data, {
      device_name: 'Prise buanderie',
      model: 'P11S',
      address: '192.168.1.50',
    });
    assert.ok(
      fake.transports.some(
        (item) => item.device_external_id === PLUG && item.transport === 'unreachable',
      ),
    );
    await washer.start();
    await until(() => fake.sceneEvents.some((event) => event.key === 'device_online'), 4000);

    for (const event of fake.sceneEvents) {
      assert.deepEqual(Object.keys(event.data).sort(), [...SCENE_TRIGGER_DATA[event.key]].sort());
    }
  } finally {
    await stop();
  }
});

test('scene actions: on for some minutes, read the energy', async () => {
  const storage = memoryStorage();
  const { fake, byMac, clock, stop } = await setup({ storage });
  try {
    const result = ok(
      await fake.sceneAction('switch_on_for', { device: PLUG, minutes: 30 }),
    ).outputs;
    assert.equal(result.off_at, new Date(clock.now() + 30 * 60 * 1000).toISOString());
    assert.equal(rpcCalls(byMac(PLUG_MAC), 'Switch.Action.Set').at(-1).params.action, 'on');
    assert.deepEqual(Object.keys(storage.files['timers.json']), [PLUG]);

    const refused = await fake.sceneAction('switch_on_for', { device: OVEN, minutes: 5 });
    assert.equal(refused.success, false);
    assert.match(refused.error, /ni une prise ni un relais/);
    assert.equal(
      (await fake.sceneAction('switch_on_for', { device: PLUG, minutes: 0 })).success,
      false,
    );

    const energy = ok(await fake.sceneAction('read_energy', { device: OVEN })).outputs;
    assert.deepEqual(Object.keys(energy).sort(), [...SCENE_ACTION_OUTPUTS.read_energy].sort());
    assert.deepEqual(energy, {
      power_w: 2950.7,
      today_kwh: 9.85,
      week_kwh: 39.4,
      month_kwh: 310.2,
      month_returned_kwh: 0,
      index_kwh: 310.2,
    });
    const plugEnergy = ok(await fake.sceneAction('read_energy', { device: PLUG })).outputs;
    assert.equal(plugEnergy.month_kwh, 12.345);
    assert.equal(plugEnergy.today_kwh, null);
    assert.equal((await fake.sceneAction('read_energy', { device: SHUTTER })).success, false);
  } finally {
    await stop();
  }
});

test('an overdue "on for" timer turns the outlet off at start', async () => {
  const storage = memoryStorage({ 'timers.json': { [PLUG]: Date.parse('2026-10-20T17:00:00Z') } });
  const washer = plug();
  washer.status['switch:1'].output = true;
  const { byMac, stop } = await setup({ storage, devices: [washer, shutter(), meter()] });
  try {
    await until(() => rpcCalls(byMac(PLUG_MAC), 'Switch.Action.Set').length > 0);
    assert.equal(rpcCalls(byMac(PLUG_MAC), 'Switch.Action.Set')[0].params.action, 'off');
    await until(() => storage.files['timers.json'] === undefined);
  } finally {
    await stop();
  }
});

test('widgets: valid contents, the hungriest first, one device with its curve', async () => {
  const { fake, stop } = await setup();
  try {
    const power = ok(await fake.widgetGet('power', { language: 'fr' })).content;
    assert.deepEqual(validateWidgetContent(power).errors ?? [], []);
    const list = power.components.find((component) => component.type === 'card-list');
    assert.equal(list.items.length, 8);
    assert.equal(list.items[0].title, 'Four');
    assert.equal(list.items[0].badge.text.fr, '2\u202f951\u00a0W');
    const status = power.components.find((component) => component.type === 'status');
    assert.equal(status.items[0].value.fr, '5 connecté(s)');

    const oven = ok(
      await fake.widgetGet('device', { settings: { device: OVEN }, language: 'fr' }),
    ).content;
    assert.deepEqual(validateWidgetContent(oven).errors ?? [], []);
    assert.deepEqual(
      oven.components.map((component) => component.type),
      ['text', 'value', 'value', 'value', 'chart', 'status'],
    );
    assert.deepEqual(oven.components[4].device_features, [`${OVEN}:power`]);

    const washer = ok(await fake.widgetGet('device', { settings: { device: PLUG } })).content;
    assert.equal(washer.components.at(-1).device_feature, `${PLUG}:state`);
    assert.equal(washer.components.at(-1).value, 1);

    const blind = ok(await fake.widgetGet('device', { settings: { device: SHUTTER } })).content;
    assert.deepEqual(
      blind.components
        .filter((component) => component.type === 'button')
        .map((button) => button.value),
      [1, 0, -1],
    );
    const none = ok(await fake.widgetGet('device', { settings: {} })).content;
    assert.equal(none.components.length, 1);
  } finally {
    await stop();
  }
});

test('restart: the boxes of /data reconnect, the energy indexes carry on', async () => {
  const storage = memoryStorage();
  const first = await setup({ storage });
  const created = structuredClone(first.fake.discoveredDevices);
  await first.app.flushStates();
  const index = first.fake.lastState(`${OVEN}:energy`);
  await first.app.energy.save();
  await first.stop();
  assert.ok(storage.files['devices.json'][METER_MAC]);
  assert.equal(storage.files['energy.json'][`${OVEN}:energy`].index, index);

  // The month counter restarted while the integration was stopped is not a
  // drop of the index: it only moves on from what it was.
  const restarted = meter();
  restarted.status['em:3'].month_energy = 311.0;
  const second = await setup({
    storage,
    create: false,
    devices: [restarted],
    gladysDevices: created.filter((device) => device.external_id.includes(METER_MAC)),
  });
  try {
    second.app.sample();
    await settle(second.app);
    assert.equal(second.fake.lastState(`${OVEN}:energy`), 311);
  } finally {
    await second.stop();
  }
});
