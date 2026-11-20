import assert from 'node:assert/strict';
import { parse } from '../js/engine.js';
import { evaluateWin, payments, doraOf } from '../js/yaku.js';

const E = 27, S = 28;
function win(hand, winTile, extra = {}) {
  const closed = parse(hand);
  return evaluateWin({ closed, melds: [], winTile, tsumo: false, seatWind: S, roundWind: E, dora: [], ura: [], ...extra });
}
const t = (s) => parse(s).findIndex((n) => n > 0);
const names = (r) => r.yaku.map((y) => y.key).sort().join(',');
let n = 0;
function check(label, fn) { fn(); n++; }

check('리치 핑후 탕야오 30부 론', () => {
  const r = win('234m567p345678s55s', t('8s'), { riichi: true });
  assert.equal(names(r), 'pinfu,riichi,tanyao');
  assert.equal(r.fu, 30); assert.equal(r.han, 3);
});
check('핑후 쯔모 20부', () => {
  const r = win('234m567p345678s55s', t('8s'), { tsumo: true });
  assert.equal(r.fu, 20); assert.equal(names(r), 'pinfu,tanyao,tsumo');
});
check('간짱은 핑후 아님, 40부', () => {
  const r = win('234m567p345678s55s', t('7s'), { riichi: true });
  assert.ok(!names(r).includes('pinfu'));
  assert.equal(r.fu, 40);
});
check('울은 손 역 없음', () => {
  const closed = parse('567p345s678s11z');
  const r = evaluateWin({ closed, melds: [{ type: 'chi', tiles: [1, 2, 3] }], winTile: t('8s'), tsumo: false, seatWind: S, roundWind: E, dora: [], ura: [] });
  assert.equal(r.noYaku, true);
});
check('칠대자 25부', () => {
  const r = win('1199m2277p3366s55z', t('5z'), { riichi: true });
  assert.ok(names(r).includes('chiitoitsu')); assert.equal(r.fu, 25);
});
check('혼일색 울면 2판', () => {
  const closed = parse('123456m789m55z');
  const r = evaluateWin({ closed, melds: [{ type: 'pon', tiles: [31, 31, 31] }], winTile: t('9m'), tsumo: false, seatWind: S, roundWind: E, dora: [], ura: [] });
  assert.ok(names(r).includes('honitsu'));
  assert.equal(r.yaku.find((y) => y.key === 'honitsu').han, 2);
  assert.ok(names(r).includes('ittsu'));
});
check('청일색 3334555m 대기 6만 화료', () => {
  const closed = parse('3334555m6m123p456s');
  const r = evaluateWin({ closed, melds: [], winTile: t('6m'), tsumo: true, seatWind: S, roundWind: E, dora: [], ura: [] });
  assert.ok(r && !r.noYaku);
});
check('국사무쌍', () => {
  const r = win('19m19p19s12345677z', t('7z'));
  assert.equal(r.yakuman, 1);
});
check('스안커 쯔모', () => {
  const r = win('111m333p555s777s22z', t('7s'), { tsumo: true });
  assert.ok(names(r).includes('suuankou'));
});
check('샨폰 론은 스안커 아님(산안커+또이또이)', () => {
  const r = win('111m333p555s777s22z', t('7s'));
  assert.equal(r.yakuman, 0); assert.ok(names(r).includes('sanankou')); assert.ok(names(r).includes('toitoi'));
});
check('도라 표시패', () => {
  assert.equal(doraOf(8), 0); assert.equal(doraOf(30), 27); assert.equal(doraOf(33), 31); assert.equal(doraOf(4), 5);
});
check('점수: 자 30부 3판 론 3900', () => {
  const r = win('234m567p345678s55s', t('8s'), { riichi: true });
  const pay = payments({ base: r.base, winner: 1, loser: 2, dealer: 0 });
  assert.equal(pay[1], 3900);
});
check('점수: 오야 쯔모 2000올 + 1본장', () => {
  const pay = payments({ base: 30 * 2 ** 5, winner: 0, loser: null, dealer: 0, honba: 1 });
  assert.deepEqual(pay, [6300, -2100, -2100, -2100]);
});
check('역패 더블 동 머리 부수', () => {
  const r = win('234m567p345s678s11z', t('8s'), { riichi: true, seatWind: E });
  assert.equal(r.fu, 40); // 20 + 멘젠론10 + 연풍 머리 4 → 34 → 40
});
console.log(`yaku: ${n}개 통과`);
