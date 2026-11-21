// 퀴즈 문제 만들기: AI 넷이 실제로 두는 동안 생긴 장면을 모아 문제로 바꾼다.
import { Game, mulberry32, kindOf, countsOf } from './game.js';
import {
  AIPlayer, analyzeDiscards, softmax, dot, sample, STRONG, safeSet, visibleCounts, tileDanger, acceptanceVisible,
} from './ai.js';
import { waits as waitsOf, tileName, toList, shanten } from './engine.js';
import { scoreChoices } from './coach.js';
import { pointLabel, limitLabel } from './yaku.js';
import { basePoints } from './score.js';

export const CATS = {
  scoring: { ko: '점수 계산', skill: 'scoring' },
  han: { ko: '판수 세기', skill: 'yaku' },
  efficiency: { ko: '패효율', skill: 'efficiency' },
  defense: { ko: '수비', skill: 'defense' },
  waits: { ko: '대기 읽기', skill: 'waits' },
  furiten: { ko: '후리텐', skill: 'furiten' },
};

const WIND_KO = { 27: '동', 28: '남', 29: '서', 30: '북' };
// 손 모양만으로는 알 수 없는 역은 문제에 상황으로 알려 준다
const SITUATION = { riichi: '리치', doubleRiichi: '더블리치', ippatsu: '일발', haitei: '마지막 패 쯔모', houtei: '마지막 패 론', rinshan: '깡 뒤 영상 쯔모' };
const REL_KO = ['나', '하가(오른쪽)', '대면(맞은편)', '상가(왼쪽)'];

// ---------- 장면 모으기 ----------
class Harvester extends AIPlayer {
  constructor(pool, rng) {
    super({ rng, weights: () => STRONG.map((w) => w * 2) });
    this.pool = pool;
  }

  async chooseTurn(view, opt) {
    if (opt.tsumo && opt.tsumo.valid) return { type: 'tsumo' };
    if (view.riichi[view.seat]) return { type: 'discard', tile: kindOf(view.drawn) };
    const an = analyzeDiscards(view, opt);
    try { this.capture(view, an); } catch { /* 장면 하나 놓쳐도 그만 */ }
    const probs = softmax(an.cands.map((x) => dot(this.weights(view), x.phi)));
    const pick = an.cands[sample(probs, this.rng)];
    try { this.captureTenpai(view, pick.t); } catch { /* 무시 */ }
    const riichi = (opt.riichi || []).includes(pick.t) && pick.wait && pick.wait.count > 0;
    return { type: 'discard', tile: pick.t, riichi };
  }

