// Fake Refoss devices on real local sockets, faithful to what the official
// clients (Refoss/aiorefoss, Refoss/refoss_ha) send and expect:
//
//   FakeRpcDevice     R11, R21, P11S, EM06P…: HTTP `GET /rpc/Refoss.DeviceInfo.Get`
//                     and the WebSocket `/rpc` (JSON-RPC frames, NotifyStatus,
//                     NotifyEvent, SHA-256 digest when a password is set)
//   FakeLegacyDevice  R10, EM06, EM16: signed messages posted to /config or
//                     /public, and the UDP search (question on 9988, answer to
//                     the fixed port 9989 of the sender)
//
// Nothing leaves 127.0.0.1: the "LAN addresses" of the RPC devices are mapped
// to local ports by `FakeNetwork.endpoints`; the legacy devices listen on
// 127.0.0.x addresses for the UDP search.

import { createHash, randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const md5 = (value) => createHash('md5').update(value).digest('hex');

const merge = (target, source) => {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key]) {
      merge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
};

const listen = (server, port = 0) =>
  new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));

// --- RPC generation -------------------------------------------------------------------------

export class FakeRpcDevice {
  /**
   * @param {object} options - `{ mac, host, model, name, password, status, config, fwVersion, authOnInfo }`.
   */
  constructor({
    mac,
    host,
    model,
    name = '',
    password = '',
    status,
    config = {},
    fwVersion = '1.2.6',
    authOnInfo = false,
  }) {
    this.mac = mac.toUpperCase().match(/../g).join(':');
    this.host = host;
    this.model = model;
    this.name = name;
    this.password = password;
    this.status = structuredClone(status);
    this.config = structuredClone(config);
    this.fwVersion = fwVersion;
    this.authOnInfo = authOnInfo;
    this.devId = `refoss${model}-${mac.toLowerCase()}`;
    this.requests = [];
    this.clients = new Set();
    this.nonce = Math.floor(Date.parse('2026-10-20T18:00:00Z') / 1000);
    this.port = 0;
  }

  info() {
    return {
      name: this.name || null,
      dev_id: this.devId,
      mac: this.mac,
      model: this.model.toUpperCase(),
      fw_ver: this.fwVersion,
      hw_ver: '1.0.0',
      auth_en: Boolean(this.password),
    };
  }

  challenge() {
    return JSON.stringify({
      auth_type: 'digest',
      nonce: this.nonce,
      nc: 1,
      realm: this.devId,
      algorithm: 'SHA-256',
    });
  }

  authorized(auth) {
    if (!this.password) {
      return true;
    }
    if (!auth || auth.nonce !== this.nonce || auth.username !== 'admin') {
      return false;
    }
    const ha1 = sha256(`admin:${this.devId}:${this.password}`);
    const ha2 = sha256('dummy_method:dummy_uri');
    return auth.response === sha256(`${ha1}:${this.nonce}:1:${auth.cnonce}:auth:${ha2}`);
  }

  async start() {
    this.server = createServer((request, response) => {
      this.requests.push({ transport: 'http', method: request.method, url: request.url });
      if (request.method === 'GET' && request.url === '/rpc/Refoss.DeviceInfo.Get') {
        if (this.password && this.authOnInfo) {
          response.writeHead(401).end();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(this.info()));
        return;
      }
      response.writeHead(404).end();
    });
    this.wss = new WebSocketServer({ server: this.server, path: '/rpc' });
    this.wss.on('connection', (socket) => {
      socket.on('message', (data) => this.onFrame(socket, JSON.parse(data.toString('utf8'))));
      socket.on('close', () => this.clients.delete(socket));
    });
    this.port = await listen(this.server, this.port);
    return this;
  }

