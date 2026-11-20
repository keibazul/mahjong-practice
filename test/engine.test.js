import assert from 'node:assert/strict';
import {
  parse, waits, tileName, discardAnalysis, shanten, acceptance, toString,
  randomCompleteHand, randomTenpai, randomChinitsuTenpai, isAgari, toList,
} from '../js/engine.js';
import { points, basePoints } from '../js/score.js';

const names = (ts) => ts.map(tileName).join(',');
let n = 0;
const ok = (label, fn) => { fn(); n++; console.log('ok', label); };

ok('대기 3456888삭', () => assert.equal(names(waits(parse('234m567p3456888s'))), '3삭,6삭,7삭'));
ok('대기 3334555만', () => assert.equal(names(waits(parse('3334555m123p456s'))), '2만,3만,4만,5만,6만'));
ok('대기 4·7만 양면', () => assert.equal(names(waits(parse('56m123p456p789s11z'))), '4만,7만'));
ok('칠대자 대기', () => assert.equal(names(waits(parse('1133m5577p99s114z'))), '북'));
ok('화료 판정', () => {
  assert.equal(isAgari(parse('234m567p345678s88s')), true);
  assert.equal(isAgari(parse('234m567p345678s89s')), false);
});

ok('패효율 2468통', () => {
  const r = discardAnalysis(parse('23m456m2468p789s99s'));
  const top = r.filter((x) => x.shanten === r[0].shanten && x.count === r[0].count).map((x) => tileName(x.tile));
  assert.deepEqual(top.sort(), ['2통', '8통']);
  assert.equal(r[0].count, 19);
  assert.equal(r.find((x) => tileName(x.tile) === '6통').count, 15);
});

ok('텐파이 잡기 삼면장', () => {
  const r = discardAnalysis(parse('123m4566p78p234s55s'));
  assert.equal(tileName(r[0].tile), '6통');
  assert.equal(r[0].shanten, 0);
  assert.equal(r[0].count, 11);
});

ok('샹텐 기본', () => {
  assert.equal(shanten(parse('123m456p789s1122z')), 0);
  assert.equal(shanten(parse('19m19p19s1234567z')), 8);
  assert.equal(acceptance(parse('23m456m468p789s99s')).count, 19);
});

ok('점수표', () => {
  const p = (fu, han, dealer, tsumo = false) => points({ fu, han, dealer, tsumo }).label;
  assert.equal(p(30, 3, false), '3,900');
  assert.equal(p(40, 3, false), '5,200');
  assert.equal(p(30, 4, false), '7,700');
  assert.equal(p(40, 4, false), '8,000');
  assert.equal(p(30, 4, true), '11,600');
  assert.equal(p(30, 1, true), '1,500');
  assert.equal(p(20, 2, false, true), '400 / 700');
  assert.equal(p(20, 2, true, true), '700 올');
  assert.equal(p(30, 3, false, true), '1,000 / 2,000');
  assert.equal(p(25, 2, false), '1,600');
  assert.equal(p(0, 6, false), '12,000');
  assert.equal(p(0, 13, true), '48,000');
  assert.equal(basePoints(70, 3), 2000);
});

ok('무작위 손패 생성 1000회', () => {
  for (let i = 0; i < 1000; i++) {
    const c = randomCompleteHand();
    assert.equal(c.reduce((a, b) => a + b, 0), 14);
    assert.ok(c.every((x) => x <= 4));
    assert.equal(isAgari(c), true, toString(c));
    const t = randomTenpai();
    assert.ok(waits(t).length > 0);
    assert.equal(shanten(t), 0, toString(t));
  }
});

ok('청일색 텐파이 생성', () => {
  for (let i = 0; i < 50; i++) {
    const c = randomChinitsuTenpai('p', 3);
    assert.ok(c && waits(c, { chiitoi: false }).length >= 3);
    assert.ok(toList(c).every((t) => t >= 9 && t < 18));
  }
});

console.log(`\n${n}개 통과`);
