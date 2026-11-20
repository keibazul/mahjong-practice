// 패 그림: 34종을 SVG 심볼로 한 번 정의하고, 패마다 <use>로 불러 쓴다.
// 통수는 동그라미, 삭수는 대나무(1삭은 새), 만수·자패는 글자 도안.
import { suitOf, tileName } from './engine.js';

const B = '#1F5FA8'; // 파랑
const G = '#1C7A4C'; // 초록
const R = '#C62D3A'; // 빨강
const K = '#1B1B1B'; // 먹
const GOLD = '#C99A1E';
const FONT = "'Noto Serif KR','Noto Serif CJK KR','Songti SC','Batang',serif";

const f1 = (n) => Math.round(n * 100) / 100;

// 통수의 동그라미 하나
function dot(cx, cy, r, c) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${f1(r * 0.62)}" fill="none" stroke="#fff" stroke-width="${f1(r * 0.2)}"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${f1(r * 0.2)}" fill="#fff"/>`;
}

// 삭수의 대나무 막대 하나
function stick(cx, cy, h, c, angle = 0) {
  const w = 3.8;
  const x = f1(cx - w / 2);
  const y = f1(cy - h / 2);
  const rot = angle ? ` transform="rotate(${angle} ${cx} ${cy})"` : '';
  return `<g${rot}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.7" fill="${c}"/>`
    + `<line x1="${f1(cx - 1.9)}" x2="${f1(cx + 1.9)}" y1="${cy}" y2="${cy}" stroke="#fff" stroke-width="0.8"/>`
    + `<line x1="${cx}" x2="${cx}" y1="${f1(y + 1.6)}" y2="${f1(y + h - 1.6)}" stroke="#fff" stroke-opacity="0.35" stroke-width="0.6"/></g>`;
}

const PIN = {
  1: () => [12, 10, 8, 5.5, 3.6, 1.4].map((r, i) => `<circle cx="15" cy="20" r="${r}" fill="${[G, '#fff', R, '#fff', B, '#fff'][i]}"/>`).join(''),
  2: () => dot(15, 10.5, 6.5, B) + dot(15, 29.5, 6.5, G),
  3: () => dot(7.5, 9, 5.5, B) + dot(15, 20, 5.5, R) + dot(22.5, 31, 5.5, G),
  4: () => dot(8.5, 11, 5.5, B) + dot(21.5, 11, 5.5, G) + dot(8.5, 29, 5.5, G) + dot(21.5, 29, 5.5, B),
  5: () => dot(8, 9.5, 5, B) + dot(22, 9.5, 5, G) + dot(8, 30.5, 5, G) + dot(22, 30.5, 5, B) + dot(15, 20, 5, R),
  6: () => dot(9, 8, 4.8, G) + dot(21, 8, 4.8, G) + [21, 32].map((y) => dot(9, y, 4.8, R) + dot(21, y, 4.8, R)).join(''),
  7: () => dot(6.5, 6, 4, G) + dot(15, 9.5, 4, G) + dot(23.5, 13, 4, G) + [24, 33.5].map((y) => dot(9, y, 4.4, R) + dot(21, y, 4.4, R)).join(''),
  8: () => [6.5, 15.5, 24.5, 33.5].map((y) => dot(9, y, 4.3, B) + dot(21, y, 4.3, B)).join(''),
  9: () => [[8, B], [20, R], [32, G]].map(([y, c]) => [6.5, 15, 23.5].map((x) => dot(x, y, 4.3, c)).join('')).join(''),
};

const BIRD = `<path d="M21 21 L28 11 L27 18 L29.5 15 L26.5 27 Z" fill="${G}"/>`
  + `<ellipse cx="14" cy="22" rx="8.5" ry="6.5" fill="${G}"/>`
  + `<path d="M9 21 Q14 15 21 19 Q15 20 11 25 Z" fill="#0F5234"/>`
  + `<circle cx="8.5" cy="13.5" r="4.3" fill="${G}"/>`
  + `<path d="M5 9.5 L7 6 L8.5 9.3 L10.5 6.3 L11 10 Z" fill="${R}"/>`
  + `<circle cx="7.4" cy="12.8" r="1.1" fill="#fff"/><circle cx="7.2" cy="12.9" r="0.55" fill="${K}"/>`
  + `<path d="M4.5 13.2 L1.2 14.6 L4.6 15.6 Z" fill="${GOLD}"/>`
  + `<path d="M12 28 L11 35 M16.5 28 L17.5 35 M9 35 H13 M15.5 35 H19.5" stroke="${R}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`;

