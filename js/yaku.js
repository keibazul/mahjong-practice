// 화료 판정: 손패를 멘쯔로 나누고 역·부수·점수를 계산한다.
// 패 종류 번호는 engine.js와 같다 (0-8 만, 9-17 통, 18-26 삭, 27-33 동남서북백발중).
import { isChiitoi, isKokushi } from './engine.js';
import { basePoints, ceil100 } from './score.js';

const isHonor = (t) => t >= 27;
const isTerm = (t) => t < 27 && (t % 9 === 0 || t % 9 === 8);
const isYaochu = (t) => isHonor(t) || isTerm(t);
const isDragon = (t) => t >= 31;
const isWind = (t) => t >= 27 && t <= 30;
const GREEN = new Set([19, 20, 21, 23, 25, 32]); // 2·3·4·6·8삭, 발

export const YAKU_KO = {
  riichi: '리치', doubleRiichi: '더블리치', ippatsu: '일발', tsumo: '멘젠쯔모', pinfu: '핑후',
  tanyao: '탕야오', iipeikou: '이페코', haku: '역패 백', hatsu: '역패 발', chun: '역패 중',
  seatWind: '자풍패', roundWind: '장풍패', haitei: '해저로월', houtei: '하저로어', rinshan: '영상개화',
  sanshoku: '삼색동순', ittsu: '일기통관', chanta: '찬타', junchan: '준찬타', toitoi: '또이또이',
  sanankou: '산안커', sanshokuDoukou: '삼색동각', sankantsu: '산깡쯔', shousangen: '소삼원',
  honroutou: '혼노두', chiitoitsu: '칠대자', honitsu: '혼일색', chinitsu: '청일색', ryanpeikou: '량페코',
  kokushi: '국사무쌍', suuankou: '스안커', daisangen: '대삼원', shousuushii: '소사희', daisuushii: '대사희',
  tsuuiisou: '자일색', ryuuiisou: '녹일색', chinroutou: '청노두', chuuren: '구련보등', suukantsu: '스깡쯔',
  dora: '도라', uradora: '뒷도라',
};

// 도라 표시패 → 도라
export function doraOf(ind) {
  if (ind < 27) return Math.floor(ind / 9) * 9 + ((ind % 9) + 1) % 9;
  if (ind <= 30) return 27 + ((ind - 27) + 1) % 4;
  return 31 + ((ind - 31) + 1) % 3;
}

// 닫힌 손패(3n+2장)를 머리 1 + 멘쯔들로 나누는 모든 방법
export function decompositions(c) {
  const out = [];
  const sets = [];
  const a = c.slice();
  function rec(i, pair) {
    while (i < 34 && a[i] === 0) i++;
    if (i >= 34) { out.push({ pair, sets: sets.slice() }); return; }
    if (a[i] >= 3) {
      a[i] -= 3; sets.push({ kind: 'trip', t: i }); rec(i, pair); sets.pop(); a[i] += 3;
    }
    if (i < 27 && i % 9 <= 6 && a[i + 1] > 0 && a[i + 2] > 0) {
      a[i]--; a[i + 1]--; a[i + 2]--;
      sets.push({ kind: 'seq', t: i }); rec(i, pair); sets.pop();
      a[i]++; a[i + 1]++; a[i + 2]++;
    }
  }
  for (let p = 0; p < 34; p++) {
    if (a[p] >= 2) { a[p] -= 2; rec(0, p); a[p] += 2; }
  }
  return out;
}

function meldToSet(m) {
  if (m.type === 'chi') return { kind: 'seq', t: Math.min(...m.tiles), open: true, kan: false };
  if (m.type === 'pon') return { kind: 'trip', t: m.tiles[0], open: true, kan: false };
  if (m.type === 'ankan') return { kind: 'trip', t: m.tiles[0], open: false, kan: true };
  return { kind: 'trip', t: m.tiles[0], open: true, kan: true }; // minkan, kakan
}

function countDora(all, indicators) {
  let n = 0;
  for (const ind of indicators) n += all[doraOf(ind)];
  return n;
}

