// 패를 화면에 그리는 도우미
import { suitOf, numOf, tileName, toList } from './engine.js';

const SUIT_GLYPH = { m: '萬', p: '筒', s: '索' };
const HONOR_GLYPH = ['東', '南', '西', '北', '白', '發', '中'];

export function tileHTML(t, { button = false, cls = '', attrs = '' } = {}) {
  const s = suitOf(t);
  const inner = s === 'z'
    ? `<b aria-hidden="true">${t === 31 ? '' : HONOR_GLYPH[t - 27]}</b>`
    : `<b aria-hidden="true">${numOf(t)}</b><i aria-hidden="true">${SUIT_GLYPH[s]}</i>`;
  const klass = `tile t-${s}${s === 'z' ? ` h${t - 26}` : ''}${cls ? ` ${cls}` : ''}`;
  if (button) {
    return `<button type="button" class="${klass}" data-t="${t}" aria-label="${tileName(t)}" aria-pressed="false" ${attrs}>${inner}</button>`;
  }
  return `<span class="${klass}" role="img" aria-label="${tileName(t)}" ${attrs}>${inner}</span>`;
}

// 손패: 개수 배열이나 패 번호 배열. 종류가 바뀌는 곳에 작은 틈을 둔다.
export function handHTML(hand, { big = false, button = false, gaps = true, mark = [], extra = null } = {}) {
  const list = Array.isArray(hand) && hand.length === 34 && hand.every((x) => x <= 4) && hand.reduce((a, b) => a + b, 0) <= 18
    ? toList(hand)
    : hand;
  let html = '';
  let prev = null;
  list.forEach((t) => {
    const s = suitOf(t);
    if (gaps && prev !== null && s !== prev) html += '<span class="sp"></span>';
    prev = s;
    html += tileHTML(t, { button, cls: mark.includes(t) ? 'mark' : '' });
  });
  if (extra !== null) html += `<span class="sp"></span><span class="sp"></span>${tileHTML(extra)}`;
  return `<div class="hand${big ? ' big' : ''}">${html}</div>`;
}

export const tilesInline = (list) => `<span class="mini">${list.map((t) => tileHTML(t)).join('')}</span>`;
export const namesOf = (list) => list.map(tileName).join(' · ');