  capture(view, an) {
    const pool = this.pool;
    const c = countsOf(view.hand);
    // 패효율: 멘젠, 위협 없음, 1~2샹텐, 정답이 뚜렷한 장면
    if (pool.efficiency.length < 40 && !an.threat && an.closedHand && an.minSh >= 1 && an.minSh <= 2 && an.cands.length >= 6) {
      const own = c.slice();
      const cands = an.cands.map((x) => {
        own[x.t] -= 1;
        const a = acceptanceVisible(own, c.map((n) => n), true);
        own[x.t] += 1;
        return { t: x.t, shanten: a.shanten, accept: a.count };
      });
      const minSh = Math.min(...cands.map((x) => x.shanten));
      const same = cands.filter((x) => x.shanten === minSh);
      const best = Math.max(...same.map((x) => x.accept));
      const near = same.filter((x) => x.accept >= best * 0.9).length;
      const weak = same.filter((x) => x.accept <= best * 0.8).length;
      if (near <= 2 && weak >= 1) pool.efficiency.push({ hand: view.hand.slice(), drawn: view.drawn, dora: view.dora.slice(), cands, minSh, best });
    }
    // 수비: 리치를 받았고 손이 먼 장면
    if (pool.defense.length < 30 && an.riichiThreat && an.minSh >= 2) {
      const opp = [0, 1, 2, 3].find((s) => s !== view.seat && view.riichi[s]);
      const safe = safeSet(view, opp);
      const vis = visibleCounts(view);
      const cands = an.cands.map((x) => ({ t: x.t, danger: tileDanger(x.t, safe, vis, view, opp) }));
      const dmin = Math.min(...cands.map((x) => x.danger));
      const dmax = Math.max(...cands.map((x) => x.danger));
      const safest = cands.filter((x) => x.danger <= dmin + 0.005).length;
      if (dmax - dmin >= 0.06 && safest <= 3) {
        const rt = view.discards[opp][view.riichiAt[opp]].turn;
        const after = new Set();
        for (let p = 0; p < 4; p++) if (p !== opp) for (const d of view.discards[p]) if (d.turn > rt) after.add(kindOf(d.tile));
        pool.defense.push({
          hand: view.hand.slice(), drawn: view.drawn, rel: (opp - view.seat + 4) % 4,
          river: view.discards[opp].map((d) => ({ k: kindOf(d.tile), riichi: d.riichi })),
          after: [...after].filter((k) => !view.discards[opp].some((d) => kindOf(d.tile) === k)),
          cands: cands.map((x) => ({ ...x, label: dangerLabel(x.t, safe, vis) })),
          seen: [27, 28, 29, 30, 31, 32, 33].filter((k) => vis[k] > 0).map((k) => ({ k, n: vis[k] })),
          dmin,
        });
      }
    }
  }

  captureTenpai(view, t) {
    const pool = this.pool;
    if (!view.melds[view.seat].every((m) => m.type === 'ankan') || view.melds[view.seat].length) return;
    const c = countsOf(view.hand);
    c[t] -= 1;
    const w = waitsOf(c);
    if (!w.length) return;
    if (pool.waits.length < 40 && (w.length >= 2 || this.rng() < 0.25)) pool.waits.push({ hand: toList(c), waits: w });
    const river = [...view.discards[view.seat].map((d) => kindOf(d.tile)), t];
    const furiten = w.some((k) => river.includes(k));
    if (pool.furiten.length < 40 && river.length >= 4) pool.furiten.push({ hand: toList(c), waits: w, river, furiten });
  }
}

export function dangerLabel(t, safe, vis) {
  if (safe.has(t)) return '현물';
  if (t >= 27) return `자패 · ${vis[t]}장 보임`;
  const n = t % 9;
  const routes = [];
  if (n >= 3) routes.push(safe.has(t - 3));
  if (n <= 5) routes.push(safe.has(t + 3));
  const covered = routes.filter(Boolean).length;
  if (covered === routes.length) return routes.length === 2 ? '양쪽 스지' : '스지';
  if (covered > 0) return '한쪽 스지';
  return '무근';
}

export function emptyPool() {
  return { efficiency: [], defense: [], waits: [], furiten: [], wins: [] };
}

// 필요한 만큼 모일 때까지 AI 대국을 돌린다
export async function harvest(need, { seed = Date.now(), maxGames = 5, onProgress = () => {}, yieldFn = null } = {}) {
  const pool = emptyPool();
  const enough = () => Object.entries(need).every(([k, n]) => (k === 'wins' ? pool.wins : pool[k]).length >= n);
  for (let g = 0; g < maxGames && !enough(); g++) {
    const rng = mulberry32((seed + g * 7919) >>> 0);
    const players = [0, 1, 2, 3].map(() => new Harvester(pool, rng));
    const game = new Game({
      players, seed: (seed ^ (g * 104729)) >>> 0, rules: { rounds: 1 },
      onEvent: (ev, gm) => {
        if (ev.type === 'win' && pool.wins.length < 40) {
          pool.wins.push({ win: ev.win, roundWind: gm.roundWind(), seatWind: gm.seatWind(ev.win.seat) });
        }
      },
    });
    await game.run();
    onProgress(g + 1);
    if (yieldFn) await yieldFn();
  }
  return pool;
}