// ctx: { closed: 개수배열(화료패 포함), melds, winTile, tsumo, seatWind, roundWind,
//        riichi, doubleRiichi, ippatsu, haitei, houtei, rinshan, dora: 표시패[], ura: 표시패[] }
// 반환: null(화료 형태 아님) 또는 { yaku:[{key,name,han}], han, fu, yakuman, base, noYaku }
export function evaluateWin(ctx) {
  const { closed, melds = [], winTile, tsumo } = ctx;
  const menzen = melds.every((m) => m.type === 'ankan');
  const all = closed.slice();
  for (const m of melds) for (const t of m.tiles) all[t] += 1;

  const candidates = [];
  const mset = melds.map(meldToSet);

  for (const d of decompositions(closed)) {
    const winBlocks = [];
    if (d.pair === winTile) winBlocks.push({ type: 'pair' });
    d.sets.forEach((s, i) => {
      if (s.kind === 'trip' && s.t === winTile) winBlocks.push({ type: 'trip', i });
      if (s.kind === 'seq' && winTile >= s.t && winTile <= s.t + 2) winBlocks.push({ type: 'seq', i });
    });
    for (const wb of winBlocks) candidates.push(scoreRegular(ctx, d, wb, mset, all, menzen));
  }
  if (menzen && isChiitoi(closed)) candidates.push(scoreChiitoi(ctx, all));
  if (menzen && isKokushi(closed)) candidates.push(withDora(ctx, all, [{ key: 'kokushi', han: 13 }], 0, 1));
  if (!candidates.length) return null;
  candidates.sort((x, y) => y.base - x.base || y.han - x.han || y.fu - x.fu);
  return candidates[0];
}

function waitKind(s, w) {
  if (w === s.t + 1) return 'kanchan';
  if (w === s.t && s.t % 9 === 6) return 'penchan';
  if (w === s.t + 2 && s.t % 9 === 0) return 'penchan';
  return 'ryanmen';
}

