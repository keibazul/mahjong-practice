// AI: 버림패 후보마다 특징을 뽑고, 가중치(θ)로 점수를 매겨 고른다.
// 같은 특징을 사람의 타패 학습(ml.js)에도 쓴다.
import { shanten, waits as waitsOf } from './engine.js';
import { doraOf, evaluateWin } from './yaku.js';
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
  { key: 'value', ko: '손 점수 키우기' },
];

// 강한 기준 정책의 가중치
export const STRONG = [4.0, 2.2, 1.0, 5.0, 0.8, 0.5, 0.35, 0.15, 0.02, 0.6];

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

const isSimple = (t) => t < 27 && t % 9 !== 0 && t % 9 !== 8;

// 손의 점수 가능성 (대략의 판수)
export function valueEstimate(c, view, closedHand, meldKinds, doraKinds) {
  let han = 0;
  for (const d of doraKinds) {
    han += c[d];
    for (const k of meldKinds) if (k === d) han += 1;
  }
  if (closedHand) han += 1; // 리치
  const all = c.slice();
  for (const k of meldKinds) all[k] += 1;
  for (let k = 27; k < 34; k++) {
    if (!isYakuhai(k, view)) continue;
    const mult = (k === view.seatWinds[view.seat] ? 1 : 0) + (k === view.roundWind ? 1 : 0) + (k >= 31 ? 1 : 0);
    if (all[k] >= 3) han += mult;
    else if (c[k] === 2) han += 0.5 * mult;
  }
  const yaochuHand = c.reduce((a, n, t) => a + (isSimple(t) ? 0 : n), 0);
  const yaochuMeld = meldKinds.some((k) => !isSimple(k));
  if (!yaochuMeld) {
    if (yaochuHand === 0) han += 1;
    else if (yaochuHand <= 2) han += 0.4;
  }
  const suits = [0, 9, 18].map((b) => all.slice(b, b + 9).reduce((a, x) => a + x, 0));
  const honors = all.slice(27).reduce((a, x) => a + x, 0);
  const total = suits[0] + suits[1] + suits[2] + honors;
  const main = Math.max(...suits);
  const off = total - main - honors;
  if (off === 0 && main >= 8) han += closedHand ? (honors ? 3 : 6) : (honors ? 2 : 5);
  else if (off <= 2 && main >= 8) han += 0.6;
  return han;
}

// 텐파이 손(3n+1장)의 대기: 남은 장수, 역 없는 대기·후리텐 반영
function waitQuality(c, vis, ownSet, view, closedHand, meldObjs) {
  const w = waitsOf(c);
  let count = 0;
  let kinds = 0;
  for (const t of w) {
    const left = Math.max(0, 4 - vis[t]);
    if (!left) continue;
    let ok = true;
    if (!closedHand) {
      c[t] += 1;
      const r = evaluateWin({ closed: c, melds: meldObjs, winTile: t, tsumo: false, seatWind: view.seatWinds[view.seat], roundWind: view.roundWind, dora: [], ura: [] });
      c[t] -= 1;
      ok = Boolean(r && !r.noYaku);
    }
    if (ok) { count += left; kinds += 1; }
  }
  const furiten = w.some((t) => ownSet.has(t));
  return { count: furiten ? count * 0.3 : count, kinds, furiten };
}

