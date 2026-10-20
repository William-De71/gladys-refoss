// Refoss channels -> Gladys devices, and the device protocols. The Discover
// tab pitfalls of the Gladys core are checked here: a single invalid feature
// makes the whole discovery list refused, a missing min / max / read_only /
// has_feedback only fails when the user clicks "Add", and a category/type
// pair the front does not label shows "Device (undefined)".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

import { normalizeConfig } from '../src/config.js';
import { buildDevice, channelCounters, channelValues, commandFor } from '../src/devices.js';
import { mdnsDevices, parseHosts } from '../src/refoss/discovery.js';
import { buildMessage, pathOf, probeLegacy } from '../src/refoss/legacy.js';
import {
  channelLabel,
  mergeStatus,
  modelCode,
  normalizeMac,
  readLegacyAnnounce,
  readLegacyElectricity,
  readRpcDevice,
} from '../src/refoss/model.js';
import { digestAuth } from '../src/refoss/rpc.js';
import { createStatePublisher } from '../src/states.js';
import {
  FakeNetwork,
  fakeClock,
  meter,
  oldMeter,
  oldRelay,
  plug,
  shutter,
  silentLogger,
} from './helpers.js';

// Pairs labeled by the Gladys front (deviceFeatureCategory in
// front/src/config/i18n/en.json, checked on master 2026-10-20).
const LABELED = {
  switch: new Set(['binary', 'power', 'voltage', 'current']),
  shutter: new Set(['state', 'position']),
  'energy-sensor': new Set(['power', 'voltage', 'current', 'index']),
  'energy-production-sensor': new Set(['index']),
};

/** The unit the hub fills, from a fake RPC device. */
function rpcUnit(fake) {
  const device = readRpcDevice(fake.info(), fake.status, fake.config);
  return { ...device, host: fake.host };
}

/** The unit the hub fills, from a fake legacy device. */
function legacyUnit(fake) {
  const announce = readLegacyAnnounce(fake.announce());
  const channels = readLegacyElectricity(announce.model, fake.electricity);
  return { ...announce, name: '', channels };
}

const units = () => [rpcUnit(plug()), rpcUnit(shutter()), rpcUnit(meter()), legacyUnit(oldMeter())];
const allDevices = (gladys, language) =>
  units().flatMap((unit) =>
    [...unit.channels.values()].map((channel) => buildDevice(gladys, unit, channel, language)),
  );

test('every feature: labeled pair, bounds, read_only, has_feedback; no polling', () => {
  const gladys = createFakeGladys();
  for (const device of allDevices(gladys, 'en')) {
    assert.equal(device.should_poll, false, 'pushed, or read on the integration timer');
    assert.equal(device.poll_frequency, undefined);
    for (const feature of device.features) {
      const where = feature.external_id;
      assert.ok(
        LABELED[feature.category]?.has(feature.type),
        `${where} ${feature.category}/${feature.type}`,
      );
      for (const field of ['min', 'max', 'read_only', 'has_feedback', 'keep_history']) {
        assert.notEqual(feature[field], undefined, `${where} ${field}`);
      }
      assert.ok(feature.min <= feature.max, where);
      assert.ok(feature.name.length > 0, where);
    }
  }
});

test('the whole discovery list is accepted by the fake Gladys, in every language', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  for (const language of ['en', 'fr', 'de', 'es']) {
    const devices = allDevices(gladys, language);
    const result = await gladys.publishDiscoveredDevices(devices);
    assert.equal(result.count, devices.length);
  }
});

test('discovery baseline (0.1.0): external ids and compared fields never change', () => {
  // Changing a feature key, category, type, unit, min, max or step forces
  // users to delete and recreate their devices: update the baseline only on
  // purpose (UPDATE_BASELINE=1 npm test), with a migration note in the docs.
  const file = new URL('./fixtures/discovery.baseline.json', import.meta.url);
  const gladys = createFakeGladys();
  const describe = (device) => ({
    external_id: device.external_id,
    should_poll: device.should_poll,
    features: device.features.map((feature) => ({
      external_id: feature.external_id,
      category: feature.category,
      type: feature.type,
      unit: feature.unit ?? null,
      min: feature.min,
      max: feature.max,
      step: feature.step ?? null,
      read_only: feature.read_only,
    })),
  });
  const current = allDevices(gladys, 'en').map(describe);
  if (process.env.UPDATE_BASELINE) {
    writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
  }
  assert.deepEqual(current, JSON.parse(readFileSync(file, 'utf8')));
});