function scoreRegular(ctx, d, wb, mset, all, menzen) {
  const { tsumo, seatWind, roundWind, winTile } = ctx;
  const closedSets = d.sets.map((s, i) => ({
    ...s,
    open: wb.type === 'trip' && wb.i === i && !tsumo, // 론으로 완성한 커쯔는 밝은 커쯔
    kan: false,
  }));
  const sets = [...closedSets, ...mset];
  const pair = d.pair;
  let wait = 'tanki';
  if (wb.type === 'trip') wait = 'shanpon';
  if (wb.type === 'seq') wait = waitKind(d.sets[wb.i], winTile);

  const seqs = sets.filter((s) => s.kind === 'seq');
  const trips = sets.filter((s) => s.kind === 'trip');
  const concealedTrips = trips.filter((s) => !s.open).length;
  const kans = trips.filter((s) => s.kan).length;
  const yakuhaiPair = isDragon(pair) || pair === seatWind || pair === roundWind;

  const ym = [];
  const y = [];
  const add = (key, closedHan, openHan = closedHan) => {
    const h = menzen ? closedHan : openHan;
    if (h > 0) y.push({ key, han: h });
  };

  // 역만
  const dragonTrips = trips.filter((s) => isDragon(s.t)).length;
  const windTrips = trips.filter((s) => isWind(s.t)).length;
  if (dragonTrips === 3) ym.push({ key: 'daisangen', han: 13 });
  if (windTrips === 4) ym.push({ key: 'daisuushii', han: 13 });
  else if (windTrips === 3 && isWind(pair)) ym.push({ key: 'shousuushii', han: 13 });
  if (concealedTrips === 4) ym.push({ key: 'suuankou', han: 13 });
  if (kans === 4) ym.push({ key: 'suukantsu', han: 13 });
  const tiles = [];
  all.forEach((n, t) => { if (n) tiles.push(t); });
  if (tiles.every(isHonor)) ym.push({ key: 'tsuuiisou', han: 13 });
  if (tiles.every((t) => GREEN.has(t))) ym.push({ key: 'ryuuiisou', han: 13 });
  if (tiles.every(isTerm)) ym.push({ key: 'chinroutou', han: 13 });
  if (menzen && isChuuren(all)) ym.push({ key: 'chuuren', han: 13 });
  if (ym.length) return withDora(ctx, all, ym, 0, ym.length);

  // 일반 역
  if (ctx.doubleRiichi) y.push({ key: 'doubleRiichi', han: 2 });
  else if (ctx.riichi) y.push({ key: 'riichi', han: 1 });
  if (ctx.ippatsu) y.push({ key: 'ippatsu', han: 1 });
  if (menzen && tsumo) y.push({ key: 'tsumo', han: 1 });
  const pinfu = menzen && seqs.length === 4 && !yakuhaiPair && wait === 'ryanmen';
  if (pinfu) y.push({ key: 'pinfu', han: 1 });
  if (tiles.every((t) => !isYaochu(t))) y.push({ key: 'tanyao', han: 1 });

  if (menzen) {
    const keys = seqs.map((s) => s.t).sort((a, b) => a - b);
    let pairs = 0;
    for (let i = 0; i + 1 < keys.length; i++) if (keys[i] === keys[i + 1]) { pairs++; i++; }
    if (pairs === 2) y.push({ key: 'ryanpeikou', han: 3 });
    else if (pairs === 1) y.push({ key: 'iipeikou', han: 1 });
  }
  for (const s of trips) {
    if (s.t === 31) y.push({ key: 'haku', han: 1 });
    if (s.t === 32) y.push({ key: 'hatsu', han: 1 });
    if (s.t === 33) y.push({ key: 'chun', han: 1 });
    if (s.t === seatWind) y.push({ key: 'seatWind', han: 1 });
    if (s.t === roundWind) y.push({ key: 'roundWind', han: 1 });
  }
  if (ctx.haitei && tsumo) y.push({ key: 'haitei', han: 1 });
  if (ctx.houtei && !tsumo) y.push({ key: 'houtei', han: 1 });
  if (ctx.rinshan && tsumo) y.push({ key: 'rinshan', han: 1 });

  for (let n = 0; n < 7; n++) {
    if ([0, 9, 18].every((b) => seqs.some((s) => s.t === b + n))) { add('sanshoku', 2, 1); break; }
  }
  for (const b of [0, 9, 18]) {
    if ([0, 3, 6].every((k) => seqs.some((s) => s.t === b + k))) { add('ittsu', 2, 1); break; }
  }
  const blockYaochu = (s) => (s.kind === 'seq' ? (s.t % 9 === 0 || s.t % 9 === 6) : isYaochu(s.t));
  if (seqs.length > 0 && sets.every(blockYaochu) && isYaochu(pair)) {
    const hasHonor = tiles.some(isHonor);
    if (hasHonor) add('chanta', 2, 1);
    else add('junchan', 3, 2);
  }
  if (trips.length === 4) y.push({ key: 'toitoi', han: 2 });
  if (concealedTrips === 3) y.push({ key: 'sanankou', han: 2 });
  for (let n = 0; n < 9; n++) {
    if ([0, 9, 18].every((b) => trips.some((s) => s.t === b + n))) { y.push({ key: 'sanshokuDoukou', han: 2 }); break; }
  }
  if (kans === 3) y.push({ key: 'sankantsu', han: 2 });
  if (dragonTrips === 2 && isDragon(pair)) y.push({ key: 'shousangen', han: 2 });
  if (tiles.every(isYaochu)) y.push({ key: 'honroutou', han: 2 });
  flushYaku(tiles, add);

  // 부수
  let fu;
  if (pinfu) fu = tsumo ? 20 : 30;
  else {
    fu = 20;
    if (menzen && !tsumo) fu += 10;
    if (tsumo) fu += 2;
    for (const s of trips) {
      let f = isYaochu(s.t) ? 4 : 2;
      if (!s.open) f *= 2;
      if (s.kan) f *= 4;
      fu += f;
    }
    if (wait === 'kanchan' || wait === 'penchan' || wait === 'tanki') fu += 2;
    if (isDragon(pair)) fu += 2;
    if (pair === seatWind) fu += 2;
    if (pair === roundWind) fu += 2;
    fu = Math.ceil(fu / 10) * 10;
    if (fu === 20) fu = 30; // 울고 부수가 없는 화료
  }
  const res = withDora(ctx, all, y, fu, 0);
  res.wait = wait;
  return res;
}

function flushYaku(tiles, add) {
  const suits = new Set(tiles.filter((t) => t < 27).map((t) => Math.floor(t / 9)));
  const hasHonor = tiles.some(isHonor);
  if (suits.size === 1) {
    if (hasHonor) add('honitsu', 3, 2);
    else add('chinitsu', 6, 5);
  }
}