  onFrame(socket, frame) {
    this.clients.add(socket);
    this.requests.push({ transport: 'ws', method: frame.method, params: frame.params });
    const reply = (body) =>
      socket.send(JSON.stringify({ id: frame.id, src: this.devId, dst: frame.src, ...body }));
    const open = frame.method === 'Refoss.DeviceInfo.Get' && !this.authOnInfo;
    if (!open && !this.authorized(frame.auth)) {
      reply({ error: { code: 401, message: this.challenge() } });
      return;
    }
    const params = frame.params ?? {};
    switch (frame.method) {
      case 'Refoss.DeviceInfo.Get':
        reply({ result: this.info() });
        return;
      case 'Refoss.Config.Get':
        reply({ result: this.config });
        return;
      case 'Refoss.Status.Get':
        reply({ result: this.status });
        return;
      case 'Switch.Action.Set': {
        const key = `switch:${params.id}`;
        if (!this.status[key]) {
          reply({ error: { code: -105, message: `Argument 'id', value ${params.id} not found!` } });
          return;
        }
        const was = this.status[key].output;
        const on = params.action === 'toggle' ? !was : params.action === 'on';
        reply({ result: { was_on: was } });
        this.notify({ [key]: { output: on } });
        return;
      }
      case 'Cover.Action.Set': {
        const key = `cover:${params.id}`;
        const state = { open: 'opening', close: 'closing', stop: 'stopped' }[params.action];
        reply({ result: {} });
        this.notify({ [key]: { state } });
        return;
      }
      case 'Cover.Pos.Set': {
        const key = `cover:${params.id}`;
        reply({ result: {} });
        this.notify({ [key]: { current_pos: params.pos, state: 'stopped' } });
        return;
      }
      case 'Refoss.Device.Reboot':
        reply({ result: null });
        return;
      default:
        reply({ error: { code: 404, message: `No handler for ${frame.method}` } });
    }
  }

  /** A status change: kept and pushed to every client, as the firmware does. */
  notify(partial) {
    merge(this.status, structuredClone(partial));
    this.broadcast('NotifyStatus', { ts: 1760976000, ...partial });
  }

  /** Button events (`[{ component: 'input:1', id: 1, event: 'button_single_push' }]`). */
  event(events) {
    this.broadcast('NotifyEvent', { ts: 1760976000, events });
  }

  broadcast(method, params) {
    for (const socket of this.clients) {
      socket.send(JSON.stringify({ src: this.devId, dst: 'client', method, params }));
    }
  }

  /** Unplugged: every connection drops, nothing answers until `start()`. */
  async stop() {
    for (const socket of this.wss?.clients ?? []) {
      socket.terminate();
    }
    this.clients.clear();
    await new Promise((resolve) => this.wss?.close(() => resolve()) ?? resolve());
    await new Promise((resolve) => this.server?.close(() => resolve()) ?? resolve());
    this.server = null;
    this.wss = null;
  }
}

// --- Legacy generation ------------------------------------------------------------------------

export class FakeLegacyDevice {
  /**
   * @param {object} options - `{ mac, uuid, host, model, name, channels, electricity, toggles }`.
   */
  constructor({ mac, uuid, host, model, name, channels, electricity = [], toggles = {} }) {
    this.mac = mac.toLowerCase().match(/../g).join(':');
    this.uuid = uuid;
    this.host = host;
    this.model = model;
    this.name = name ?? model;
    this.channels = channels;
    this.electricity = structuredClone(electricity);
    this.toggles = { ...toggles };
    this.requests = [];
    this.port = 0;
    this.searchPort = 0;
    this.answerPort = 0;
  }

  announce() {
    return {
      uuid: this.uuid,
      devName: this.name,
      deviceType: this.model,
      devSoftWare: '3.1.4',
      devHardWare: '3.0.0',
      ip: this.host,
      port: '80',
      mac: this.mac,
      subType: 'eu',
      // The firmware sends the list as a JSON string.
      channels: JSON.stringify(this.channels),
    };
  }

  answer(header, method, payload) {
    return {
      header: {
        messageId: header.messageId,
        namespace: header.namespace,
        method: `${method}ACK`,
        payloadVersion: 1,
        from: `/appliance/${this.uuid}/publish`,
        uuid: this.uuid,
        timestamp: header.timestamp,
        sign: header.sign,
      },
      payload,
    };
  }

