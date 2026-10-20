// -----------------------------------------------------------------------------
// Energy indexes that only go up, for the Gladys energy monitoring.
//
// Gladys computes consumption and cost from an `energy-sensor/index` feature:
// a meter index in kWh that never goes down. Refoss devices give counters
// that restart: this month (every model), today and this week (EM*P), and a
// lifetime total on recent EM*P firmware only. This module turns any of them
// into an index: it adds what the counter gained since the last reading.
//
//   counter goes up             index += the difference
//   small drop (< 20 %)         rounding or firmware jitter: ignored
//   large drop                  maybe a reboot reading 0 for a few seconds,
//                               maybe the start of a new month: it must last
//                               a minute to count as a restart (then the new
//                               value is added, from zero)
//
// The first reading starts the index at the counter itself (the energy of
// the month so far, or the lifetime total). Indexes and last readings live
// in /data/energy.json, so a restart of the integration loses nothing.
// -----------------------------------------------------------------------------

const JITTER = 0.2;
const RESET_CONFIRM_MS = 60 * 1000;
const SAVE_DELAY_MS = 30 * 1000;
const FILE = 'energy.json';

const round = (value) => Math.round(value * 10000) / 10000;

/**
 * @description Create the index keeper.
 * @param {object} deps - Dependencies.
 * @param {object} deps.storage - src/storage.js storage.
 * @param {Function} [deps.now] - Clock (ms).
 * @param {object} [deps.logger] - Logger.
 * @returns {object} `{ load, update, index, save, stop }`.
 */
export function createEnergyIndexes({ storage, now = Date.now, logger }) {
  let counters = {};
  let timer = null;
  let dirty = false;

  const save = async () => {
    clearTimeout(timer);
    timer = null;
    if (!dirty) {
      return;
    }
    dirty = false;
    try {
      await storage.write(FILE, counters);
    } catch (error) {
      dirty = true;
      logger?.warn(`Refoss: saving the energy indexes failed: ${error.message}`);
    }
  };

  const scheduleSave = () => {
    dirty = true;
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        save();
      }, SAVE_DELAY_MS);
      timer.unref?.();
    }
  };

  return {
    async load() {
      const saved = await storage.read(FILE);
      counters = {};
      for (const [id, state] of Object.entries(saved ?? {})) {
        if (Number.isFinite(state?.index) && Number.isFinite(state?.last)) {
          counters[id] = { index: state.index, last: state.last, dropSince: null };
        }
      }
    },

    /**
     * @description A new reading of a counter.
     * @param {string} id - Feature external id of the index.
     * @param {number|null} counter - The device counter, kWh.
     * @returns {number|null} The index, null while unknown.
     */
    update(id, counter) {
      const state = counters[id];
      const value = Number(counter);
      if (counter === null || counter === undefined || !Number.isFinite(value) || value < 0) {
        return state ? state.index : null;
      }
      if (!state) {
        counters[id] = { index: round(value), last: value, dropSince: null };
        scheduleSave();
        return counters[id].index;
      }
      if (value >= state.last) {
        if (value > state.last) {
          state.index = round(state.index + value - state.last);
          state.last = value;
          scheduleSave();
        }
        state.dropSince = null;
        return state.index;
      }
      if ((state.last - value) / state.last < JITTER) {
        return state.index;
      }
      if (state.dropSince === null) {
        state.dropSince = now();
        return state.index;
      }
      if (now() - state.dropSince < RESET_CONFIRM_MS) {
        return state.index;
      }
      // The counter restarted (new day, week or month): what it shows was used since.
      state.index = round(state.index + value);
      state.last = value;
      state.dropSince = null;
      scheduleSave();
      return state.index;
    },

    /** @returns {number|null} The current index of a feature. */
    index: (id) => counters[id]?.index ?? null,

    save,

    async stop() {
      await save();
    },
  };
}
