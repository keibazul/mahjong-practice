// 사부(코치): 숙련도에 따라 대국 중 판단을 채점하고, 약한 기술은 더 자주 묻는다.
import { shanten } from './engine.js';
import { level } from './ml.js';
import { pointLabel } from './yaku.js';
import { basePoints } from './score.js';

// 이 기술을 지금 물어볼 확률
export function askProb(profile, skill) {
  const mode = profile.settings.coach;
  if (mode === 'off') return 0;
  const m = level(profile.mastery[skill]);
  const base = 0.05 + 0.7 * (1 - m) ** 1.5;
  return Math.min(0.9, mode === 'many' ? base * 1.8 : base);
}

// ---- 패효율 채점 (위협이 없을 때) ----
export function judgeEfficiency(an, chosen) {
  if (an.riichiThreat || an.minSh > 3) return null;
  const same = an.cands.filter((x) => x.shanten === an.minSh);
  const bestAcc = Math.max(...same.map((x) => x.accept));
  const spread = same.some((x) => x.accept < bestAcc * 0.85);
  if (same.length < 2 && an.cands.length < 2) return null;
  const mine = an.cands.find((x) => x.t === chosen);
  const best = same.filter((x) => x.accept === bestAcc).map((x) => x.t);
  const correct = mine.shanten === an.minSh && mine.accept >= bestAcc * 0.9;
  const meaningful = spread || mine.shanten > an.minSh;
  return { correct, meaningful, best, bestAcc, mine, minSh: an.minSh };
}

// ---- 수비 채점 (누군가 리치했거나 위협적일 때) ----
export function judgeDefense(an, chosen) {
  if (!an.riichiThreat || an.minSh === 0) return null;
  const minDanger = Math.min(...an.cands.map((x) => x.danger));
  const mine = an.cands.find((x) => x.t === chosen);
  const safest = an.cands.filter((x) => x.danger <= minDanger + 0.001).map((x) => x.t);
  const slack = an.minSh >= 2 ? 0.015 : 0.04;
  const correct = mine.danger <= minDanger + slack;
  return { correct, safest, minDanger, mine, far: an.minSh >= 2 };
}

// ---- 점수 맞히기 보기 ----
export function scoreChoices(win, rng = Math.random) {
  const r = win.result;
  const dealerWin = win.seat === win.dealer;
  const tsumo = win.loser === null;
  const right = pointLabel(r.base, dealerWin, tsumo);
  const pool = new Set();
  if (!r.yakuman && r.han < 5) {
    const variants = [[r.fu, r.han + 1], [r.fu, r.han - 1], [r.fu + 10, r.han], [r.fu - 10, r.han], [r.fu + 20, r.han], [r.fu, r.han + 2]];
    for (const [fu, han] of variants) {
      if (han < 1 || fu < 20) continue;
      pool.add(pointLabel(basePoints(fu, han), dealerWin, tsumo));
    }
    pool.add(pointLabel(r.base, !dealerWin, tsumo));
  } else {
    const ladder = [2000, 3000, 4000, 6000, 8000];
    for (const b of ladder) pool.add(pointLabel(b, dealerWin, tsumo));
    pool.add(pointLabel(r.base, !dealerWin, tsumo));
  }
  pool.delete(right);
  const wrong = [...pool].sort(() => rng() - 0.5).slice(0, 3);
  const all = [right, ...wrong].sort((a, b) => parseInt(a.replace(/,/g, ''), 10) - parseInt(b.replace(/,/g, ''), 10));
  return { right, all };
}

// ---- 배패 기울이기: 약한 기술이 나오기 쉬운 손을 고른다 ----
function complexShapes(c) {
  let score = 0;
  for (const b of [0, 9, 18]) {
    let run = 0;
    let gap = 0;
    for (let n = 0; n < 9; n++) {
      if (c[b + n]) {
        run += c[b + n];
        gap = 0;
      } else {
        gap += 1;
        if (gap >= 2) { if (run >= 4) score += 1 + (run >= 6 ? 0.5 : 0); run = 0; }
      }
    }
    if (run >= 4) score += 1 + (run >= 6 ? 0.5 : 0);
  }
  return score;
}

function suitBias(c) {
  const s = [0, 9, 18].map((b) => c.slice(b, b + 9).reduce((a, x) => a + x, 0));
  return Math.max(0, Math.max(...s) - 6) / 3;
}

export function makeDealShaper(profile, rng = Math.random) {
  const w = (k) => 1 - level(profile.mastery[k]);
  return (previews) => {
    const scores = previews.map((hands) => {
      const counts = hands.map((ids) => {
        const c = new Array(34).fill(0);
        for (const id of ids) c[id >> 2] += 1;
        return c;
      });
      const sh = counts.map((c) => shanten(c, { chiitoi: true }));
      const oppAvg = (sh[1] + sh[2] + sh[3]) / 3;
      const me = counts[0];
      return w('efficiency') * complexShapes(me)
        + (w('waits') + w('furiten')) * 0.6 * suitBias(me)
        + w('defense') * (3.3 - oppAvg) * 0.8
        - Math.abs(sh[0] - oppAvg) * 0.5;
    });
    const m = Math.max(...scores);
    const e = scores.map((s) => Math.exp((s - m) * 2));
    const z = e.reduce((a, b) => a + b, 0);
    let r = rng() * z;
    for (let i = 0; i < e.length; i++) { r -= e[i]; if (r <= 0) return i; }
    return 0;
  };
}

// ---- 사부의 말 ----
const pickLine = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];

export const LINES = {
  effAsk: ['이번 패는 유효패를 세고 버려라.', '서두르지 마라. 어느 패를 버려야 가장 많이 받나?', '여기는 효율 문제다. 장수를 세어 봐라.'],
  effGood: ['좋다. 그게 가장 넓다.', '정확하다. 받는 패가 제일 많은 쪽이다.', '그래, 그렇게 세는 거다.'],
  effBad: ['아깝다.', '조금 좁게 갔다.', '장수를 다시 세어 봐라.'],
  defAsk: ['리치가 걸렸다. 지금 가장 안전한 패는?', '상대가 텐파이다. 네 손으로 밀 만한가, 접을 때인가?'],
  defGood: ['잘 접었다. 그게 제일 안전하다.', '좋은 판단이다.'],
  defBad: ['위험한 패를 내줬다.', '그 패는 손이 멀 때 낼 패가 아니다.'],
  waitAsk: ['텐파이다. 대기패를 전부 말해 봐라.'],
  furitenAsk: ['잠깐. 지금 이 손으로 론을 할 수 있나?'],
  scoreAsk: ['점수를 불러 봐라.', '얼마짜리냐?'],
};

export { pickLine };

export const FALSE_WIN_TEXT = {
  noYaku: '역이 없다. 울었다면 역패·탕야오처럼 울어도 되는 역이 있어야 하고, 멘젠이면 리치를 걸어야 화료할 수 있다.',
  furitenDiscard: '후리텐이다. 대기패 중 하나를 네가 이미 버렸다. 이 손은 쯔모로만 날 수 있다.',
  furitenTemp: '동순 후리텐이다. 이번 바퀴에 대기패를 한 번 보냈으니 네 다음 쯔모 전까지는 론을 못 한다.',
  furitenRiichi: '리치 후 후리텐이다. 리치하고 대기패를 한 번 보냈으니 이 국에선 쯔모로만 날 수 있다.',
  notAgari: '아직 화료 형태가 아니다.',
};
