// AI: 버림패 후보마다 특징을 뽑고, 가중치(θ)로 점수를 매겨 고른다.
// 같은 특징을 사람의 타패 학습(ml.js)에도 쓴다.
import { shanten } from './engine.js';
import { doraOf } from './yaku.js';
import { countsOf, kindOf } from './game.js';

export const FEATURES = [
  { key: 'shanten', ko: '샹텐 유지' },
  { key: 'accept', ko: '유효패 수' },
  { key: 'danger', ko: '위험 회피(텐파이 근처)' },
  { key: 'fold', ko: '위험 회피(멀 때 접기)' },
  { key: 'yakuhai', ko: '역패 쌍 지키기' },
  { key: 'dora', ko: '도라 지키기' },
  { key: 'isolated', ko: '고립 요구패 먼저' },
  { key: 'guestWind', ko: '손님풍 먼저' },
  { key: 'tsumogiri', ko: '쯔모기리 습관' },
];

// 강한 기준 정책의 가중치
export const STRONG = [4.0, 2.2, 1.0, 5.0, 0.8, 0.5, 0.35, 0.15, 0.02];

// 화면에 보이는 패 수 (자기 손 + 모든 버림패 + 울음 + 도라 표시패)
export function visibleCounts(view) {
  const v = countsOf(view.hand);
  for (const d of view.discards) for (const x of d) if (!x.called) v[kindOf(x.tile)] += 1;
  for (const ms of view.melds) for (const m of ms) for (const id of m.tiles) v[kindOf(id)] += 1;
  for (const t of view.dora) v[t] += 1;
  return v.map((n) => Math.min(4, n));
}

function nearTiles(c) {
  const out = new Set();
  for (let t = 0; t < 34; t++) {
    if (!c[t]) continue;
    out.add(t);
    if (t < 27) {
      const n = t % 9;
      for (let d = -2; d <= 2; d++) if (n + d >= 0 && n + d <= 8) out.add(t + d);
    }
  }
  return [...out];
}

function shantenOf(c, closedHand) {
  return shanten(c, { chiitoi: closedHand });
}

// 13장(또는 3n+1장) 손패의 유효패: 남은 장수를 셈
export function acceptanceVisible(c, vis, closedHand) {
  const s = shantenOf(c, closedHand);
  const tiles = [];
  let count = 0;
  const cand = nearTiles(c);
  for (const u of cand) {
    if (c[u] >= 4) continue;
    const left = 4 - vis[u];
    c[u]++;
    if (shantenOf(c, closedHand) < s) {
      tiles.push(u);
      count += Math.max(0, left);
    }
    c[u]--;
  }
  return { shanten: s, tiles, count };
}

// ---- 위험도 ----
export function threatLevel(view, opp) {
  if (view.riichi[opp]) return 1;
  const ms = view.melds[opp].filter((m) => m.type !== 'ankan');
  if (ms.length >= 3) return 0.5;
  const yakuhaiPon = ms.some((m) => {
    const k = kindOf(m.tiles[0]);
    return m.type !== 'chi' && (k >= 31 || k === view.seatWinds[opp] || k === view.roundWind);
  });
  if (ms.length >= 2 && yakuhaiPon) return 0.35;
  return 0;
}

export function safeSet(view, opp) {
  const safe = new Set(view.discards[opp].map((d) => kindOf(d.tile)));
  if (view.riichi[opp]) {
    const rt = view.discards[opp][view.riichiAt[opp]]?.turn ?? Infinity;
    for (let p = 0; p < 4; p++) {
      if (p === opp) continue;
      for (const d of view.discards[p]) if (d.turn > rt) safe.add(kindOf(d.tile));
    }
  }
  return safe;
}

