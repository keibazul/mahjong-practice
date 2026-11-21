// 퀴즈 문제가 모든 종류에서 만들어지고, 정답이 실제로 맞는지 확인한다
import assert from 'node:assert/strict';
import { harvest, buildQuestions, planCategories, needFor, CATS } from '../js/quiz.js';
import { mulberry32 } from '../js/game.js';
import { waits, parse } from '../js/engine.js';

const rng = mulberry32(7);
const t0 = Date.now();
const plan = Object.keys(CATS).flatMap((k) => [k, k]);
const pool = await harvest(needFor(plan), { seed: 1234, maxGames: 6 });
const ms = Date.now() - t0;
console.log('모은 장면', Object.fromEntries(Object.entries(pool).map(([k, v]) => [k, v.length])), `${ms}ms`);
const qs = buildQuestions(plan, pool, { showFu: true, rng });
assert.equal(qs.length, plan.length);
const byCat = {};
for (const q of qs) {
  byCat[q.cat] = (byCat[q.cat] || 0) + 1;
  if (q.kind === 'choice') assert.ok(q.choices.includes(q.answer), `${q.cat} 보기에 정답이 없다`);
  if (q.kind === 'tile') {
    assert.ok(q.answerTiles.length >= 1);
    for (const t of q.answerTiles) assert.ok(q.judge(t));
  }
  if (q.kind === 'tiles') {
    const c = new Array(34).fill(0);
    for (const k of q.hand) c[k] += 1;
    assert.deepEqual(waits(c), q.answerSet);
  }
}
console.log('종류별 문제 수', byCat);
for (const k of Object.keys(CATS)) assert.ok(byCat[k] >= 1, `${k} 문제가 없다`);
const mix = planCategories('mix', { scoring: 1, han: 0.1, efficiency: 0.1, defense: 0.1, waits: 0.1, furiten: 0.1 }, 200, rng);
assert.ok(mix.filter((c) => c === 'scoring').length > 80, '약한 기술이 더 자주 나와야 한다');
console.log('퀴즈 테스트 통과');
