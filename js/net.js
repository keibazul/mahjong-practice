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
    this.seen = new Map(); // 같은 메시지가 두 서버로 두 번 오면 한 번만 처리
    this.onStatus = () => {};
  }

  deliver(topic, text) {
    let msg = null;
    if (text) {
      try { msg = JSON.parse(text); } catch { return; }
      if (msg && msg._m) {
        const now = Date.now();
        if (this.seen.has(msg._m)) return;
        this.seen.set(msg._m, now);
        if (this.seen.size > 600) for (const [k, t] of this.seen) if (now - t > 15000) this.seen.delete(k);
      }
    }
    for (const s of this.subs.slice()) if (matchTopic(s.filter, topic)) s.handler(msg, topic);
  }

  encode(msg) {
    if (msg === null) return '';
    return JSON.stringify({ ...msg, _m: rid(10) });
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

const brokerName = (url) => url.replace(/^wss:\/\//, '').split(/[.:]/).slice(0, 2).filter((x) => x !== 'broker').join('.') || url;

// 실제 서비스: 공개 MQTT 서버 여러 곳에 동시에 붙는다.
// 한쪽이 막히거나 메시지를 흘려도 다른 쪽으로 오가고, 같은 메시지는 한 번만 처리한다.
export class MqttTransport extends BaseTransport {
  async connect() {
    const mqtt = await loadMqtt();
    const results = await Promise.allSettled(BROKERS.map((url) => this.tryConnect(mqtt, url)));
    this.clients = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    this.failed = BROKERS.filter((_, i) => results[i].status !== 'fulfilled').map(brokerName);
    if (!this.clients.length) {
      const why = results.map((r) => (r.reason && r.reason.message) || '').filter(Boolean).join(', ');
      throw new Error(`중계 서버에 연결하지 못했다 (${why || '알 수 없음'}). 와이파이·데이터를 바꿔 다시 해 봐라.`);
    }
    this.broker = this.clients.map((c) => c.name).join(' · ');
    return this.broker;
  }

  tryConnect(mqtt, url) {
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(url, {
        clientId: `jd_${rid(12)}`,
        clean: true,
        keepalive: 20,
        reconnectPeriod: 1500,
        connectTimeout: 8000,
        protocolVersion: 4,
      });
      client.name = brokerName(url);
      const timer = setTimeout(() => { client.end(true); reject(new Error(`${client.name} 시간 초과`)); }, 9000);
      client.once('connect', () => {
        clearTimeout(timer);
        client.on('message', (topic, payload) => {
          const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
          this.deliver(topic, text);
        });
        client.on('offline', () => this.onStatus('offline', client.name));
        client.on('connect', () => this.onStatus('online', client.name));
        resolve(client);
      });
      client.once('error', (e) => { clearTimeout(timer); client.end(true); reject(new Error(`${client.name} ${e.message || e}`)); });
    });
  }

  connectedCount() { return (this.clients || []).filter((c) => c.connected).length; }

  rawSubscribe(filter) { for (const c of this.clients || []) c.subscribe(filter, { qos: 1 }); }
  rawUnsubscribe(filter) { for (const c of this.clients || []) c.unsubscribe(filter); }

  publish(topic, msg, { retain = false, qos = 0 } = {}) {
    const text = this.encode(msg);
    for (const c of this.clients || []) c.publish(topic, text, { qos, retain });
  }

  end() {
    for (const c of this.clients || []) c.end(true);
    this.clients = [];
  }
}

// 시험용: 같은 브라우저의 여러 탭끼리 (주소에 ?net=local)
// &drop=0.2 는 메시지 20%를 버리고, &lag=300 은 구독이 300ms 늦게 걸리게 해서 실제 서버의 나쁜 상황을 흉내 낸다
export class LocalTransport extends BaseTransport {
  async connect() {
    const q = new URLSearchParams(location.search);
    this.dropRate = Number(q.get('drop') || 0);
    this.lag = Number(q.get('lag') || 0);
    this.ch = new BroadcastChannel('jaksa-local-mqtt');
    this.active = new Set();
    this.ch.onmessage = (e) => this.receive(e.data.topic, e.data.text);
    this.broker = this.dropRate || this.lag ? `local (drop ${this.dropRate}, lag ${this.lag})` : 'local';
    return this.broker;
  }