// 한 상대에 대한 방총 확률 근사 (0 ~ 0.15)
export function tileDanger(t, safe, vis, view, opp) {
  if (safe.has(t)) return 0;
  if (t >= 27) {
    const base = [0.10, 0.06, 0.03, 0.005][Math.min(3, vis[t])];
    const yakuhai = t >= 31 || t === view.seatWinds[opp] || t === view.roundWind;
    return yakuhai && vis[t] <= 1 ? base * 1.3 : base;
  }
  const n = t % 9;
  const ok = (u) => vis[u] < 4;
  let routes = 0;
  if (n <= 5 && !safe.has(t + 3) && ok(t + 1) && ok(t + 2)) routes += 1;
  if (n >= 3 && !safe.has(t - 3) && ok(t - 1) && ok(t - 2)) routes += 1;
  let other = vis[t] >= 3 ? 0.012 : 0.03;
  if (n === 0 || n === 8) other -= 0.005;
  return other + 0.045 * routes;
}

export function dangerByKind(view) {
  const vis = visibleCounts(view);
  const out = new Array(34).fill(0);
  const per = [];
  for (let opp = 0; opp < 4; opp++) {
    if (opp === view.seat) continue;
    const th = threatLevel(view, opp);
    if (!th) continue;
    const safe = safeSet(view, opp);
    const row = new Array(34).fill(0);
    for (let t = 0; t < 34; t++) {
      row[t] = tileDanger(t, safe, vis, view, opp);
      out[t] = Math.max(out[t], th * row[t]);
    }
    per.push({ opp, threat: th, row, safe });
  }
  return { danger: out, per, vis };
}

// ---- 후보 분석 ----
function isYakuhai(t, view) {
  return t >= 31 || t === view.seatWinds[view.seat] || t === view.roundWind;
}

export function analyzeDiscards(view, opt = {}) {
  const c = countsOf(view.hand);
  const closedHand = view.melds[view.seat].every((m) => m.type === 'ankan');
  const { danger, per, vis } = dangerByKind(view);
  const threat = per.length > 0;
  const doraKinds = view.dora.map(doraOf);
  const forbidden = opt.forbidden || [];
  const drawnKind = view.drawn !== null && view.drawn !== undefined ? kindOf(view.drawn) : -1;

  const cands = [];
  for (let t = 0; t < 34; t++) {
    if (!c[t] || forbidden.includes(t)) continue;
    c[t]--;
    const a = acceptanceVisible(c, vis, closedHand);
    c[t]++;
    cands.push({ t, shanten: a.shanten, accept: a.count, tiles: a.tiles, danger: danger[t] });
  }
  const minSh = Math.min(...cands.map((x) => x.shanten));
  const maxAcc = Math.max(1, ...cands.filter((x) => x.shanten === minSh).map((x) => x.accept));
  const far = minSh >= 2 ? 1 : minSh === 1 ? 0.5 : 0;

  for (const x of cands) {
    const t = x.t;
    const n = t % 9;
    const isolated = c[t] === 1 && (t >= 27 || ![-2, -1, 1, 2].some((d) => n + d >= 0 && n + d <= 8 && c[t + d] > 0));
    const yaochu = t >= 27 || n === 0 || n === 8;
    const dn = Math.min(1.3, x.danger / 0.12);
    x.phi = [
      -(x.shanten - minSh),
      x.shanten === minSh ? x.accept / maxAcc : 0,
      threat ? -dn : 0,
      threat ? -dn * far : 0,
      isYakuhai(t, view) && c[t] >= 2 ? -1 : 0,
      -doraKinds.filter((d) => d === t).length,
      isolated && yaochu ? 1 : 0,
      t >= 27 && t <= 30 && !isYakuhai(t, view) && c[t] === 1 ? 1 : 0,
      t === drawnKind ? 1 : 0,
    ];
  }
  const riichiThreat = per.some((x) => x.threat >= 1);
  return { cands, minSh, maxAcc, threat, riichiThreat, per, vis, closedHand };
}

export const dot = (w, f) => w.reduce((s, x, i) => s + x * f[i], 0);

export function softmax(scores) {
  const m = Math.max(...scores);
  const e = scores.map((s) => Math.exp(s - m));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / z);
}

export function sample(probs, rnd) {
  let r = rnd();
  for (let i = 0; i < probs.length; i++) {
    r -= probs[i];
    if (r <= 0) return i;
  }
  return probs.length - 1;
}

