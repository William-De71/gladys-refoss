// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK and the fake Refoss devices of the tests (real local sockets), on a
// made-up autumn evening: the heat pump and the oven run, the solar panels
// still send a little back, the washing machine finishes its cycle.
// What the core fills in from the features is filled in here the same way: a
// tile bound to a feature shows its last published state, and a chart bound
// to a feature shows its history (a made-up day, seeded, the same every run).
// Written as JSON for render.js: node gen.mjs <repo> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { createApp } = await load('src/app.js');
const { LANGUAGES } = await load('src/i18n.js');
const { memoryStorage } = await load('src/storage.js');
const { createFakeGladys } = await import(
  pathToFileURL(join(repo, 'node_modules/@gladysassistant/integration-sdk/lib/testing.js')).href
);
const { FakeNetwork, meter, plug, shutter } = await load('test/helpers.js');

const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));
const silent = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent };
// The "now" of the illustrations: 20 October 2026, 7 pm in Paris.
const NOW = Date.parse('2026-10-20T17:00:00Z');

const NAMES = {
  heatPump: { en: 'Heat pump', fr: 'Pompe à chaleur', de: 'Wärmepumpe', es: 'Bomba de calor' },
  waterHeater: { en: 'Water heater', fr: 'Chauffe-eau', de: 'Warmwasser', es: 'Termo' },
  oven: { en: 'Oven', fr: 'Four', de: 'Backofen', es: 'Horno' },
  solar: { en: 'Solar panels', fr: 'Panneaux solaires', de: 'Solaranlage', es: 'Paneles solares' },
  lighting: { en: 'Lighting', fr: 'Éclairage', de: 'Beleuchtung', es: 'Iluminación' },
  fridge: { en: 'Fridge', fr: 'Réfrigérateur', de: 'Kühlschrank', es: 'Frigorífico' },
  washer: { en: 'Washing machine', fr: 'Lave-linge', de: 'Waschmaschine', es: 'Lavadora' },
  shutter: {
    en: 'Living room shutter',
    fr: 'Volet séjour',
    de: 'Rollladen Wohnzimmer',
    es: 'Persiana salón',
  },
};

/** A seeded pseudo-random generator (mulberry32): the same curve every run. */
function random(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 24 hours of a heat pump: long cycles, more at night and in the evening. */
function heatPumpDay() {
  const next = random(20261020);
  const points = [];
  let running = true;
  for (let minutes = 24 * 60; minutes >= 0; minutes -= 15) {
    const t = NOW - minutes * 60 * 1000;
    const hour = (new Date(t).getUTCHours() + 2) % 24;
    const demand = hour < 7 || hour >= 18 ? 1 : hour < 10 ? 0.6 : 0.25;
    // A compressor runs for a while once started: change state now and then.
    if (next() < 0.3) {
      running = next() < demand;
    }
    const v = running
      ? Math.round(700 + demand * 1300 + next() * 250)
      : Math.round(18 + next() * 8);
    points.push({ t: new Date(t).toISOString(), v });
  }
  return points;
}

/**
 * @description One language: the heat pump in the device widget, and the overview.
 * @param {string} language - Language.
 * @returns {Promise<object>} The widget contents.
 */
async function contents(language) {
  const name = (key) => NAMES[key][language];
  const box = meter({
    name: 'EM06P',
    password: '',
    config: {
      'em:1': { name: name('heatPump') },
      'em:2': { name: name('waterHeater') },
      'em:3': { name: name('oven') },
      'em:4': { name: name('solar') },
      'em:5': { name: name('lighting') },
      'em:6': { name: name('fridge') },
    },
  });
  for (const [id, power, current, month] of [
    [1, 2140.6, 9.3, 120.5],
    [2, 0, 0, 98.6],
    [6, 92.4, 0.62, 21.7],
  ]) {
    Object.assign(box.status[`em:${id}`], { power, current, month_energy: month });
  }
  const washer = plug({ config: { 'switch:1': { name: name('washer') } } });
  washer.status['switch:1'].output = true;
  washer.status['switch:1'].apower = 412300;
  const blind = shutter({ config: { 'cover:1': { name: name('shutter') } } });
  Object.assign(blind.status['cover:1'], { state: 'stopped', current_pos: 35 });

  const network = await new FakeNetwork([box, washer, blind]).start();
  const gladys = createFakeGladys({ config: { language } });
  gladys.scanNetwork = async () => network.mdns();
  const app = createApp(gladys, {
    endpoints: network.endpoints,
    storage: memoryStorage(),
    logger: silent,
    now: () => NOW,
  });
  await gladys.connect();
  await app.start();
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(structuredClone(device));
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  await app.flushStates();
  const heatPump = gladys.fake.discoveredDevices.find((device) =>
    device.external_id.endsWith('-em1'),
  ).external_id;
  const get = async (key, settings) =>
    (await gladys.fake.widgetGet(key, { settings, language })).data.content;
  const device = await get('device', { device: heatPump });
  const power = await get('power', {});
  for (const component of device.components) {
    if (component.type === 'value' && component.device_feature) {
      component.value = gladys.fake.lastState(component.device_feature);
      component.unit = 'W';
    }
    if (component.type === 'chart' && component.device_features) {
      component.series = [{ name: device.components[0].text, points: heatPumpDay() }];
      component.unit = 'W';
    }
  }
  await app.stop();
  await network.stop();
  return { device, power };
}

const all = {};
for (const language of LANGUAGES) {
  all[language] = await contents(language);
}

const card = (key) => {
  const widget = manifest.widgets.find((item) => item.key === key);
  return { icon: widget.icon, label: widget.label };
};
writeFileSync(
  out,
  JSON.stringify({
    contents: all,
    images: {},
    cards: { device: card('device'), power: card('power') },
  }),
);
