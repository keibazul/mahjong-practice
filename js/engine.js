// 리치 마작 계산 엔진: 패 표기, 화료 판정, 대기, 샹텐, 유효패, 손패 생성
// 패 번호: 0-8 만(1m-9m), 9-17 통(1p-9p), 18-26 삭(1s-9s), 27-33 동남서북백발중

export const SUITS = ['m', 'p', 's'];
export const SUIT_KO = { m: '만', p: '통', s: '삭' };
export const HONORS_KO = ['동', '남', '서', '북', '백', '발', '중'];

export const suitOf = (t) => (t < 27 ? SUITS[Math.floor(t / 9)] : 'z');
export const numOf = (t) => (t < 27 ? (t % 9) + 1 : t - 26);
export const isHonor = (t) => t >= 27;
export const isTerminalOrHonor = (t) => t >= 27 || t % 9 === 0 || t % 9 === 8;

export function tileName(t) {
  if (t >= 27) return HONORS_KO[t - 27];
  return `${numOf(t)}${SUIT_KO[suitOf(t)]}`;
}

// "234m567p3456888s11z" → 개수 배열(34칸)
export function parse(str) {
  const c = new Array(34).fill(0);
  let nums = '';
  for (const ch of str.replace(/\s/g, '')) {
    if (/[0-9]/.test(ch)) nums += ch;
    else {
      const base = { m: 0, p: 9, s: 18, z: 27 }[ch];
      for (const n of nums) c[base + (n === '0' ? 5 : Number(n)) - 1] += 1;
      nums = '';
    }
  }
  return c;
}

export function toList(c) {
  const out = [];
  c.forEach((n, t) => { for (let i = 0; i < n; i++) out.push(t); });
  return out;
}

export function fromList(list) {
  const c = new Array(34).fill(0);
  list.forEach((t) => { c[t] += 1; });
  return c;
}

// 개수 배열 → "234m567p" 표기
export function toString(c) {
  let out = '';
  for (const [si, s] of ['m', 'p', 's', 'z'].entries()) {
    let part = '';
    const len = s === 'z' ? 7 : 9;
    for (let n = 0; n < len; n++) part += String(n + 1).repeat(c[si * 9 + n]);
    if (part) out += part + s;
  }
  return out;
}

const total = (c) => c.reduce((a, b) => a + b, 0);

// ---- 화료 판정 ----
function canMeld(c, i = 0) {
  while (i < 34 && c[i] === 0) i++;
  if (i >= 34) return true;
  if (c[i] >= 3) {
    c[i] -= 3;
    const ok = canMeld(c, i);
    c[i] += 3;
    if (ok) return true;
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    const ok = canMeld(c, i);
    c[i]++; c[i + 1]++; c[i + 2]++;
    if (ok) return true;
  }
  return false;
}

export function isChiitoi(c) {
  return total(c) === 14 && c.filter((x) => x === 2).length === 7;
}

const YAOCHU = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
export function isKokushi(c) {
  if (total(c) !== 14) return false;
  let pair = false;
  for (const t of YAOCHU) {
    if (c[t] === 0) return false;
    if (c[t] === 2) pair = true;
  }
  return pair && YAOCHU.reduce((a, t) => a + c[t], 0) === 14;
}

export function isAgari(c, { chiitoi = true } = {}) {
  if (total(c) % 3 !== 2) return false;
  if (chiitoi && isKokushi(c)) return true;
  for (let p = 0; p < 34; p++) {
    if (c[p] >= 2) {
      c[p] -= 2;
      const ok = canMeld(c);
      c[p] += 2;
      if (ok) return true;
    }
  }
  return chiitoi && isChiitoi(c);
}

// 13장(또는 3n+1장) 손패의 대기패 목록. 손에 4장 다 있는 패는 대기에서 뺀다.
export function waits(c, opts) {
  const res = [];
  for (let t = 0; t < 34; t++) {
    if (c[t] >= 4) continue;
    c[t]++;
    if (isAgari(c, opts)) res.push(t);
    c[t]--;
  }
  return res;
}

// ---- 샹텐 (일반형) ----
const suitCache = new Map();

// 한 종류(수패 9칸) 안에서 가능한 [멘쯔, 타쯔, 머리] 조합 목록
function suitOptions(arr) {
  const key = arr.join('');
  if (suitCache.has(key)) return suitCache.get(key);
  const seen = new Set();
  const a = arr.slice();
  function dfs(i, m, t, p) {
    while (i < 9 && a[i] === 0) i++;
    if (i >= 9) { seen.add(`${m},${t},${p}`); return; }
    if (a[i] >= 3) { a[i] -= 3; dfs(i, m + 1, t, p); a[i] += 3; }
    if (i <= 6 && a[i + 1] && a[i + 2]) { a[i]--; a[i + 1]--; a[i + 2]--; dfs(i, m + 1, t, p); a[i]++; a[i + 1]++; a[i + 2]++; }
    if (a[i] >= 2) {
      a[i] -= 2;
      if (!p) dfs(i, m, t, 1);
      dfs(i, m, t + 1, p);
      a[i] += 2;
    }
    if (i <= 7 && a[i + 1]) { a[i]--; a[i + 1]--; dfs(i, m, t + 1, p); a[i]++; a[i + 1]++; }
    if (i <= 6 && a[i + 2]) { a[i]--; a[i + 2]--; dfs(i, m, t + 1, p); a[i]++; a[i + 2]++; }
    a[i]--; dfs(i + 1, m, t, p); a[i]++;
  }
  dfs(0, 0, 0, 0);
  const all = [...seen].map((s) => s.split(',').map(Number));
  // 같은 머리 여부에서 멘쯔·타쯔가 모두 적거나 같은 조합은 버린다 (샹텐을 낮출 수 없음)
  const opts = all.filter((o) => !all.some((q) => q !== o && q[2] === o[2]
    && q[0] >= o[0] && q[1] >= o[1] && (q[0] > o[0] || q[1] > o[1])));
  suitCache.set(key, opts);
  return opts;
}