export function analyzeDiscards(view, opt = {}) {
  const c = countsOf(view.hand);
  const closedHand = view.melds[view.seat].every((m) => m.type === 'ankan');
  const { danger, per, vis } = dangerByKind(view);
  const threat = per.length > 0;
  const riichiThreat = per.some((x) => x.threat >= 1);
  const doraKinds = view.dora.map(doraOf);
  const forbidden = opt.forbidden || [];
  const drawnKind = view.drawn !== null && view.drawn !== undefined ? kindOf(view.drawn) : -1;
  const meldKinds = [];
  for (const m of view.melds[view.seat]) for (const id of m.tiles) meldKinds.push(kindOf(id));
  const meldObjs = view.melds[view.seat].map((m) => ({ type: m.type, tiles: m.tiles.map(kindOf) }));
  const own = new Set(view.discards[view.seat].map((d) => kindOf(d.tile)));
  const left = (u) => Math.max(0, 4 - vis[u]);

  const cands = [];
  for (let t = 0; t < 34; t++) {
    if (!c[t] || forbidden.includes(t)) continue;
    c[t]--;
    const a = acceptanceVisible(c, vis, closedHand);
    const value = valueEstimate(c, view, closedHand, meldKinds, doraKinds);
    let wait = null;
    if (a.shanten === 0) {
      const ownT = new Set(own);
      ownT.add(t);
      wait = waitQuality(c, vis, ownT, view, closedHand, meldObjs);
    }
    c[t]++;
    cands.push({ t, shanten: a.shanten, accept: a.count, tiles: a.tiles, danger: danger[t], value, wait });
  }
  const minSh = Math.min(...cands.map((x) => x.shanten));

  // 유효 효율: 텐파이면 실제로 날 수 있는 대기 장수, 일샹텐이면 받은 뒤 대기의 질까지
  const best = cands.filter((x) => x.shanten === minSh);
  if (minSh === 0) {
    for (const x of best) x.eff = x.wait.count;
  } else if (minSh === 1) {
    const top = best.slice().sort((p, q) => q.accept - p.accept).slice(0, 5);
    for (const x of best) x.eff = x.accept * 0.7;
    for (const x of top) {
      c[x.t]--;
      const ownT = new Set(own);
      ownT.add(x.t);
      let eff = 0;
      for (const u of x.tiles) {
        const n = left(u);
        if (!n) continue;
        c[u]++;
        let bw = 0;
        for (let d = 0; d < 34; d++) {
          if (!c[d]) continue;
          c[d]--;
          if (shanten(c, { chiitoi: closedHand }) === 0) {
            const ownD = new Set(ownT);
            ownD.add(d);
            bw = Math.max(bw, waitQuality(c, vis, ownD, view, closedHand, meldObjs).count);
          }
          c[d]++;
        }
        c[u]--;
        eff += n * (0.4 + 0.6 * Math.min(1, bw / 8));
      }
      c[x.t]++;
      x.eff = eff;
    }
  } else {
    for (const x of best) x.eff = x.accept;
  }
  for (const x of cands) if (x.eff === undefined) x.eff = 0;
  const maxEff = Math.max(1e-6, ...best.map((x) => x.eff));
  const maxAcc = Math.max(1, ...best.map((x) => x.accept));
  const maxVal = Math.max(...cands.map((x) => x.value));

  // 밀고 당기기: 접어야 하는 정도 (0 = 민다, 1 = 접는다)
  let fold = 0;
  if (riichiThreat) {
    if (minSh >= 2) fold = 1;
    else if (minSh === 1) fold = maxVal >= 3 ? 0.3 : maxVal >= 2 ? 0.7 : 1;
    else if (maxEff >= 4 || maxVal >= 2.5) fold = 0;
    else fold = maxEff >= 2 ? 0.5 : 1;
  } else if (threat) {
    fold = minSh >= 2 ? 0.7 : minSh === 1 ? 0.4 : 0;
  }

  for (const x of cands) {
    const t = x.t;
    const n = t % 9;
    const isolated = c[t] === 1 && (t >= 27 || ![-2, -1, 1, 2].some((d) => n + d >= 0 && n + d <= 8 && c[t + d] > 0));
    const yaochu = t >= 27 || n === 0 || n === 8;
    const dn = Math.min(1.3, x.danger / 0.12);
    // 접을 때는 공격 쪽 요소(샹텐·효율·점수)의 무게를 줄인다
    const atk = 1 - 0.85 * fold;
    x.phi = [
      -(x.shanten - minSh) * atk,
      x.shanten === minSh ? (x.eff / maxEff) * atk : 0,
      threat ? -dn : 0,
      threat ? -dn * fold : 0,
      isYakuhai(t, view) && c[t] >= 2 ? -1 : 0,
      -doraKinds.filter((d) => d === t).length,
      isolated && yaochu ? 1 : 0,
      t >= 27 && t <= 30 && !isYakuhai(t, view) && c[t] === 1 ? 1 : 0,
      t === drawnKind ? 1 : 0,
      Math.max(-1.5, (x.value - maxVal) / 2) * atk,
    ];
  }
  return { cands, minSh, maxAcc, maxEff, maxVal, fold, threat, riichiThreat, per, vis, closedHand };
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
    if (r.best <= before && (!threatened || r.best === 0)) return { type: 'pon' };
  }
  if (threatened && before >= 1) {
    // 리치를 받았으면 울어서 바로 텐파이가 될 때만
    if (opt.pon) {
      const r = evalAfter([t, t], [t, t, t]);
      if (r.best === 0 && (hasYakuhaiMeld || r.simple || r.flush)) return { type: 'pon' };
    }
    for (const pair of opt.chi || []) {
      const r = evalAfter(pair, [t, ...pair]);
      if (r.best === 0 && (hasYakuhaiMeld || r.simple || r.flush)) return { type: 'chi', use: pair };
    }
    return { type: 'pass' };
  }
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

    const an = analyzeDiscards(view, opt);
    const w = this.weights(view);
    const probs = softmax(an.cands.map((x) => dot(w, x.phi)));
    const pick = an.cands[sample(probs, this.rng)];
    let riichi = (opt.riichi || []).includes(pick.t);
    if (riichi && pick.wait) {
      // 날 수 있는 대기가 없으면(후리텐 등) 리치하지 않는다. 리치를 받은 상황이면 좋은 대기나 높은 점수일 때만
      if (pick.wait.count <= 0) riichi = false;
      else if (an.riichiThreat && pick.wait.count < 4 && pick.value < 2.5) riichi = false;
    }
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
