// 온라인 연결: 공개 MQTT 중계 서버(웹소켓)로 방장과 참가자가 메시지를 주고받는다.
// 방장의 브라우저가 대국을 진행하고, 참가자에게는 그 사람 자리에서 보이는 화면만 보낸다.
import { kindOf, countsOf } from './game.js';

const BASE = 'jaksa-dojo/v1';
export const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const LIBS = ['https://unpkg.com/mqtt@5/dist/mqtt.min.js', 'https://cdn.jsdelivr.net/npm/mqtt@5/dist/mqtt.min.js'];
export const TURN_MS = 25000;
export const CALL_MS = 10000;
export const READY_MS = 20000;
const LOST_MS = 22000;

export const topics = {
  open: (code) => `${BASE}/open/${code}`,
  openAll: `${BASE}/open/+`,
  host: (code) => `${BASE}/room/${code}/host`,
  all: (code) => `${BASE}/room/${code}/all`,
  to: (code, id) => `${BASE}/room/${code}/to/${id}`,
};

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
const rid = (n = 10) => Array.from({ length: n }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)]).join('');

export function newRoomCode() {
  return Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
}

// 이 탭의 참가자 id (새로고침해도 같은 자리로 돌아오게 탭 단위로 유지)
export function myClientId() {
  try {
    let id = sessionStorage.getItem('jaksa-cid');
    if (!id) { id = rid(12); sessionStorage.setItem('jaksa-cid', id); }
    return id;
  } catch { return rid(12); }
}

export function matchTopic(filter, topic) {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`불러오기 실패: ${src}`));
    document.head.appendChild(s);
  });
}

async function loadMqtt() {
  if (window.mqtt) return window.mqtt;
  for (const src of LIBS) {
    try {
      await loadScript(src);
      if (window.mqtt) return window.mqtt;
    } catch { /* 다음 주소 */ }
  }
  throw new Error('연결 도구(mqtt.js)를 불러오지 못했다. 인터넷 연결을 확인해라.');
}

class BaseTransport {
  constructor() {
    this.subs = [];
    this.onStatus = () => {};
  }

  deliver(topic, text) {
    let msg = null;
    if (text) { try { msg = JSON.parse(text); } catch { return; } }
    for (const s of this.subs.slice()) if (matchTopic(s.filter, topic)) s.handler(msg, topic);
  }

  subscribe(filter, handler) {
    const sub = { filter, handler };
    this.subs.push(sub);
    if (this.subs.filter((s) => s.filter === filter).length === 1) this.rawSubscribe(filter);
    return () => {
      this.subs = this.subs.filter((s) => s !== sub);
      if (!this.subs.some((s) => s.filter === filter)) this.rawUnsubscribe(filter);
    };
  }
}

// 실제 서비스: 공개 MQTT 서버
export class MqttTransport extends BaseTransport {
  async connect({ will } = {}) {
    const mqtt = await loadMqtt();
    let lastErr = null;
    for (const url of BROKERS) {
      try {
        await this.tryConnect(mqtt, url, will);
        this.broker = url;
        return url;
      } catch (e) { lastErr = e; }
    }
    throw new Error(`중계 서버에 연결하지 못했다 (${lastErr ? lastErr.message : '알 수 없음'})`);
  }

  tryConnect(mqtt, url, will) {
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(url, {
        clientId: `jd_${rid(12)}`,
        clean: true,
        keepalive: 30,
        reconnectPeriod: 2000,
        connectTimeout: 8000,
        protocolVersion: 4,
        will: will ? { topic: will.topic, payload: will.payload, qos: 0, retain: Boolean(will.retain) } : undefined,
      });
      const timer = setTimeout(() => { client.end(true); reject(new Error('시간 초과')); }, 9000);
      client.once('connect', () => {
        clearTimeout(timer);
        this.client = client;
        client.on('message', (topic, payload) => {
          const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
          this.deliver(topic, text);
        });
        client.on('offline', () => this.onStatus('offline'));
        client.on('reconnect', () => this.onStatus('reconnect'));
        client.on('connect', () => this.onStatus('online'));
        resolve();
      });
      client.once('error', (e) => { clearTimeout(timer); client.end(true); reject(e); });
    });
  }

  rawSubscribe(filter) { this.client.subscribe(filter, { qos: 1 }); }
  rawUnsubscribe(filter) { this.client.unsubscribe(filter); }

  publish(topic, msg, { retain = false, qos = 0 } = {}) {
    if (!this.client) return;
    this.client.publish(topic, msg === null ? '' : JSON.stringify(msg), { qos, retain });
  }

  end() { if (this.client) this.client.end(true); this.client = null; }
}