function honorOptions(c) {
  // 자패는 커쯔·머리·고립만 가능. 머리를 쓰는 경우/안 쓰는 경우 두 가지
  let m = 0, pairs = 0;
  for (let t = 27; t < 34; t++) {
    if (c[t] >= 3) m++;
    else if (c[t] === 2) pairs++;
  }
  const opts = [[m, pairs, 0]];
  if (pairs > 0) opts.push([m, pairs - 1, 1]);
  return opts;
}

export function shantenNormal(c) {
  const parts = [
    suitOptions(c.slice(0, 9)),
    suitOptions(c.slice(9, 18)),
    suitOptions(c.slice(18, 27)),
    honorOptions(c),
  ];
  const blocks = Math.floor(total(c) / 3); // 필요한 멘쯔 수 (13장 → 4)
  let best = 8;
  for (const a of parts[0]) for (const b of parts[1]) for (const d of parts[2]) for (const e of parts[3]) {
    const p = a[2] + b[2] + d[2] + e[2];
    if (p > 1) continue;
    const m = a[0] + b[0] + d[0] + e[0];
    const t = a[1] + b[1] + d[1] + e[1];
    const s = 2 * blocks - 2 * m - Math.min(t, blocks - m) - p;
    if (s < best) best = s;
  }
  return best;
}

export function shantenChiitoi(c) {
  if (total(c) < 13) return 99;
  let pairs = 0, kinds = 0;
  for (let t = 0; t < 34; t++) {
    if (c[t] >= 1) kinds++;
    if (c[t] >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

export function shanten(c, { chiitoi = false } = {}) {
  const n = shantenNormal(c);
  return chiitoi ? Math.min(n, shantenChiitoi(c)) : n;
}

// 13장 손패의 유효패: 뽑으면 샹텐이 줄어드는 패와 남은 장수
export function acceptance(c, opts) {
  const s = shanten(c, opts);
  const tiles = [];
  let count = 0;
  for (let t = 0; t < 34; t++) {
    if (c[t] >= 4) continue;
    c[t]++;
    if (shanten(c, opts) < s) {
      tiles.push(t);
      count += 4 - (c[t] - 1);
    }
    c[t]--;
  }
  return { shanten: s, tiles, count };
}

// 14장 손패에서 버릴 수 있는 패마다 결과
export function discardAnalysis(c, opts) {
  const res = [];
  for (let t = 0; t < 34; t++) {
    if (!c[t]) continue;
    c[t]--;
    const a = acceptance(c, opts);
    c[t]++;
    res.push({ tile: t, ...a });
  }
  res.sort((x, y) => x.shanten - y.shanten || y.count - x.count || x.tile - y.tile);
  return res;
}

// ---- 무작위 손패 ----
export const randInt = (n) => Math.floor(Math.random() * n);
export const pick = (arr) => arr[randInt(arr.length)];
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// suits: 쓸 수패 종류 배열, honors: 자패 포함 여부
export function randomCompleteHand({ suits = ['m', 'p', 's'], honors = true } = {}) {
  for (let tries = 0; tries < 200; tries++) {
    const c = new Array(34).fill(0);
    const ok = (t, n) => c[t] + n <= 4;
    const pool = () => {
      const s = pick(suits);
      return { base: { m: 0, p: 9, s: 18 }[s] };
    };
    let good = true;
    for (let k = 0; k < 4 && good; k++) {
      let placed = false;
      for (let r = 0; r < 30 && !placed; r++) {
        const useHonor = honors && Math.random() < 0.15;
        if (useHonor) {
          const t = 27 + randInt(7);
          if (ok(t, 3)) { c[t] += 3; placed = true; }
          continue;
        }
        const { base } = pool();
        if (Math.random() < 0.3) {
          const t = base + randInt(9);
          if (ok(t, 3)) { c[t] += 3; placed = true; }
        } else {
          const t = base + randInt(7);
          if (ok(t, 1) && ok(t + 1, 1) && ok(t + 2, 1)) { c[t]++; c[t + 1]++; c[t + 2]++; placed = true; }
        }
      }
      if (!placed) good = false;
    }
    if (!good) continue;
    let paired = false;
    for (let r = 0; r < 30 && !paired; r++) {
      const t = honors && Math.random() < 0.2 ? 27 + randInt(7) : pool().base + randInt(9);
      if (ok(t, 2)) { c[t] += 2; paired = true; }
    }
    if (paired) return c;
  }
  throw new Error('손패 생성 실패');
}

// 텐파이 13장: 완성형에서 한 장을 뺀다
export function randomTenpai(opts) {
  const c = randomCompleteHand(opts);
  const list = toList(c);
  const removed = pick(list);
  c[removed]--;
  return c;
}

// 한 종류만으로 된 13장 텐파이 (청일색 대기 연습용)
export function randomChinitsuTenpai(suit = 'm', minWaits = 2) {
  const base = { m: 0, p: 9, s: 18 }[suit];
  for (let tries = 0; tries < 5000; tries++) {
    const c = new Array(34).fill(0);
    let n = 0;
    while (n < 13) {
      const t = base + randInt(9);
      if (c[t] < 4) { c[t]++; n++; }
    }
    const w = waits(c, { chiitoi: false });
    if (w.length >= minWaits) return c;
  }
  return null;
}

// 남은 장수(손패 기준) 셈
export function remaining(c, tiles) {
  return tiles.reduce((s, t) => s + (4 - c[t]), 0);
}