function isChuuren(all) {
  const suits = [0, 9, 18].filter((b) => all.slice(b, b + 9).reduce((a, n) => a + n, 0) === 14);
  if (suits.length !== 1) return false;
  const b = suits[0];
  const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
  return need.every((n, i) => all[b + i] >= n);
}

function scoreChiitoi(ctx, all) {
  const y = [];
  const tiles = [];
  all.forEach((n, t) => { if (n) tiles.push(t); });
  if (tiles.every(isHonor)) return withDora(ctx, all, [{ key: 'tsuuiisou', han: 13 }], 0, 1);
  if (ctx.doubleRiichi) y.push({ key: 'doubleRiichi', han: 2 });
  else if (ctx.riichi) y.push({ key: 'riichi', han: 1 });
  if (ctx.ippatsu) y.push({ key: 'ippatsu', han: 1 });
  if (ctx.tsumo) y.push({ key: 'tsumo', han: 1 });
  y.push({ key: 'chiitoitsu', han: 2 });
  if (tiles.every((t) => !isYaochu(t))) y.push({ key: 'tanyao', han: 1 });
  if (tiles.every(isYaochu)) y.push({ key: 'honroutou', han: 2 });
  if (ctx.haitei && ctx.tsumo) y.push({ key: 'haitei', han: 1 });
  if (ctx.houtei && !ctx.tsumo) y.push({ key: 'houtei', han: 1 });
  flushYaku(tiles, (key, h) => y.push({ key, han: h }));
  const res = withDora(ctx, all, y, 25, 0);
  res.wait = 'tanki';
  return res;
}

function withDora(ctx, all, yakuList, fu, yakuman) {
  const yaku = yakuList.map((x) => ({ ...x, name: YAKU_KO[x.key] }));
  if (yakuman) {
    return { yaku, han: 13 * yakuman, fu, yakuman, base: 8000 * yakuman, noYaku: false, doraCount: 0 };
  }
  const yakuHan = yaku.reduce((a, x) => a + x.han, 0);
  if (yakuHan === 0) return { yaku: [], han: 0, fu, yakuman: 0, base: 0, noYaku: true, doraCount: 0 };
  const dora = countDora(all, ctx.dora || []);
  const ura = ctx.riichi || ctx.doubleRiichi ? countDora(all, ctx.ura || []) : 0;
  if (dora) yaku.push({ key: 'dora', name: `${YAKU_KO.dora} ${dora}`, han: dora });
  if (ura) yaku.push({ key: 'uradora', name: `${YAKU_KO.uradora} ${ura}`, han: ura });
  const han = yakuHan + dora + ura;
  return { yaku, han, fu, yakuman: 0, base: basePoints(fu, han), noYaku: false, doraCount: dora + ura };
}

// 점수 이동. 반환: { total, pay: [4명 증감] , label }
export function payments({ base, winner, loser, dealer, honba = 0, sticks = 0 }) {
  const pay = [0, 0, 0, 0];
  const isDealer = winner === dealer;
  if (loser !== null && loser !== undefined) {
    const v = ceil100(base * (isDealer ? 6 : 4)) + honba * 300;
    pay[loser] -= v;
    pay[winner] += v;
  } else {
    for (let p = 0; p < 4; p++) {
      if (p === winner) continue;
      const v = ceil100(base * (isDealer || p === dealer ? 2 : 1)) + honba * 100;
      pay[p] -= v;
      pay[winner] += v;
    }
  }
  pay[winner] += sticks * 1000;
  return pay;
}

export function pointLabel(base, dealerWin, tsumo) {
  if (!tsumo) return `${ceil100(base * (dealerWin ? 6 : 4)).toLocaleString('ko-KR')}점`;
  if (dealerWin) return `${ceil100(base * 2).toLocaleString('ko-KR')}점 올`;
  return `${ceil100(base).toLocaleString('ko-KR')} / ${ceil100(base * 2).toLocaleString('ko-KR')}점`;
}

export function limitLabel(r) {
  if (r.yakuman) return r.yakuman > 1 ? `${r.yakuman}배 역만` : '역만';
  if (r.han >= 11) return '삼배만';
  if (r.han >= 8) return '배만';
  if (r.han >= 6) return '하네만';
  if (r.base >= 2000) return '만관';
  return `${r.fu}부 ${r.han}판`;
}
