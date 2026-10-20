// -----------------------------------------------------------------------------
// The current generation of Refoss devices (R11, R21, P11S, EM01P, EM06P,
// EM16P): JSON-RPC 2.0-like frames over a WebSocket at `ws://<ip>/rpc`.
//
//   request       { id, src, method, params?, auth? }
//   answer        { id, src, dst, result } or { id, error: { code, message } }
//   notification  { src, dst, method: 'NotifyStatus' | 'NotifyEvent', params }
//
// Once a client has sent one request, the device pushes to it every status
// change (only what changed, to merge) and every event (button pushes).
//
// Authentication is off by default. When the owner sets a password in the
// Refoss app, a call answers error 401 whose message is a JSON challenge
// `{ realm, nonce, nc }`; the next calls carry a SHA-256 digest of the user
// `admin`, the realm and the password. `Refoss.DeviceInfo.Get` usually
// answers without it (not on EM16P firmware 3.1.11 and later).
//
// Written from the official Python client (Refoss/aiorefoss, MIT).
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import WebSocket from 'ws';

export const USERNAME = 'admin';
const CALL_TIMEOUT_MS = 10 * 1000;
const PING_MS = 30 * 1000;
const UNAUTHORIZED = 401;

export class RpcError extends Error {
  /**
   * @param {string} message - Message.
   * @param {'network'|'auth'|'device'} kind - What went wrong.
   * @param {number} [code] - RPC error code.
   */
  constructor(message, kind = 'network', code = 0) {
    super(message);
    this.name = 'RpcError';
    this.kind = kind;
    this.code = code;
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/**
 * @description The `auth` object of a request, from a 401 challenge.
 * @param {object} challenge - `{ realm, nonce, nc }`.
 * @param {string} password - Password.
 * @param {string} [cnonce] - Client nonce (tests).
 * @returns {object} `{ realm, username, nonce, cnonce, response, algorithm }`.
 */
export function digestAuth(challenge, password, cnonce = randomBytes(8).toString('hex')) {
  const realm = String(challenge.realm ?? '');
  const nonce = challenge.nonce;
  const nc = challenge.nc ?? 1;
  const ha1 = sha256(`${USERNAME}:${realm}:${password}`);
  const ha2 = sha256('dummy_method:dummy_uri');
  return {
    realm,
    username: USERNAME,
    nonce,
    cnonce,
    response: sha256(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`),
    algorithm: 'SHA-256',
  };
}

const parseChallenge = (message) => {
  try {
    const challenge = JSON.parse(message);
    return challenge && challenge.nonce !== undefined ? challenge : null;
  } catch {
    return null;
  }
};

/**
 * @description Read the identity of a device over plain HTTP (no socket).
 * @param {string} base - `http://<ip>`.
 * @param {object} [options] - `{ fetch, timeoutMs }`.
 * @returns {Promise<object>} `Refoss.DeviceInfo.Get` result; rejects with
 * an RpcError (`auth` on a 401: the device exists, it wants the password).
 */
export async function fetchDeviceInfo(base, { fetch = globalThis.fetch, timeoutMs = 4000 } = {}) {
  let response;
  try {
    response = await fetch(`${base}/rpc/Refoss.DeviceInfo.Get`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new RpcError(error?.cause?.code ?? error?.message ?? String(error));
  }
  if (response.status === UNAUTHORIZED) {
    throw new RpcError('authentication required', 'auth', UNAUTHORIZED);
  }
  if (!response.ok) {
    throw new RpcError(`HTTP ${response.status}`, 'device', response.status);
  }
  let info;
  try {
    info = await response.json();
  } catch {
    throw new RpcError('not a Refoss RPC device', 'device');
  }
  if (!info || typeof info !== 'object' || !info.mac) {
    throw new RpcError('not a Refoss RPC device', 'device');
  }
  return info;
}

/**
 * @description Open the RPC socket of a device.
 * @param {object} options - Options.
 * @param {string} options.url - `ws://<ip>/rpc`.
 * @param {string} [options.password] - Password, '' when none.
 * @param {Function} options.onNotify - `(method, params)`.
 * @param {Function} options.onClose - Called once when the socket closes.
 * @param {number} [options.timeoutMs] - Call timeout.
 * @param {number} [options.pingMs] - Ping period (a pong must come back before the next).
 * @returns {Promise<object>} `{ call, close, isOpen }`; rejects when the
 * device does not answer.
 */
export function openRpc({
  url,
  password = '',
  onNotify,
  onClose,
  timeoutMs = CALL_TIMEOUT_MS,
  pingMs = PING_MS,
}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { handshakeTimeout: timeoutMs });
    const src = `gladys-${randomBytes(4).toString('hex')}`;
    const pending = new Map();
    let nextId = 0;
    let auth = null;
    let opened = false;
    let closed = false;
    let alive = true;
    let pinger = null;

    const finish = () => {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(pinger);
      for (const { reject: fail, timer } of pending.values()) {
        clearTimeout(timer);
        fail(new RpcError('connection closed'));
      }
      pending.clear();
      if (opened) {
        onClose?.();
      }
    };

    const send = (method, params) =>
      new Promise((resolveCall, rejectCall) => {
        if (closed || socket.readyState !== WebSocket.OPEN) {
          rejectCall(new RpcError('not connected'));
          return;
        }
        nextId += 1;
        const id = nextId;
        const frame = { id, src, method };
        if (params !== undefined && params !== null) {
          frame.params = params;
        }
        if (auth) {
          frame.auth = auth;
        }
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectCall(new RpcError(`${method}: no answer`));
        }, timeoutMs);
        timer.unref?.();
        pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
        socket.send(JSON.stringify(frame), (error) => {
          if (error) {
            clearTimeout(timer);
            pending.delete(id);
            rejectCall(new RpcError(error.message));
          }
        });
      });

    const call = async (method, params) => {
      let answer = await send(method, params);
      if (answer.error?.code === UNAUTHORIZED) {
        const challenge = parseChallenge(answer.error.message);
        if (!password || !challenge) {
          throw new RpcError('password required', 'auth', UNAUTHORIZED);
        }
        auth = digestAuth(challenge, password);
        answer = await send(method, params);
        if (answer.error?.code === UNAUTHORIZED) {
          auth = null;
          throw new RpcError('wrong password', 'auth', UNAUTHORIZED);
        }
      }
      if (answer.error) {
        throw new RpcError(
          String(answer.error.message ?? answer.error.code).slice(0, 200),
          'device',
          Number(answer.error.code) || 0,
        );
      }
      return answer.result ?? {};
    };

    socket.on('message', (data) => {
      let frame;
      try {
        frame = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }
      if (frame.method && frame.id === undefined) {
        onNotify?.(frame.method, frame.params ?? null);
        return;
      }
      const waiting = pending.get(frame.id);
      if (waiting) {
        pending.delete(frame.id);
        clearTimeout(waiting.timer);
        waiting.resolve(frame);
      }
    });
    socket.on('pong', () => {
      alive = true;
    });
    socket.on('open', () => {
      opened = true;
      pinger = setInterval(() => {
        if (!alive) {
          socket.terminate();
          return;
        }
        alive = false;
        socket.ping();
      }, pingMs);
      pinger.unref?.();
      resolve({
        call,
        close: () => {
          socket.close();
          finish();
        },
        isOpen: () => !closed && socket.readyState === WebSocket.OPEN,
      });
    });
    socket.on('error', (error) => {
      if (!opened) {
        closed = true;
        reject(new RpcError(error?.code ?? error?.message ?? String(error)));
      }
    });
    socket.on('close', finish);
  });
}