const SOU = {
  1: () => BIRD,
  2: () => stick(15, 11, 13, G) + stick(15, 29, 13, G),
  3: () => stick(15, 11, 12, G) + stick(9, 29, 12, G) + stick(21, 29, 12, G),
  4: () => [11, 29].map((y) => stick(9, y, 13, G) + stick(21, y, 13, G)).join(''),
  5: () => [11, 29].map((y) => stick(7.5, y, 12, G) + stick(22.5, y, 12, G)).join('') + stick(15, 20, 12, R),
  6: () => [11, 29].map((y) => [7, 15, 23].map((x) => stick(x, y, 13, G)).join('')).join(''),
  7: () => stick(15, 7, 9, R) + [20, 32].map((y) => [7, 15, 23].map((x) => stick(x, y, 9, G)).join('')).join(''),
  8: () => stick(5, 11, 13, G) + stick(11.7, 11, 13, G, 22) + stick(18.3, 11, 13, G, -22) + stick(25, 11, 13, G)
    + stick(5, 29, 13, G) + stick(11.7, 29, 13, G, -22) + stick(18.3, 29, 13, G, 22) + stick(25, 29, 13, G),
  9: () => [7.5, 20, 32.5].map((y) => stick(7, y, 10, G) + stick(15, y, 10, R) + stick(23, y, 10, G)).join(''),
};

const NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const text = (s, x, y, size, color) => `<text x="${x}" y="${y}" font-size="${size}" font-family="${FONT}" font-weight="700" text-anchor="middle" fill="${color}">${s}</text>`;
const MAN = (n) => text(NUM[n - 1], 15, 17, 15, K) + text('萬', 15, 36.5, 16.5, R);

const HONOR = [
  () => text('東', 15, 28, 22, K),
  () => text('南', 15, 28, 22, K),
  () => text('西', 15, 28, 22, K),
  () => text('北', 15, 28, 22, K),
  () => `<rect x="5" y="6" width="20" height="28" rx="2" fill="none" stroke="${B}" stroke-width="2.2"/>`
    + `<rect x="8.2" y="9.2" width="13.6" height="21.6" rx="1" fill="none" stroke="${B}" stroke-width="0.8"/>`
    + [[5, 6], [25, 6], [5, 34], [25, 34]].map(([x, y]) => `<rect x="${x - 2}" y="${y - 2}" width="4" height="4" fill="${B}"/>`).join(''),
  () => text('發', 15, 28, 22, G),
  () => text('中', 15, 28, 22, R),
];

export function tileArt(t) {
  if (t < 9) return MAN(t + 1);
  if (t < 18) return PIN[t - 8]();
  if (t < 27) return SOU[t - 17]();
  return HONOR[t - 27]();
}

// 페이지에 심볼 묶음을 한 번 넣는다
function ensureSprite() {
  if (typeof document === 'undefined' || document.getElementById('mj-sprite')) return;
  const symbols = Array.from({ length: 34 }, (_, t) => `<symbol id="mj${t}" viewBox="0 0 30 40">${tileArt(t)}</symbol>`).join('');
  const holder = document.createElement('div');
  holder.innerHTML = `<svg id="mj-sprite" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">${symbols}</svg>`;
  document.body.prepend(holder.firstChild);
}
ensureSprite();

export function tileHTML(t, { button = false, cls = '', attrs = '' } = {}) {
  const s = suitOf(t);
  const inner = `<svg viewBox="0 0 30 40" aria-hidden="true" focusable="false"><use href="#mj${t}"/></svg>`;
  const klass = `tile t-${s}${cls ? ` ${cls}` : ''}`;
  if (button) {
    return `<button type="button" class="${klass}" data-t="${t}" aria-label="${tileName(t)}" aria-pressed="false" ${attrs}>${inner}</button>`;
  }
  return `<span class="${klass}" role="img" aria-label="${tileName(t)}" ${attrs}>${inner}</span>`;
}