// ---------- 문제로 바꾸기 ----------
const pick = (arr, rng) => arr.splice(Math.floor(rng() * arr.length), 1)[0];
const shuffle = (arr, rng) => arr.map((x) => [rng(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

function winInfo(item) {
  const { win } = item;
  const dealer = win.seat === win.dealer;
  return {
    dealer,
    tsumo: win.loser === null,
    chips: [dealer ? '친' : '자', win.loser === null ? '쯔모' : '론', `장풍 ${WIND_KO[item.roundWind]}`, `자풍 ${WIND_KO[item.seatWind]}`,
      ...win.result.yaku.filter((y) => SITUATION[y.key]).map((y) => SITUATION[y.key])],
    hand: win.hand.map(kindOf).filter((_, i) => win.loser !== null || win.hand[i] !== win.tile).sort((a, b) => a - b),
    winTile: kindOf(win.tile),
    melds: win.melds,
    dora: win.dora,
    ura: win.ura,
  };
}

function yakuText(r) {
  return r.yaku.map((y) => {
    if (r.yakuman) return y.name;
    const name = y.key === 'dora' || y.key === 'uradora' ? y.name.replace(/ \d+$/, '') : y.name;
    return `${name} ${y.han}판`;
  }).join(' · ');
}

function formula(r, dealer, tsumo) {
  if (r.yakuman || r.base >= 2000) return `${limitLabel(r)}이라 부수와 상관없다.`;
  const raw = r.fu * 2 ** (r.han + 2);
  if (!tsumo) return `기본점 = ${r.fu}부 × 2^(${r.han}+2) = ${raw}. ${dealer ? '친 론은 ×6' : '자 론은 ×4'} = ${raw * (dealer ? 6 : 4)} → 100점 단위로 올림.`;
  return `기본점 = ${r.fu}부 × 2^(${r.han}+2) = ${raw}. ${dealer ? '친 쯔모는 모두가 ×2' : '자 쯔모는 자가 ×1, 친이 ×2'} → 100점 단위로 올림.`;
}

export function scoringQuestion(item, showFu, rng) {
  const info = winInfo(item);
  const r = item.win.result;
  const { right, all } = scoreChoices(item.win, rng);
  return {
    cat: 'scoring', prompt: '이 화료는 몇 점인가?', kind: 'choice',
    chips: showFu && !r.yakuman ? [...info.chips, `${r.fu}부 ${r.han}판`] : info.chips,
    hand: info.hand, winTile: info.winTile, melds: info.melds, dora: info.dora,
    choices: all, answer: right,
    explain: `${r.yakuman ? '역만' : `${r.fu}부 ${r.han}판`} → ${right}. ${yakuText(r)}. ${formula(r, info.dealer, info.tsumo)}`,
    mistake: `${r.fu}부 ${r.han}판 ${info.dealer ? '친' : '자'} ${info.tsumo ? '쯔모' : '론'} → ${right}`,
  };
}

export function tableQuestion(rng) {
  const fu = [30, 30, 40, 40, 50, 60, 70][Math.floor(rng() * 7)];
  const han = 1 + Math.floor(rng() * 4);
  const dealer = rng() < 0.4;
  const tsumo = rng() < 0.4;
  const base = basePoints(fu, han);
  const fake = { result: { base, fu, han, yakuman: 0 }, seat: dealer ? 0 : 1, dealer: 0, loser: tsumo ? null : 2 };
  const { right, all } = scoreChoices(fake, rng);
  const r = { ...fake.result, yaku: [] };
  return {
    cat: 'scoring', prompt: `${fu}부 ${han}판, ${dealer ? '친' : '자'}의 ${tsumo ? '쯔모' : '론'}. 몇 점인가?`, kind: 'choice',
    chips: [dealer ? '친' : '자', tsumo ? '쯔모' : '론', `${fu}부 ${han}판`],
    choices: all, answer: right,
    explain: `${right}. ${formula(r, dealer, tsumo)}`,
    mistake: `${fu}부 ${han}판 ${dealer ? '친' : '자'} ${tsumo ? '쯔모' : '론'} → ${right}`,
  };
}

export function hanQuestion(item, rng) {
  const info = winInfo(item);
  const r = item.win.result;
  const set = new Set([r.han]);
  for (const d of shuffle([-2, -1, 1, 2, 3], rng)) { if (set.size >= 4) break; if (r.han + d >= 1) set.add(r.han + d); }
  const choices = [...set].sort((a, b) => a - b).map((h) => `${h}판`);
  return {
    cat: 'han', prompt: '이 화료는 몇 판인가? (도라·뒷도라 포함)', kind: 'choice',
    chips: info.chips, hand: info.hand, winTile: info.winTile, melds: info.melds, dora: info.dora, ura: info.ura,
    choices, answer: `${r.han}판`,
    explain: `${yakuText(r)} → 모두 ${r.han}판.`,
    mistake: `판수: ${yakuText(r)} = ${r.han}판`,
  };
}

export function efficiencyQuestion(item) {
  const rows = item.cands.slice().sort((a, b) => a.shanten - b.shanten || b.accept - a.accept);
  const ok = (t) => {
    const x = item.cands.find((y) => y.t === t);
    return x && x.shanten === item.minSh && x.accept >= item.best * 0.9;
  };
  const bestTiles = rows.filter((x) => ok(x.t)).map((x) => x.t);
  return {
    cat: 'efficiency', prompt: '받는 패(유효패)가 가장 많아지는 타패를 골라라.', kind: 'tile',
    chips: [`${item.minSh}샹텐`, '장수는 이 손만 보고 센다'],
    handIds: item.hand, drawn: item.drawn, dora: item.dora,
    judge: ok,
    answerTiles: bestTiles,
    table: rows.slice(0, 5).map((x) => ({ t: x.t, text: `${x.shanten}샹텐 · ${x.accept}장` })),
    explain: `정답은 ${bestTiles.map(tileName).join(' · ')} (${item.best}장).`,
    mistakeFor: (t) => {
      const x = item.cands.find((y) => y.t === t);
      return `${tileName(t)} 버림 (${x ? x.accept : 0}장) → ${bestTiles.map(tileName).join(' · ')} (${item.best}장)`;
    },
  };
}

export function defenseQuestion(item) {
  const rows = item.cands.slice().sort((a, b) => a.danger - b.danger);
  const ok = (t) => {
    const x = item.cands.find((y) => y.t === t);
    return x && x.danger <= item.dmin + 0.005;
  };
  const bestTiles = rows.filter((x) => ok(x.t)).map((x) => x.t);
  return {
    cat: 'defense', prompt: `${REL_KO[item.rel]}가 리치했다. 네 손은 2샹텐 이상으로 멀다. 가장 안전한 패는?`, kind: 'tile',
    chips: ['리치 상대', '손이 멀다 → 접기'],
    handIds: item.hand, drawn: item.drawn,
    river: item.river, after: item.after, seen: item.seen,
    judge: ok,
    answerTiles: bestTiles,
    table: rows.slice(0, 5).map((x) => ({ t: x.t, text: x.label })),
    explain: `가장 안전한 패: ${bestTiles.map(tileName).join(' · ')} (${rows[0].label}). 현물 → 스지·많이 보인 자패 → 한쪽 스지 → 무근 순으로 위험해진다.`,
    mistakeFor: (t) => {
      const x = item.cands.find((y) => y.t === t);
      return `리치 상대에게 ${tileName(t)} (${x ? x.label : ''}). 안전한 패: ${bestTiles.map(tileName).join(' · ')}`;
    },
  };
}

export function waitsQuestion(item) {
  return {
    cat: 'waits', prompt: '텐파이다. 대기패를 모두 골라라.', kind: 'tiles',
    chips: [`대기 ${item.waits.length > 1 ? '여러 종류일 수 있다' : '?'}`],
    hand: item.hand, answerSet: item.waits,
    explain: `대기는 ${item.waits.map(tileName).join(' · ')} (${item.waits.length}종).`,
    mistakeFor: (sel) => `대기 ${sel.map(tileName).join(' · ') || '없음'}라고 답함 → 정답 ${item.waits.map(tileName).join(' · ')}`,
  };
}

export function furitenQuestion(item) {
  const inRiver = item.waits.filter((k) => item.river.includes(k));
  return {
    cat: 'furiten', prompt: '상대가 네 대기패를 버렸다. 이 손으로 론할 수 있나?', kind: 'choice',
    chips: ['텐파이', '리치 없음'],
    hand: item.hand, ownRiver: item.river,
    choices: ['론 가능', '후리텐 (쯔모만)'], answer: item.furiten ? '후리텐 (쯔모만)' : '론 가능',
    explain: item.furiten
      ? `대기는 ${item.waits.map(tileName).join(' · ')}인데 ${inRiver.map(tileName).join(' · ')}을(를) 네가 버렸다. 하나라도 버렸으면 모든 대기로 론을 못 한다.`
      : `대기 ${item.waits.map(tileName).join(' · ')} 중 네가 버린 패가 없다. 론할 수 있다.`,
    mistake: `후리텐 판단 (대기 ${item.waits.map(tileName).join(' · ')}, ${item.furiten ? '후리텐' : '후리텐 아님'})`,
  };
}

// 카테고리 순서 정하기
export function planCategories(mode, weights, n, rng) {
  if (mode !== 'mix') return Array(n).fill(mode);
  const keys = Object.keys(CATS);
  const out = [];
  for (let i = 0; i < n; i++) {
    const total = keys.reduce((a, k) => a + weights[k], 0);
    let r = rng() * total;
    let k = keys[0];
    for (const key of keys) { r -= weights[key]; if (r <= 0) { k = key; break; } }
    out.push(k);
  }
  return out;
}

export function needFor(plan) {
  const need = { efficiency: 0, defense: 0, waits: 0, furiten: 0, wins: 0 };
  for (const c of plan) {
    if (c === 'scoring' || c === 'han') need.wins += 1;
    else need[c] += 1;
  }
  // 점수 문제는 표 문제로 메울 수 있어 절반만 요구
  need.wins = Math.ceil(need.wins * 0.7);
  return need;
}

export function buildQuestions(plan, pool, { showFu, rng }) {
  const P = {
    efficiency: shuffle(pool.efficiency, rng), defense: shuffle(pool.defense, rng), waits: shuffle(pool.waits, rng),
    wins: shuffle(pool.wins.filter((w) => !w.win.result.yakuman), rng),
  };
  // 후리텐은 반반 섞는다
  const fy = shuffle(pool.furiten.filter((x) => x.furiten), rng);
  const fn = shuffle(pool.furiten.filter((x) => !x.furiten), rng);
  const qs = [];
  for (const c of plan) {
    let q = null;
    if (c === 'scoring') q = P.wins.length ? scoringQuestion(pick(P.wins, rng), showFu, rng) : tableQuestion(rng);
    if (c === 'han' && P.wins.length) q = hanQuestion(pick(P.wins, rng), rng);
    if (c === 'efficiency' && P.efficiency.length) q = efficiencyQuestion(pick(P.efficiency, rng));
    if (c === 'defense' && P.defense.length) q = defenseQuestion(pick(P.defense, rng));
    if (c === 'waits' && P.waits.length) q = waitsQuestion(pick(P.waits, rng));
    if (c === 'furiten') {
      const want = rng() < 0.5 ? fy : fn;
      const from = want.length ? want : (fy.length ? fy : fn);
      if (from.length) q = furitenQuestion(pick(from, rng));
    }
    if (!q) q = tableQuestion(rng); // 장면이 모자라면 점수표 문제로
    qs.push(q);
  }
  return qs;
}

export { shanten };