// 시험용: 같은 브라우저의 여러 탭끼리 (주소에 ?net=local)
export class LocalTransport extends BaseTransport {
  async connect({ will } = {}) {
    this.ch = new BroadcastChannel('jaksa-local-mqtt');
    this.ch.onmessage = (e) => this.deliver(e.data.topic, e.data.text);
    this.will = will;
    this.onHide = () => { if (this.will) this.publishText(this.will.topic, this.will.payload, this.will.retain); };
    window.addEventListener('pagehide', this.onHide);
    this.broker = 'local';
    return 'local';
  }

  rawSubscribe(filter) {
    const hits = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('jl-retain:') && matchTopic(filter, k.slice(10))) hits.push([k.slice(10), localStorage.getItem(k)]);
    }
    setTimeout(() => { for (const [t, text] of hits) this.deliver(t, text); }, 0);
  }

  rawUnsubscribe() {}

  publishText(topic, text, retain) {
    if (retain) {
      if (text) localStorage.setItem(`jl-retain:${topic}`, text);
      else localStorage.removeItem(`jl-retain:${topic}`);
    }
    this.ch.postMessage({ topic, text });
    setTimeout(() => this.deliver(topic, text), 0);
  }

  publish(topic, msg, { retain = false } = {}) {
    if (!this.ch) return;
    this.publishText(topic, msg === null ? '' : JSON.stringify(msg), retain);
  }

  end() {
    window.removeEventListener('pagehide', this.onHide);
    if (this.ch) this.ch.close();
    this.ch = null;
  }
}

export function makeTransport() {
  const local = new URLSearchParams(location.search).get('net') === 'local';
  return local ? new LocalTransport() : new MqttTransport();
}

// ---------- 응답 검사 ----------
export function validTurn(view, opt, act) {
  if (!act || typeof act !== 'object') return false;
  if (act.type === 'tsumo') return Boolean(opt.tsumo);
  if (act.type === 'ankan') return (opt.ankan || []).includes(act.kind);
  if (act.type === 'kakan') return (opt.kakan || []).includes(act.kind);
  if (act.type !== 'discard') return false;
  const k = act.tile;
  if (opt.mustTsumogiri) return view.drawn !== null && kindOf(view.drawn) === k && !act.riichi;
  if (!Number.isInteger(k) || k < 0 || k > 33) return false;
  if (!countsOf(view.hand)[k] || (opt.forbidden || []).includes(k)) return false;
  if (act.riichi && !(opt.riichi || []).includes(k)) return false;
  return true;
}

export function validCall(opt, act) {
  if (!act || typeof act !== 'object') return false;
  if (act.type === 'pass') return true;
  if (act.type === 'ron') return Boolean(opt.ron);
  if (act.type === 'pon') return Boolean(opt.pon);
  if (act.type === 'minkan') return Boolean(opt.minkan);
  if (act.type === 'chi') return Array.isArray(act.use) && (opt.chi || []).some((p) => p[0] === act.use[0] && p[1] === act.use[1]);
  return false;
}

// 시간이 다 됐을 때의 자동 행동: 뽑은 패를 그대로 버리고, 울음은 넘긴다
export function autoTurn(view, opt) {
  if (view.drawn !== null && view.drawn !== undefined) return { type: 'discard', tile: kindOf(view.drawn) };
  const c = countsOf(view.hand);
  for (let k = 33; k >= 0; k--) if (c[k] && !(opt.forbidden || []).includes(k)) return { type: 'discard', tile: k };
  return { type: 'discard', tile: kindOf(view.hand[0]) };
}

// ---------- 방장 ----------
export class HostRoom {
  constructor(transport, { code, isPublic, myId, myName, onChange }) {
    this.tr = transport;
    this.code = code;
    this.isPublic = isPublic;
    this.state = 'waiting';
    this.onChange = onChange || (() => {});
    this.seats = [{ kind: 'human', id: myId, name: myName, connected: true, lastSeen: Date.now(), host: true }, null, null, null];
    this.pending = new Map(); // seat → { req, kind, view, opt, timeout, resolve, timer }
    this.ready = null;
    this.startAt = isPublic ? Date.now() + 40000 : null;
  }

  async open() {
    this.unsub = this.tr.subscribe(topics.host(this.code), (m) => { if (m) this.onMsg(m); });
    this.beat = setInterval(() => this.heartbeat(), 4000);
    this.heartbeat();
  }

  humans() { return this.seats.filter((s) => s && s.kind === 'human').length; }

  roomInfo() {
    return {
      t: 'room', code: this.code, state: this.state, public: this.isPublic, startAt: this.startAt,
      seats: this.seats.map((s) => (s ? { name: s.name, kind: s.kind, connected: s.connected, host: Boolean(s.host) } : null)),
    };
  }