test('models, MAC addresses and clamp names', () => {
  assert.equal(modelCode('EM06P'), 'em06p');
  assert.equal(modelCode('refossem16p'), 'em16p');
  assert.equal(modelCode('P11S_EU'), 'p11s');
  assert.equal(normalizeMac('C4:E7:AE:00:00:01'), 'c4e7ae000001');
  assert.equal(normalizeMac('c4e7ae'), '');
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((id) => channelLabel('em06p', id)),
    ['A1', 'B1', 'C1', 'A2', 'B2', 'C2'],
  );
  assert.equal(channelLabel('em16p', 7), 'B1');
  assert.equal(channelLabel('em16', 18), 'C6');
  assert.equal(channelLabel('em01p', 1), 'A1');
});

test('RPC readers: units of each component, a relay in cover mode, merged notifications', () => {
  const unit = rpcUnit(plug());
  const outlet = unit.channels.get('switch1');
  assert.deepEqual(
    [outlet.on, outlet.power, outlet.voltage, outlet.current, outlet.month],
    [false, 1.5, 231.4, 0.02, 12.345],
  );
  assert.equal(unit.model, 'p11s');
  assert.equal(unit.temperature, 38.5);

  const blind = rpcUnit(shutter()).channels.get('cover1');
  assert.deepEqual(blind.cover, { state: 'closed', position: 0, calibrated: true });
  const uncalibrated = shutter();
  uncalibrated.status['cover:1'].cali_state = 'not_start';
  const raw = rpcUnit(uncalibrated).channels.get('cover1');
  assert.equal(raw.cover.position, null);
  assert.deepEqual(
    buildDevice(createFakeGladys(), rpcUnit(uncalibrated), raw, 'en').features.map((feature) =>
      feature.external_id.split(':').pop(),
    ),
    ['state'],
    'no position before the calibration',
  );

  const solar = rpcUnit(meter()).channels.get('em4');
  assert.deepEqual(
    [solar.label, solar.power, solar.month, solar.monthReturned, solar.name],
    ['A2', -812.3, 2.1, 96.8, 'Solaire'],
  );

  const status = structuredClone(plug().status);
  mergeStatus(status, { 'switch:1': { output: true }, ts: 1 });
  assert.equal(status['switch:1'].output, true);
  assert.equal(status['switch:1'].apower, 1500, 'what was not sent stays');
});

test('legacy readers: the UDP answer, one signed counter in Wh', () => {
  const announce = readLegacyAnnounce(oldRelay().announce());
  assert.deepEqual(announce.channels, [0]);
  assert.equal(announce.mac, '48e1e9000005');
  assert.equal(announce.model, 'r10');
  assert.equal(readLegacyAnnounce({ devName: 'x' }), null);
  const channels = readLegacyElectricity('em06', oldMeter().electricity);
  const solar = channels.get('em2');
  assert.deepEqual(
    [solar.label, solar.power, solar.month, solar.monthReturned],
    ['B1', -350, 0, 15.3],
  );
  assert.equal(pathOf('r10'), '/config');
  assert.equal(pathOf('em06'), '/public');
});

test('values and counters: rounded, lifetime total first, month otherwise', () => {
  const [outlet] = rpcUnit(plug()).channels.values();
  assert.deepEqual(channelValues(outlet), [
    ['state', 0],
    ['power', 1.5],
    ['voltage', 231],
    ['current', 0.02],
  ]);
  assert.deepEqual(channelCounters(outlet), [['energy', 12.345]]);
  const clamp = rpcUnit(meter()).channels.get('em1');
  clamp.total = 1520.25;
  assert.deepEqual(channelCounters(clamp), [
    ['energy', 1520.25],
    ['returned', 0],
  ]);
  const blind = rpcUnit(shutter()).channels.get('cover1');
  assert.deepEqual(channelValues(blind), [
    ['state', -1],
    ['position', 0],
  ]);
  assert.deepEqual(channelCounters(blind), [], 'the motor energy is not an index of the house');
});

test('commands: switch, shutter state and position; bad values refused', () => {
  const [outlet] = rpcUnit(plug()).channels.values();
  const blind = rpcUnit(shutter()).channels.get('cover1');
  const clamp = rpcUnit(meter()).channels.get('em1');
  assert.deepEqual(commandFor(outlet, 'state', 1), { action: 'switch', value: 1 });
  assert.deepEqual(commandFor(blind, 'state', -1), { action: 'cover', value: -1 });
  assert.deepEqual(commandFor(blind, 'position', 39.6), { action: 'position', value: 40 });
  assert.throws(() => commandFor(outlet, 'state', 2), RangeError);
  assert.throws(() => commandFor(blind, 'position', 120), RangeError);
  assert.throws(() => commandFor(clamp, 'power', 1), RangeError);
});