// ---- 울음 판단 ----
function suitShare(c) {
  const s = [0, 0, 0];
  let honors = 0;
  c.forEach((n, t) => { if (t < 27) s[Math.floor(t / 9)] += n; else honors += n; });
  return { max: Math.max(...s), honors, total: s[0] + s[1] + s[2] + honors };
}

export function callPlan(view, opt) {
  const t = kindOf(opt.tile);
  const c = countsOf(view.hand);
  const myMelds = view.melds[view.seat];
  const meldKinds = [];
  for (const m of myMelds) for (const id of m.tiles) meldKinds.push(kindOf(id));
  const before = shanten(c, { chiitoi: false });
  const threatened = [0, 1, 2, 3].some((o) => o !== view.seat && view.riichi[o]);
  const hasYakuhaiMeld = myMelds.some((m) => m.type !== 'chi' && isYakuhai(kindOf(m.tiles[0]), view));

  const evalAfter = (removeKinds, meldTiles) => {
    const rest = c.slice();
    for (const k of removeKinds) rest[k]--;
    let best = 9;
    for (let d = 0; d < 34; d++) {
      if (!rest[d]) continue;
      rest[d]--;
      best = Math.min(best, shanten(rest, { chiitoi: false }));
      rest[d]++;
    }
    const allKinds = [...meldKinds, ...meldTiles];
    rest.forEach((n, k) => { for (let i = 0; i < n; i++) allKinds.push(k); });
    const simple = allKinds.every((k) => k < 27 && k % 9 !== 0 && k % 9 !== 8);
    const share = suitShare(countsOf([]).map((_, k) => allKinds.filter((x) => x === k).length));
    const flush = share.max + share.honors >= share.total - 1 && share.max >= 8;
    return { best, simple, flush };
  };

  if ((opt.pon || opt.minkan) && isYakuhai(t, view)) {
    const r = evalAfter([t, t], [t, t, t]);
    if (r.best <= before) return { type: 'pon' };
  }
  if (threatened && before >= 1) return { type: 'pass' };
  const yakuOk = (r) => hasYakuhaiMeld || r.simple || r.flush;
  if (opt.pon) {
    const r = evalAfter([t, t], [t, t, t]);
    if (r.best < before && yakuOk(r) && before >= 1) return { type: 'pon' };
  }
  for (const pair of opt.chi || []) {
    const r = evalAfter(pair, [t, ...pair]);
    if (r.best < before && yakuOk(r) && before >= 1) return { type: 'chi', use: pair };
  }
  return { type: 'pass' };
}

// ---- AI 선수 ----
export class AIPlayer {
  constructor({ name = 'AI', rng = Math.random, weights = () => STRONG.map((w) => w * 3), think = null } = {}) {
    this.name = name;
    this.rng = rng;
    this.weights = weights;
    this.think = think; // 화면 연출용 대기 (async)
  }

  async pause() { if (this.think) await this.think(); }

  async chooseTurn(view, opt) {
    await this.pause();
    if (opt.tsumo && opt.tsumo.valid) return { type: 'tsumo' };
    if (view.riichi[view.seat]) return { type: 'discard', tile: kindOf(view.drawn) };
    const threatened = [0, 1, 2, 3].some((o) => o !== view.seat && view.riichi[o]);
    for (const k of opt.ankan || []) if (k >= 27) return { type: 'ankan', kind: k };
    if (!threatened && (opt.kakan || []).length) return { type: 'kakan', kind: opt.kakan[0] };

    const { cands } = analyzeDiscards(view, opt);
    const w = this.weights(view);
    const probs = softmax(cands.map((x) => dot(w, x.phi)));
    const pick = cands[sample(probs, this.rng)];
    const riichi = (opt.riichi || []).includes(pick.t);
    return { type: 'discard', tile: pick.t, riichi };
  }

  async chooseCall(view, opt) {
    if (opt.ron) return opt.ron.valid ? { type: 'ron' } : { type: 'pass' };
    if (opt.stage === 'ron') return { type: 'pass' };
    const plan = callPlan(view, opt);
    if (plan.type !== 'pass') await this.pause();
    return plan;
  }
}