  heartbeat() {
    this.tr.publish(topics.all(this.code), this.roomInfo());
    if (this.isPublic && this.state === 'waiting') {
      this.tr.publish(topics.open(this.code), { v: 1, code: this.code, state: 'waiting', humans: this.humans(), ts: Date.now() }, { retain: true });
    }
    const now = Date.now();
    this.seats.forEach((s, i) => {
      if (!s || s.host || s.kind !== 'human' || !s.connected) return;
      if (now - s.lastSeen > LOST_MS) this.lose(i);
    });
  }

  send(id, msg, qos = 1) { this.tr.publish(topics.to(this.code, id), msg, { qos }); }

  seatOf(id) { return this.seats.findIndex((s) => s && s.id === id); }

  onMsg(m) {
    const i = this.seatOf(m.id);
    if (i >= 0) this.seats[i].lastSeen = Date.now();
    switch (m.t) {
      case 'join': {
        const name = String(m.name || '작사').slice(0, 12);
        if (i >= 0) {
          const s = this.seats[i];
          s.connected = true;
          s.name = name;
          this.send(m.id, { t: 'welcome', seat: i, code: this.code, state: this.state });
          if (this.state === 'playing') this.onChange('rejoin', i);
          this.resendAsk(i);
        } else if (this.state !== 'waiting') {
          this.send(m.id, { t: 'reject', reason: 'started' });
        } else {
          const free = this.seats.findIndex((s, k) => k > 0 && !s);
          if (free < 0) { this.send(m.id, { t: 'reject', reason: 'full' }); return; }
          this.seats[free] = { kind: 'human', id: m.id, name, connected: true, lastSeen: Date.now() };
          this.send(m.id, { t: 'welcome', seat: free, code: this.code, state: this.state });
          if (this.isPublic) this.startAt = Math.max(this.startAt, Date.now() + 10000);
        }
        this.heartbeat();
        this.onChange('seats');
        break;
      }
      case 'leave':
        if (i < 0) return;
        if (this.state === 'waiting') this.seats[i] = null;
        else this.lose(i);
        this.heartbeat();
        this.onChange('seats');
        break;
      case 'ping':
        if (i >= 0 && !this.seats[i].connected && this.state === 'playing') {
          this.seats[i].connected = true;
          this.onChange('rejoin', i);
        }
        if (i >= 0) this.resendAsk(i);
        break;
      case 'answer': {
        const p = this.pending.get(i);
        if (p && p.req === m.req) p.resolve(m.act);
        break;
      }
      case 'ready':
        if (this.ready && i >= 0 && m.rid === this.ready.rid) {
          this.ready.got.add(i);
          this.checkReady();
        }
        break;
      default: break;
    }
  }

  lose(i) {
    const s = this.seats[i];
    if (!s || !s.connected) return;
    s.connected = false;
    const p = this.pending.get(i);
    if (p) p.resolve(null);
    this.onChange('lost', i);
    this.checkReady();
  }

  remoteSeats() { return this.seats.map((s, i) => (s && s.kind === 'human' && !s.host ? i : -1)).filter((i) => i >= 0); }

  // 대국 시작: 빈자리는 AI
  begin(aiSeats) {
    this.state = 'playing';
    for (const i of aiSeats) this.seats[i] = { kind: 'ai', name: `AI ${i}`, connected: true };
    if (this.isPublic) this.tr.publish(topics.open(this.code), null, { retain: true });
    this.heartbeat();
  }

  names() { return this.seats.map((s, i) => (s ? s.name : `AI ${i}`)); }

  ask(seat, kind, view, opt, timeout) {
    const s = this.seats[seat];
    return new Promise((resolve) => {
      const req = rid(8);
      const done = (act) => {
        const p = this.pending.get(seat);
        if (!p || p.req !== req) return;
        clearTimeout(p.timer);
        this.pending.delete(seat);
        resolve(act);
      };
      const timer = setTimeout(() => done(null), timeout + 1500);
      this.pending.set(seat, { req, kind, view, opt, timeout, sentAt: Date.now(), resolve: done, timer });
      this.send(s.id, { t: 'ask', req, kind, view, opt, timeout });
    });
  }

  resendAsk(seat) {
    const p = this.pending.get(seat);
    const s = this.seats[seat];
    if (!p || !s) return;
    const left = Math.max(1000, p.timeout - (Date.now() - p.sentAt));
    this.send(s.id, { t: 'ask', req: p.req, kind: p.kind, view: p.view, opt: p.opt, timeout: left });
  }

  forward(seat, msg) {
    const s = this.seats[seat];
    if (s && s.connected) this.send(s.id, msg, 0);
  }

