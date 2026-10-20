# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for **Refoss** devices: Wi-Fi
plugs, relays, shutter modules and energy monitors. A Node.js service (Node
22+, ESM, no build step; dependencies: the SDK and `ws`) in its own sandboxed
Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to the devices **on the local network only** (`transports: ["local"]`).

A **device integration** (`type: "device"`, Gladys 5.1.0+: widgets and
scenes). The clients in `src/refoss/` were written from the official Refoss
code, MIT: [aiorefoss](https://github.com/Refoss/aiorefoss) and
[refoss_rpc](https://github.com/Refoss/refoss_rpc) (current models),
[refoss_ha](https://github.com/ashionky/refoss_ha) (first models), and
[ioBroker.refoss](https://github.com/Refoss/ioBroker.refoss) (clamp names).

## Commands

```bash
npm install
npm test                                  # node --test, never leaves 127.0.0.1
node --test test/app.test.js              # one file
node --test --test-name-pattern "widgets" # tests whose name matches
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check
docs/illustrations/render.sh              # widget illustrations (Chrome, ImageMagick, Pillow)
scripts/build-cover.sh                    # cover.jpg from cover.svg (Inkscape, ImageMagick)
```

## Architecture

```
index.js                     SDK wiring only: createApp(gladys) + connect + start
src/app.js                   every handler: discovery, commands, sampling, scene events and actions, widgets, status
src/hub.js                   the boxes: RPC socket (push) or legacy timer (poll), reconnection, commands
src/devices.js               channel -> Gladys device (features), values, counters, commands
src/energy.js                counters that restart -> indexes that only go up (/data/energy.json)
src/states.js                state publication: created devices only, coalesced, 240/min, 429 pause
src/scenes.js                scene trigger / action keys, event data, filter values
src/widgets.js               the `power` and `device` widgets (pure, reused by docs/illustrations)
src/i18n.js                  runtime texts in en / fr / de / es, numbers per language
src/storage.js               JSON files in /data (devices.json, energy.json, timers.json)
src/config.js                config_schema -> { hosts, password, refreshMs, rescanMs, language }
src/refoss/model.js          both generations -> units and channels, in W, V, A, kWh
src/refoss/rpc.js            WebSocket JSON-RPC client (/rpc), digest authentication
src/refoss/legacy.js         signed HTTP messages (/config, /public), UDP search 9988 -> 9989
src/refoss/discovery.js      mediated mDNS scan (`_http._tcp`, names `refoss…`), typed addresses
test/helpers/                fake devices (real HTTP + ws servers, UDP) and fake LAN
.github/scripts/release.mjs  version, changelog, version files, PR title checks
```

## Rules

- **External ids are forever**: `ext:{selector}:switch:{mac}-switch{n}`,
  `…:cover:{mac}-cover{n}`, `…:meter:{mac}-em{n}` (MAC: 12 lower case hex
  digits), `…:<feature key>` (`state`, `position`, `power`, `voltage`,
  `current`, `energy`, `returned`). Config, action, field, widget, trigger,
  variable, output keys and the select values (`single`, `double`…,
  `overpower`…) too.
- **One Gladys device per channel**, never per box: the energy monitoring adds
  up one index per device, and each clamp is a circuit the user names.
- **Units**: RPC switches report mW, mV, mA and Wh; RPC clamps W, V, A and
  kWh; legacy devices mW, mV, mA and a signed monthly counter in Wh. Convert
  in `src/refoss/model.js` only: everything after it is W, V, A, kWh.
- **Energy indexes** come from `src/energy.js` only (never a raw monthly
  counter: Gladys would see a drop every first of the month).
- **Feature fields** compared by the Discover "Update" (category, type, unit,
  min, max, step, features added or removed): the baseline pins them.
- **Sampling**: on / off and shutters are published at once; power, voltage,
  current and indexes on the refresh interval (`sample()`), to stay under the
  300 states a minute of Gladys with an EM16P.
- **Scene events**: one per transition or press; never fired by a scene action.
- **The container rootfs is read-only**: the only writable folder is /data.
- **Widget content**: after any change, run `docs/illustrations/render.sh` and
  look at the four images. Budget: 2 texts, 1 focal, 6 tiles, 1 status, 4
  buttons.
- **User-facing text** exists in en, fr, de and es: manifest, `src/i18n.js`,
  `docs/*.md`, `README*.md`. `test/i18n.test.js` checks it.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, `package-lock.json` or the manifest, nor the `docker_image`
  tag.
- **Changelog**: Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why,
  in English.

## Pitfalls

- The first models answer the UDP search (port 9988) to the **fixed** port
  9989 of the sender: the mediated `udp-active-broadcast` of the core (random
  source port) never hears them. They are asked at the typed addresses from
  the container, bound to 9989 (the Docker NAT brings the answer back).
- The current models announce `_http._tcp` with an instance name
  `refoss<model>-<mac>`: filter on it, the scan also returns printers, NAS…
- A device protected by a password answers the RPC calls with error 401 and
  a JSON challenge `{ realm, nonce, nc }`; EM16P firmware 3.1.11+ wants it
  even for `Refoss.DeviceInfo.Get`.
- `NotifyStatus` only carries what changed: merge it (`mergeStatus`).
- The R10 answers on `/config`, the energy monitors on `/public`.
- A relay in cover mode reports `cover:1` and no `switch:1`; the position
  exists only once the motor is calibrated (`cali_state: "success"`).
- Gladys does not send the user's language with a scan or a command: feature
  names and scene errors use the `language` setting.
- Never tested on a real device: when a user reports a difference, fix the
  fake devices in `test/helpers/` first, then the code.