  handle(message) {
    const { header, payload } = message;
    if (header.sign !== md5(`${header.messageId}${header.timestamp}`)) {
      return {
        header: { ...header, method: 'ERROR' },
        payload: { error: { code: 5001, detail: 'sign error' } },
      };
    }
    if (header.namespace === 'Appliance.Control.ToggleX' && header.method === 'GET') {
      return this.answer(header, 'GET', {
        togglex: Object.entries(this.toggles).map(([channel, on]) => ({
          channel: Number(channel),
          onoff: on ? 1 : 0,
          lmTime: 1760976000,
        })),
      });
    }
    if (header.namespace === 'Appliance.Control.ToggleX' && header.method === 'SET') {
      this.toggles[payload.togglex.channel] = payload.togglex.onoff === 1;
      return this.answer(header, 'SET', {});
    }
    if (header.namespace === 'Appliance.Control.ElectricityX' && header.method === 'GET') {
      return this.answer(header, 'GET', { electricity: structuredClone(this.electricity) });
    }
    return this.answer(header, header.method, {});
  }

  async start({ searchPort, answerPort }) {
    this.searchPort = searchPort;
    this.answerPort = answerPort;
    const path = this.model === 'r10' ? '/config' : '/public';
    this.server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        if (request.method !== 'POST' || request.url !== path) {
          response.writeHead(404).end();
          return;
        }
        const message = JSON.parse(body);
        this.requests.push(message);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(this.handle(message)));
      });
    });
    this.port = await listen(this.server, this.port);
    this.udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.udp.on('message', (buffer, remote) => {
      const question = JSON.parse(buffer.toString('utf8'));
      if (question.devName !== '*' || question.id !== '48cbd88f969eb3c486085cfe7b5eb1e4') {
        return;
      }
      this.searches = (this.searches ?? 0) + 1;
      // To the fixed answer port of the sender, never to the port it left from.
      this.udp.send(JSON.stringify(this.announce()), this.answerPort, remote.address);
    });
    await new Promise((resolve) => this.udp.bind(searchPort, this.host, resolve));
    return this;
  }

  async stop() {
    await new Promise((resolve) => this.server?.close(() => resolve()) ?? resolve());
    this.server = null;
    await new Promise((resolve) => (this.udp ? this.udp.close(resolve) : resolve()));
    this.udp = null;
  }
}

// --- The network ------------------------------------------------------------------------------

export class FakeNetwork {
  constructor(devices, { searchPort, answerPort } = {}) {
    this.devices = devices;
    this.searchPort = searchPort ?? 30000 + Math.floor(Math.random() * 15000);
    this.answerPort = answerPort ?? this.searchPort + 1;
    this.endpoints = this.endpoints.bind(this);
  }

  async start() {
    for (const device of this.devices) {
      if (device instanceof FakeLegacyDevice) {
        await device.start({ searchPort: this.searchPort, answerPort: this.answerPort });
      } else {
        await device.start();
      }
    }
    return this;
  }

  /** `(host, port)` -> local URLs of the fake at that address. */
  endpoints(host) {
    const device = this.devices.find((item) => item.host === host);
    // An address without a device: a closed local port.
    const port = device?.port || 9;
    return { http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/rpc` };
  }

  /** What the core relays from an mDNS browse of `_http._tcp`, with a stranger. */
  mdns() {
    const results = this.devices
      .filter((device) => device instanceof FakeRpcDevice && device.server)
      .map((device) => ({
        name: `${device.devId}._http._tcp.local`,
        host: `${device.devId}.local`,
        addresses: [device.host],
        port: 80,
        txt: [],
      }));
    results.push({
      name: 'Imprimante salon._http._tcp.local',
      host: 'printer.local',
      addresses: ['192.168.1.99'],
      port: 80,
      txt: [],
    });
    return results;
  }

  legacyProbe() {
    return { searchPort: this.searchPort, answerPort: this.answerPort, timeoutMs: 400 };
  }

  async stop() {
    await Promise.all(this.devices.map((device) => device.stop()));
  }
}

export const randomUuid = () => randomBytes(16).toString('hex');