  // 결과 화면: 연결된 사람이 모두 '다음'을 누르거나 시간이 지나면 진행
  waitReady(msg) {
    const r = rid(6);
    const targets = this.remoteSeats().filter((i) => this.seats[i].connected);
    for (const i of targets) this.send(this.seats[i].id, { ...msg, rid: r });
    if (!targets.length) return Promise.resolve();
    return new Promise((resolve) => {
      this.ready = { rid: r, got: new Set(), resolve, timer: setTimeout(() => { this.ready = null; resolve(); }, READY_MS) };
    });
  }

  checkReady() {
    if (!this.ready) return;
    const need = this.remoteSeats().filter((i) => this.seats[i].connected);
    if (need.every((i) => this.ready.got.has(i))) {
      clearTimeout(this.ready.timer);
      const { resolve } = this.ready;
      this.ready = null;
      resolve();
    }
  }

  broadcast(msg) {
    for (const i of this.remoteSeats()) this.forward(i, msg);
  }

  close() {
    clearInterval(this.beat);
    this.tr.publish(topics.all(this.code), { t: 'closed' });
    if (this.isPublic) this.tr.publish(topics.open(this.code), null, { retain: true });
    for (const p of this.pending.values()) p.resolve(null);
    if (this.unsub) this.unsub();
  }
}

// 다른 사람 자리: 방장이 묻고, 답이 없거나 끊기면 AI·자동 행동으로 대신한다
export class RemoteHuman {
  constructor(room, seat, fallback) {
    this.room = room;
    this.seat = seat;
    this.fallback = fallback;
  }

  connected() { const s = this.room.seats[this.seat]; return s && s.connected; }

  async chooseTurn(view, opt) {
    if (!this.connected()) return this.fallback.chooseTurn(view, opt);
    const act = await this.room.ask(this.seat, 'turn', view, opt, TURN_MS);
    if (validTurn(view, opt, act)) return act;
    if (!this.connected()) return this.fallback.chooseTurn(view, opt);
    return autoTurn(view, opt);
  }

  async chooseCall(view, opt) {
    if (!this.connected()) return this.fallback.chooseCall(view, opt);
    const act = await this.room.ask(this.seat, 'call', view, opt, CALL_MS);
    if (validCall(opt, act)) return act;
    return { type: 'pass' };
  }
}

// ---------- 참가자 ----------
export class ClientRoom {
  constructor(transport, { code, myId, myName, on }) {
    this.tr = transport;
    this.code = code;
    this.id = myId;
    this.name = myName;
    this.on = on;
    this.lastHost = Date.now();
    this.seat = -1;
  }

  join(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const handle = (m) => {
        if (!m) return;
        this.lastHost = Date.now();
        if (m.t === 'welcome') {
          this.seat = m.seat;
          clearTimeout(timer);
          resolve(m);
        } else if (m.t === 'reject') {
          clearTimeout(timer);
          reject(new Error(m.reason === 'full' ? '방이 꽉 찼다' : '이미 대국이 시작된 방이다'));
        } else this.on.message(m);
      };
      this.unsubs = [
        this.tr.subscribe(topics.to(this.code, this.id), handle),
        this.tr.subscribe(topics.all(this.code), (m) => {
          if (!m) return;
          this.lastHost = Date.now();
          this.on.message(m);
        }),
      ];
      const timer = setTimeout(() => reject(new Error('방을 찾지 못했다. 코드를 확인해라')), timeoutMs);
      this.tr.publish(topics.host(this.code), { t: 'join', id: this.id, name: this.name }, { qos: 1 });
      this.pinger = setInterval(() => {
        this.tr.publish(topics.host(this.code), { t: 'ping', id: this.id });
        if (Date.now() - this.lastHost > LOST_MS) this.on.hostLost();
      }, 4000);
    });
  }

  answer(req, act) { this.tr.publish(topics.host(this.code), { t: 'answer', id: this.id, req, act }, { qos: 1 }); }
  readyFor(r) { this.tr.publish(topics.host(this.code), { t: 'ready', id: this.id, rid: r }, { qos: 1 }); }

  leave() {
    this.tr.publish(topics.host(this.code), { t: 'leave', id: this.id }, { qos: 1 });
    this.stop();
  }

  stop() {
    clearInterval(this.pinger);
    for (const u of this.unsubs || []) u();
  }
}

// 빠른 대국: 열린 공개방 목록
export async function findOpenRooms(transport, waitMs = 2500) {
  const rooms = new Map();
  const unsub = transport.subscribe(topics.openAll, (m, topic) => {
    const code = topic.split('/').pop();
    if (!m) rooms.delete(code);
    else rooms.set(code, m);
  });
  await wait(waitMs);
  unsub();
  const now = Date.now();
  return [...rooms.values()]
    .filter((r) => r.v === 1 && r.state === 'waiting' && r.humans < 4 && Math.abs(now - r.ts) < 45000)
    .sort((a, b) => b.humans - a.humans || b.ts - a.ts);
}
