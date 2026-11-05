// Thin wrapper around PeerJS (WebRTC data channels). The host's browser runs the game;
// guests connect directly to it. PeerJS is only loaded when someone opens an online match.
import { NET_CONFIG } from './config.js';

const PEERJS_URL = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
let loading = null;

function loadPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PEERJS_URL;
      s.async = true;
      s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('The networking library failed to start.')));
      s.onerror = () => {
        loading = null;
        s.remove();
        reject(new Error('Could not load the networking library. Check your internet connection.'));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

function peerOptions() {
  return { debug: 1, config: { iceServers: NET_CONFIG.iceServers }, ...(NET_CONFIG.peerServer ?? {}) };
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const normCode = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

const ERRORS = {
  'browser-incompatible': 'This browser does not support WebRTC, which online play needs.',
  network: 'Could not reach the matchmaking server.',
  'server-error': 'The matchmaking server had a problem. Try again in a moment.',
  'socket-error': 'Lost the connection to the matchmaking server.',
  'socket-closed': 'Lost the connection to the matchmaking server.',
  'peer-unavailable': 'No room with that code. Check the code and that the host is still in the lobby.',
  'unavailable-id': 'That room code is already taken.',
  'ssl-unavailable': 'The matchmaking server needs a secure (https) connection.',
  webrtc: 'The direct connection between browsers failed.',
};
export const errText = (e) => ERRORS[e?.type] ?? e?.message ?? String(e);

export class HostNet {
  constructor() {
    this.conns = new Map();
    this.onMsg = () => {};
    this.onLeave = () => {};
    this.onError = () => {};
    this.closed = false;
  }

  async open() {
    const Peer = await loadPeer();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      try {
        await this.openWith(Peer, code);
        this.code = code;
        return code;
      } catch (e) {
        if (e?.type !== 'unavailable-id') throw e;
      }
    }
    throw new Error('Could not get a free room code. Try again.');
  }

  openWith(Peer, code) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(NET_CONFIG.roomPrefix + code, peerOptions());
      let opened = false;
      const timer = setTimeout(() => {
        if (!opened) {
          peer.destroy();
          reject(new Error('Timed out reaching the matchmaking server.'));
        }
      }, 15000);
      peer.on('open', () => {
        opened = true;
        clearTimeout(timer);
        this.peer = peer;
        resolve();
      });
      peer.on('error', (e) => {
        if (!opened) {
          clearTimeout(timer);
          peer.destroy();
          reject(e);
        } else if (e.type !== 'peer-unavailable') this.onError(e);
      });
      // Keep the room code registered if the signalling socket drops; open games are unaffected.
      peer.on('disconnected', () => {
        if (!this.closed) setTimeout(() => !this.closed && !peer.destroyed && peer.reconnect(), 1500);
      });
      peer.on('connection', (conn) => this.accept(conn));
    });
  }

  accept(conn) {
    conn.on('open', () => this.conns.set(conn.peer, conn));
    conn.on('data', (d) => {
      if (this.conns.get(conn.peer) !== conn) this.conns.set(conn.peer, conn);
      if (d && typeof d === 'object') this.onMsg(conn.peer, d);
    });
    const gone = () => {
      if (this.conns.get(conn.peer) === conn) {
        this.conns.delete(conn.peer);
        this.onLeave(conn.peer);
      }
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  send(peer, msg) {
    const c = this.conns.get(peer);
    if (c?.open) c.send(msg);
  }

  broadcast(msg) {
    for (const c of this.conns.values()) if (c.open) c.send(msg);
  }

  kick(peer) {
    const c = this.conns.get(peer);
    this.conns.delete(peer);
    c?.close();
  }

  close() {
    this.closed = true;
    this.conns.clear();
    this.peer?.destroy();
  }
}

export class GuestNet {
  constructor() {
    this.onMsg = () => {};
    this.onClose = () => {};
    this.closed = false;
  }

  async join(code) {
    const Peer = await loadPeer();
    return new Promise((resolve, reject) => {
      const peer = new Peer(peerOptions());
      this.peer = peer;
      let connected = false;
      const fail = (e) => {
        if (connected) return;
        connected = true; // only fail once
        clearTimeout(timer);
        peer.destroy();
        reject(e);
      };
      const timer = setTimeout(
        () => fail(new Error('Timed out connecting to the room. One of you may be on a network that blocks direct connections (see TURN in the README).')),
        20000,
      );
      peer.on('error', (e) => {
        if (!connected) fail(e);
      });
      peer.on('open', () => {
        const conn = peer.connect(NET_CONFIG.roomPrefix + code, { reliable: true, serialization: 'json' });
        this.conn = conn;
        conn.on('open', () => {
          connected = true;
          clearTimeout(timer);
          resolve();
        });
        conn.on('data', (d) => {
          if (d && typeof d === 'object') this.onMsg(d);
        });
        conn.on('close', () => {
          if (!this.closed) this.onClose('Lost the connection to the host.');
        });
        conn.on('error', () => {
          if (!this.closed && connected) this.onClose('Lost the connection to the host.');
        });
      });
    });
  }

  send(msg) {
    if (this.conn?.open) this.conn.send(msg);
  }

  close() {
    this.closed = true;
    this.peer?.destroy();
  }
}
