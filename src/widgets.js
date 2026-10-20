// -----------------------------------------------------------------------------
// Dashboard widgets.
//
//   power    every Refoss device added to Gladys at a glance, the hungriest
//            first: live power, energy of the month, on / off, and the boxes
//            that do not answer or want a password
//   device   one channel (setting `device`): live power, today and this
//            month (the counters of the box, which Gladys has no feature
//            for), the power curve of the last 24 hours, its state, and the
//            buttons on / off or open / stop / close
//
// Pure: the build functions turn a snapshot into a content, so the tests and
// docs/illustrations/gen.mjs use the exact code Gladys gets. Every text is
// multi-language: Gladys caches the content per language.
// -----------------------------------------------------------------------------

import { number, t, truncate } from './i18n.js';

export const WIDGETS = { POWER: 'power', DEVICE: 'device' };
export const POWER_TTL_SECONDS = 30;
export const DEVICE_TTL_SECONDS = 60;

const MAX_CARDS = 8;
const MAX_PROBLEMS = 4;
// Below this, an outlet is idle (a plug draws a little for itself).
const IDLE_W = 2;

/**
 * @typedef {object} ChannelView
 * @property {string} deviceId - Gladys external id.
 * @property {string} name - Device name in Gladys.
 * @property {'switch'|'cover'|'em'} kind - What it is.
 * @property {boolean} reachable - The box answers.
 * @property {string|null} authError - `required` or `wrong`: the box wants a password.
 * @property {boolean|null} on - Outlet on (switch only).
 * @property {{ state: string, position: number|null }|null} cover - Shutter (cover only).
 * @property {boolean} metering - It measures power and energy.
 * @property {number|null} power - Watts (below zero: sending back).
 * @property {number|null} today - kWh today (EM*P only).
 * @property {number|null} month - kWh this month.
 * @property {number|null} monthReturned - kWh sent back this month (clamps).
 * @property {string[]} protections - Protections active (`overpower`…).
 * @property {object} features - Feature external ids: `{ state, position, power }`.
 */

const kwh = (value) => number(value, value >= 100 ? 0 : value >= 10 ? 1 : 2, 'kWh');
const watts = (value) => number(value, Math.abs(value) >= 100 ? 0 : 1, 'W');

/**
 * @description What a channel does, in words.
 * @param {ChannelView} view - Channel.
 * @returns {{ text: object, color: string }} The text and its color.
 */
export function stateText(view) {
  if (!view.reachable) {
    return {
      text: view.authError ? t('widgetPasswordNeeded') : t('stateUnreachable'),
      color: 'danger',
    };
  }
  if (view.kind === 'switch') {
    return view.on
      ? { text: t('stateOn'), color: 'success' }
      : { text: t('stateOff'), color: 'neutral' };
  }
  if (view.kind === 'cover') {
    const state = view.cover?.state;
    const known = {
      open: ['stateOpen', 'success'],
      closed: ['stateClosed', 'neutral'],
      opening: ['stateOpening', 'primary'],
      closing: ['stateClosing', 'primary'],
    }[state] ?? ['stateStopped', 'warning'];
    return { text: t(known[0]), color: known[1] };
  }
  if (Number.isFinite(view.power) && view.power < -IDLE_W) {
    return { text: t('stateReturning'), color: 'success' };
  }
  return Number.isFinite(view.power) && view.power > IDLE_W
    ? { text: t('stateConsuming'), color: 'primary' }
    : { text: t('stateIdle'), color: 'neutral' };
}

const powerColor = (power) => {
  if (power < -IDLE_W) {
    return 'success';
  }
  return power > IDLE_W ? 'primary' : 'neutral';
};

/**
 * @description The `device` widget.
 * @param {ChannelView|null} view - The channel, null when the setting points nowhere.
 * @returns {object} The widget content.
 */
