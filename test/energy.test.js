// Energy indexes: counters that restart (month, lifetime after a reset)
// become indexes that only go up, as the Gladys energy monitoring needs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEnergyIndexes } from '../src/energy.js';
import { memoryStorage } from '../src/storage.js';
import { fakeClock } from './helpers.js';

const setup = (initial) => {
  const clock = fakeClock();
  const storage = memoryStorage(initial);
  const energy = createEnergyIndexes({ storage, now: clock.now });
  return { clock, storage, energy };
};

test('first reading: the index starts at the counter, then adds what it gains', async () => {
  const { energy } = setup();
  await energy.load();
  assert.equal(energy.update('a', null), null);
  assert.equal(energy.update('a', 12.5), 12.5);
  assert.equal(energy.update('a', 13.25), 13.25);
  assert.equal(energy.update('a', 13.25), 13.25);
  assert.equal(energy.update('a', -1), 13.25, 'nonsense ignored');
  assert.equal(energy.index('a'), 13.25);
});

test('jitter: a small drop is ignored, and does not count twice when it comes back', async () => {
  const { energy } = setup();
  await energy.load();
  energy.update('a', 100);
  assert.equal(energy.update('a', 99.5), 100);
  assert.equal(energy.update('a', 100.2), 100.2);
});

test('a reboot reading 0 for a few seconds is not a new month', async () => {
  const { energy, clock } = setup();
  await energy.load();
  energy.update('a', 300);
  assert.equal(energy.update('a', 0), 300);
  clock.advance(20 * 1000);
  assert.equal(energy.update('a', 0), 300);
  clock.advance(10 * 1000);
  assert.equal(energy.update('a', 300.4), 300.4);
});

test('a new month: the drop lasts, the new counter is added from zero', async () => {
  const { energy, clock } = setup();
  await energy.load();
  energy.update('a', 300);
  assert.equal(energy.update('a', 0.1), 300);
  clock.advance(61 * 1000);
  assert.equal(energy.update('a', 0.3), 300.3);
  assert.equal(energy.update('a', 1.3), 301.3);
});

test('saved in /data and read back after a restart', async () => {
  const { energy, storage } = setup();
  await energy.load();
  energy.update('a', 42.123456);
  await energy.save();
  assert.deepEqual(storage.files['energy.json'], {
    a: { index: 42.1235, last: 42.123456, dropSince: null },
  });
  const again = createEnergyIndexes({ storage });
  await again.load();
  assert.equal(again.update('a', 43.123456), 43.1235);
  await again.stop();
});