  connectedCount() { return 1; }

  receive(topic, text) {
    if (![...this.active].some((f) => matchTopic(f, topic))) return;
    if (text && this.dropRate && Math.random() < this.dropRate) return;
    this.deliver(topic, text);
  }

  rawSubscribe(filter) {
    setTimeout(() => {
      this.active.add(filter);
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('jl-retain:') && matchTopic(filter, k.slice(10))) this.deliver(k.slice(10), localStorage.getItem(k));
      }
    }, this.lag);
  }

  rawUnsubscribe(filter) { this.active.delete(filter); }

  publish(topic, msg, { retain = false } = {}) {
    if (!this.ch) return;
    const text = this.encode(msg);
    if (retain) {
      if (text) localStorage.setItem(`jl-retain:${topic}`, text);
      else localStorage.removeItem(`jl-retain:${topic}`);
    }
    this.ch.postMessage({ topic, text });
    setTimeout(() => this.receive(topic, text), 0);
  }

  end() {
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
          if (this.state === 'ended' && this.lastEnd) this.send(m.id, this.lastEnd);
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
        if (i >= 0 && this.state === 'ended' && this.lastEnd && !this.endAck.has(i)) this.send(m.id, this.lastEnd);
        break;
      case 'gotEnd':
        if (i >= 0 && this.endAck) this.endAck.add(i);
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

  // 대국 종료: 못 받은 사람에게는 신호가 올 때마다 다시 보낸다
  finish(msg) {
    this.state = 'ended';
    this.lastEnd = msg;
    this.endAck = new Set();
    for (const i of this.remoteSeats()) if (this.seats[i].connected) this.send(this.seats[i].id, msg);
    this.heartbeat();
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

  join(timeoutMs = 20000, onProgress = () => {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let sawRoom = false;
      const started = Date.now();
      const finish = (fn, v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(retry);
        fn(v);
      };
      const handle = (m) => {
        if (!m) return;
        this.lastHost = Date.now();
        if (m.t === 'welcome') {
          if (this.seat < 0 || this.seat === m.seat) this.seat = m.seat;
          if (!settled) {
            this.pinger = setInterval(() => {
              this.tr.publish(topics.host(this.code), { t: 'ping', id: this.id });
              if (Date.now() - this.lastHost > LOST_MS) this.on.hostLost();
            }, 4000);
          }
          finish(resolve, m);
        } else if (m.t === 'reject') {
          finish(reject, new Error(m.reason === 'full' ? '방이 꽉 찼다.' : '이미 대국이 시작된 방이다.'));
        } else if (settled) this.on.message(m);
      };
      this.unsubs = [
        this.tr.subscribe(topics.to(this.code, this.id), handle),
        this.tr.subscribe(topics.all(this.code), (m) => {
          if (!m) return;
          this.lastHost = Date.now();
          if (m.t === 'room') sawRoom = true;
          if (settled) this.on.message(m);
        }),
      ];
      const send = () => {
        this.tr.publish(topics.host(this.code), { t: 'join', id: this.id, name: this.name }, { qos: 1 });
        onProgress(Math.round((Date.now() - started) / 1000), sawRoom);
      };
      setTimeout(send, 300); // 구독이 걸릴 틈을 준다
      const retry = setInterval(send, 2000);
      const timer = setTimeout(() => finish(reject, new Error(sawRoom
        ? '방은 찾았는데 방장이 응답하지 않는다. 방장 폰 화면이 켜져 있고 이 방 화면에 있는지 확인해라.'
        : '방을 찾지 못했다. 코드가 맞는지, 방장이 방 화면을 켜 두고 있는지 확인해라. 방장이 다른 앱에 가 있으면 연결이 끊긴다.')), timeoutMs);
    });
  }

  // 대국이 이미 진행 중인데 시작 신호를 놓쳤을 때 다시 붙는다
  rejoin() {
    const now = Date.now();
    if (this.lastRejoin && now - this.lastRejoin < 3000) return;
    this.lastRejoin = now;
    this.tr.publish(topics.host(this.code), { t: 'join', id: this.id, name: this.name }, { qos: 1 });
  }

  gotEnd() { this.tr.publish(topics.host(this.code), { t: 'gotEnd', id: this.id }, { qos: 1 }); }

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