export function buildDeviceWidget(view) {
  if (!view) {
    return {
      version: 1,
      ttl_seconds: DEVICE_TTL_SECONDS,
      components: [{ type: 'text', text: t('widgetChooseDevice'), variant: 'caption' }],
    };
  }
  const components = [{ type: 'text', text: truncate(view.name, 40), variant: 'heading' }];
  const { features } = view;
  if (view.metering && features.power) {
    components.push({ type: 'value', label: t('widgetPower'), device_feature: features.power });
  }
  if (view.metering && view.reachable) {
    if (Number.isFinite(view.today)) {
      components.push({
        type: 'value',
        label: t('widgetToday'),
        value: Math.round(view.today * 100) / 100,
        unit: 'kWh',
        color: 'info',
      });
    }
    if (Number.isFinite(view.month)) {
      components.push({
        type: 'value',
        label: t('widgetMonth'),
        value: Math.round(view.month * 10) / 10,
        unit: 'kWh',
        color: 'info',
      });
    }
    if (view.kind === 'em' && view.monthReturned > 0) {
      components.push({
        type: 'value',
        label: t('widgetReturnedMonth'),
        value: Math.round(view.monthReturned * 10) / 10,
        unit: 'kWh',
        color: 'success',
      });
    }
  }
  if (view.kind === 'cover' && features.position) {
    components.push({
      type: 'value',
      label: t('widgetPosition'),
      device_feature: features.position,
    });
  }
  if (view.metering && features.power) {
    components.push({
      type: 'chart',
      title: t('widgetPowerChart'),
      chart_type: 'area',
      device_features: [features.power],
      interval: 'last-day',
    });
  }

  const state = stateText(view);
  const items = [{ label: t('widgetState'), value: state.text, color: state.color }];
  for (const protection of view.protections.slice(0, 2)) {
    items.push({
      label: t('widgetProtection'),
      value: t(`protection_${protection}`),
      color: 'danger',
    });
  }
  components.push({ type: 'status', items });
  if (!view.reachable) {
    return { version: 1, ttl_seconds: DEVICE_TTL_SECONDS, components };
  }

  if (view.kind === 'switch' && features.state) {
    components.push({
      type: 'button',
      label: view.on ? t('widgetTurnOff') : t('widgetTurnOn'),
      icon: 'power',
      style: 'primary',
      device_feature: features.state,
      value: view.on ? 0 : 1,
    });
  } else if (view.kind === 'cover' && features.state) {
    components.push(
      {
        type: 'button',
        label: t('widgetOpen'),
        icon: 'arrow-up',
        style: 'secondary',
        device_feature: features.state,
        value: 1,
      },
      {
        type: 'button',
        label: t('widgetStop'),
        icon: 'pause',
        style: 'secondary',
        device_feature: features.state,
        value: 0,
      },
      {
        type: 'button',
        label: t('widgetClose'),
        icon: 'arrow-down',
        style: 'secondary',
        device_feature: features.state,
        value: -1,
      },
    );
  }
  return { version: 1, ttl_seconds: DEVICE_TTL_SECONDS, components };
}

/**
 * @typedef {object} BoxView
 * @property {string} name - Name of the box.
 * @property {boolean} reachable - It answers.
 * @property {string|null} authError - `required` or `wrong`.
 */

/**
 * @description The `power` widget.
 * @param {{ channels: ChannelView[], boxes: BoxView[] }} view - Snapshot.
 * @returns {object} The widget content.
 */
export function buildPowerWidget({ channels, boxes }) {
  const components = [];
  if (channels.length === 0) {
    components.push({ type: 'text', text: t('widgetNoDevice'), variant: 'caption' });
  } else {
    const measured = channels.filter((view) => view.metering);
    const on = channels.filter((view) => view.reachable && view.on).length;
    components.push({
      type: 'text',
      text: t('widgetSummary', { count: measured.length, on }),
      variant: 'caption',
    });
    const sorted = [...channels].sort(
      (a, b) =>
        Number(b.reachable) - Number(a.reachable) ||
        Math.abs(b.power ?? -1) - Math.abs(a.power ?? -1) ||
        a.name.localeCompare(b.name),
    );
    components.push({
      type: 'card-list',
      display: 'list',
      items: sorted.slice(0, MAX_CARDS).map((view) => {
        const state = stateText(view);
        const item = { title: truncate(view.name, 60) };
        if (!view.reachable) {
          item.subtitle = state.text;
          item.badge = { text: '—', color: 'danger' };
          return item;
        }
        const parts = [];
        if (view.kind !== 'em') {
          parts.push(state.text);
        }
        if (view.kind === 'em' && view.monthReturned > (view.month ?? 0)) {
          // A clamp on a solar line: what it sent back is what matters.
          parts.push(t('widgetReturnedShort', { energy: kwh(view.monthReturned) }));
        } else if (view.metering && Number.isFinite(view.month)) {
          parts.push(t('widgetMonthShort', { energy: kwh(view.month) }));
        }
        item.subtitle = Object.fromEntries(
          Object.keys(parts[0] ?? { en: '' }).map((language) => [
            language,
            parts.map((part) => part[language]).join(' · '),
          ]),
        );
        if (view.metering && Number.isFinite(view.power)) {
          item.badge = { text: watts(view.power), color: powerColor(view.power) };
        } else if (view.kind === 'cover' && Number.isFinite(view.cover?.position)) {
          item.badge = { text: `${Math.round(view.cover.position)} %`, color: state.color };
        }
        return item;
      }),
    });
  }
  if (boxes.length > 0) {
    const problems = boxes.filter((box) => !box.reachable);
    components.push({
      type: 'status',
      items:
        problems.length === 0
          ? [
              {
                label: t('widgetBoxes'),
                value: t('widgetAllOnline', { count: boxes.length }),
                color: 'success',
              },
            ]
          : problems.slice(0, MAX_PROBLEMS).map((box) => ({
              label: truncate(box.name, 40),
              value: box.authError ? t('widgetPasswordNeeded') : t('widgetOffline'),
              color: 'danger',
            })),
    });
  }
  return { version: 1, ttl_seconds: POWER_TTL_SECONDS, components };
}