test('legacy messages: md5 signature with an empty key, the uuid of the box', () => {
  const { message, messageId } = buildMessage({
    method: 'GET',
    namespace: 'Appliance.Control.ToggleX',
    payload: { togglex: { channel: 65535 } },
    uuid: 'abc',
    now: () => 1760976000000,
  });
  assert.match(messageId, /^[0-9a-f]{32}$/);
  assert.equal(message.header.timestamp, 1760976000);
  assert.equal(message.header.uuid, 'abc');
  const expected = (id) =>
    // md5(messageId + '' + timestamp)
    import('node:crypto').then(({ createHash }) =>
      createHash('md5').update(`${id}1760976000`).digest('hex'),
    );
  return expected(messageId).then((sign) => assert.equal(message.header.sign, sign));
});

test('legacy search: the answer comes back to the fixed port, only typed addresses', async () => {
  const network = await new FakeNetwork([oldMeter(), oldRelay()]).start();
  try {
    const answers = await probeLegacy(['127.0.0.2', '127.0.0.3', '127.0.0.9'], {
      ...network.legacyProbe(),
      logger: silentLogger,
    });
    assert.deepEqual(answers.map((answer) => answer.mac).sort(), ['48e1e9000004', '48e1e9000005']);
    assert.ok(answers.every((answer) => ['127.0.0.2', '127.0.0.3'].includes(answer.host)));
    assert.deepEqual(await probeLegacy([], network.legacyProbe()), []);
  } finally {
    await network.stop();
  }
});

test('RPC digest: SHA-256 of the user admin, the realm and the password', () => {
  const auth = digestAuth(
    { realm: 'refossp11s-c4e7ae000001', nonce: 1760976000, nc: 1 },
    'pw',
    'cn',
  );
  assert.equal(auth.username, 'admin');
  assert.equal(auth.algorithm, 'SHA-256');
  assert.equal(auth.cnonce, 'cn');
  assert.match(auth.response, /^[0-9a-f]{64}$/);
  const fake = plug({ password: 'pw' });
  assert.equal(fake.devId, 'refossp11s-c4e7ae000001');
  fake.nonce = 1760976000;
  assert.ok(fake.authorized(auth), 'what the device recomputes');
  assert.ok(!fake.authorized(digestAuth({ realm: fake.devId, nonce: 1760976000 }, 'other', 'cn')));
});

test('mDNS: devices named refoss…, MAC from the name; typed addresses', () => {
  const devices = mdnsDevices([
    {
      name: 'refossem06p-c4e7ae000003._http._tcp.local',
      addresses: ['fe80::1', '192.168.1.52'],
      port: 80,
    },
    { name: 'Imprimante._http._tcp.local', addresses: ['192.168.1.99'], port: 80 },
    { name: 'refossp11s-c4e7ae000001._http._tcp.local', addresses: [], port: 80 },
  ]);
  assert.deepEqual(devices, [{ host: '192.168.1.52', mac: 'c4e7ae000003', port: 80 }]);
  assert.deepEqual(parseHosts(' 192.168.1.30,192.168.1.31;; 999.1.1.1 192.168.1.30'), [
    '192.168.1.30',
    '192.168.1.31',
  ]);
});

test('configuration: defaults, bounds', () => {
  assert.deepEqual(normalizeConfig({}), {
    hosts: [],
    password: '',
    refreshMs: 30000,
    rescanMs: 3600000,
    language: 'en',
  });
  const config = normalizeConfig({ refresh_interval: '7', rescan_interval: '0', language: 'xx' });
  assert.equal(config.refreshMs, 30000);
  assert.equal(config.rescanMs, 0);
  assert.equal(config.language, 'en');
});

test('states: only the created devices, coalesced, paused on 429', async () => {
  const clock = fakeClock();
  const sent = [];
  let refuse = false;
  const gladys = {
    publishChangedStates: async (states) => {
      if (refuse) {
        throw Object.assign(new Error('too many'), { status: 429 });
      }
      sent.push(...states);
      return { count: states.length };
    },
    forgetPublishedStates() {},
  };
  const publisher = createStatePublisher(gladys, {
    logger: silentLogger,
    now: clock.now,
    isCreated: (id) => id === 'dev',
  });
  publisher.push('dev:power', 10);
  publisher.push('dev:power', 20);
  publisher.push('other:power', 30);
  await publisher.flush();
  assert.deepEqual(sent, [{ device_feature_external_id: 'dev:power', state: 20 }]);
  refuse = true;
  publisher.push('dev:state', 1);
  await publisher.flush();
  refuse = false;
  assert.equal(await publisher.flush(), 0, 'paused');
  clock.advance(31 * 1000);
  assert.equal(await publisher.flush(), 1);
  publisher.stop();
});
