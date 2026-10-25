// The manifest and the code agree: every declared action, widget, trigger and
// configuration key has its code, every version says the same thing, and the
// manifest respects what the store and the Gladys core expect.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ACTIONS } from '../src/app.js';
import { DEFAULTS, LANGUAGES, REFRESH_INTERVALS, RESCAN_INTERVALS } from '../src/config.js';
import { MDNS_SERVICE } from '../src/refoss/discovery.js';
import {
  CLICK_VALUES,
  MAX_MINUTES,
  PROTECTION_VALUES,
  SCENE_ACTION_OUTPUTS,
  SCENE_ACTIONS,
  SCENE_TRIGGER_DATA,
  SCENE_TRIGGERS,
} from '../src/scenes.js';
import { INPUT_EVENTS, PROTECTIONS } from '../src/refoss/model.js';
import { WIDGETS } from '../src/widgets.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const byKey = (list) => Object.fromEntries(list.map((item) => [item.key, item]));
const values = (field) => field.options.map((option) => option.value);

test('one version everywhere, image of this repository', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-refoss:${pkg.version}`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/William-De71\/gladys-refoss\/main\/cover\.jpg$/,
  );
});

test('store rules: type, Gladys version, transports, categories, permissions', () => {
  assert.equal(manifest.type, 'device');
  // widgets and scene_* need 5.1.0, catalog keywords 5.3.0; no widget form,
  // no houses source.
  assert.equal(manifest.gladys_version, '>=5.3.0');
  // Everything stays on the local network (README "Transport").
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['energy', 'lighting']);
  assert.equal(manifest.name, 'Refoss');
  // Current models announce an HTTP server named `refoss…`; the first models
  // answer UDP to a fixed port the core cannot relay: no udp-active-broadcast.
  assert.deepEqual(manifest.network_discovery, [{ type: 'mdns', service: MDNS_SERVICE }]);
  for (const key of ['location', 'containers', 'webhooks', 'network_wake']) {
    assert.equal(manifest[key], undefined, key);
  }
});

test('configuration: keys, defaults and choices of the code, the password as a secret', () => {
  const fields = byKey(manifest.config_schema);
  assert.deepEqual(values(fields.language), LANGUAGES);
  assert.deepEqual(values(fields.refresh_interval), REFRESH_INTERVALS.map(String));
  assert.deepEqual(values(fields.rescan_interval), RESCAN_INTERVALS.map(String));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  assert.equal(fields.password.type, 'secret');
  assert.equal(fields.password.default, undefined);
  // `text` / `password` are refused by the store.
  for (const field of manifest.config_schema) {
    assert.ok(['string', 'select', 'secret', 'section'].includes(field.type), field.key);
  }
  assert.equal(fields.GLADYS_PREFER_LOCAL, undefined, 'one transport: no local preference');
});

test('configuration buttons: the keys of the code', () => {
  assert.deepEqual(
    manifest.actions.map((action) => action.key).sort(),
    Object.values(ACTIONS).sort(),
  );
});

test('scene triggers: keys, filters and variables of the code', () => {
  const triggers = byKey(manifest.scene_triggers);
  assert.deepEqual(Object.keys(triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
  for (const trigger of manifest.scene_triggers) {
    const declared = new Set([
      ...(trigger.fields ?? []).map((field) => field.key),
      ...(trigger.variables ?? []).map((variable) => variable.key),
    ]);
    assert.deepEqual(
      [...declared].sort(),
      [...SCENE_TRIGGER_DATA[trigger.key]].sort(),
      trigger.key,
    );
    const device = byKey(trigger.fields ?? []).device;
    if (device) {
      assert.equal(device.source, 'devices');
      assert.notEqual(device.required, true, 'empty: any device');
    }
  }
  assert.deepEqual(values(byKey(triggers.button_pressed.fields).click), CLICK_VALUES);
  assert.deepEqual(CLICK_VALUES, [...new Set(Object.values(INPUT_EVENTS))]);
  assert.deepEqual(values(byKey(triggers.protection_tripped.fields).protection), PROTECTION_VALUES);
  assert.deepEqual(PROTECTION_VALUES, PROTECTIONS);
});

test('scene actions: keys, fields and outputs of the code', () => {
  const actions = byKey(manifest.scene_actions);
  assert.deepEqual(Object.keys(actions).sort(), Object.values(SCENE_ACTIONS).sort());
  for (const action of manifest.scene_actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
    assert.deepEqual(
      action.outputs.map((output) => output.key),
      SCENE_ACTION_OUTPUTS[action.key],
      action.key,
    );
    const device = byKey(action.fields).device;
    assert.equal(device.source, 'devices');
    assert.equal(device.required, true);
  }
  const minutes = byKey(actions.switch_on_for.fields).minutes;
  assert.deepEqual([minutes.type, minutes.min, minutes.max], ['number', 1, MAX_MINUTES]);
});

test('widgets: the keys of the code, settings without secrets', () => {
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    Object.values(WIDGETS),
  );
  const widget = byKey(manifest.widgets).device;
  assert.equal(byKey(widget.settings).device.source, 'devices');
  for (const item of manifest.widgets) {
    for (const setting of item.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
});

test('catalog search terms of Gladys 5.3.0: keywords within bounds, countries', () => {
  assert.ok(Array.isArray(manifest.keywords));
  assert.ok(manifest.keywords.length >= 1 && manifest.keywords.length <= 10);
  const normalized = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  for (const keyword of normalized) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword);
  }
  assert.equal(new Set(normalized).size, normalized.length, 'keywords must be unique');
  assert.ok(!normalized.includes(manifest.name.toLowerCase()), 'the name is already searched');
  // Usable worldwide: no `countries` restriction.
  assert.equal(manifest.countries, undefined);
});
