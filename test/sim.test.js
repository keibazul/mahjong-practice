// AI끼리 자동 대국을 돌려 진행 오류와 점수 보존을 확인한다
import assert from 'node:assert/strict';
import { Game, mulberry32 } from '../js/game.js';
import { AIPlayer, STRONG } from '../js/ai.js';

const games = Number(process.argv[2] || 30);
const stats = { hands: 0, wins: 0, tsumo: 0, draws: 0, riichi: 0, calls: 0, kans: 0, yaku: {}, falseWin: 0 };
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  const rng = mulberry32(1000 + g);
  const players = [0, 1, 2, 3].map((i) => new AIPlayer({ rng, weights: () => STRONG.map((w) => w * (i === 0 ? 3 : 1.5)) }));
  const game = new Game({
    players, seed: 5000 + g, rules: { rounds: g % 3 === 0 ? 2 : 1 },
    onEvent: (ev, gm) => {
      const sum = gm.scores.reduce((a, b) => a + b, 0) + gm.sticks * 1000;
      assert.equal(sum, 100000, `점수 보존 실패: ${ev.type}`);
      if (ev.type === 'handStart') stats.hands++;
      if (ev.type === 'riichiPaid') stats.riichi++;
      if (ev.type === 'call') stats.calls++;
      if (ev.type === 'kan') stats.kans++;
      if (ev.type === 'falseWin') stats.falseWin++;
      if (ev.type === 'exhaustive') stats.draws++;
      if (ev.type === 'win') {
        stats.wins++;
        if (ev.win.loser === null) stats.tsumo++;
        for (const y of ev.win.result.yaku) stats.yaku[y.key] = (stats.yaku[y.key] || 0) + 1;
        assert.ok(!ev.win.result.noYaku);
      }
    },
  });
  const res = await game.run();
  assert.equal(res.scores.reduce((a, b) => a + b, 0), 100000);
}
const ms = Date.now() - t0;
console.log(`games ${games}, hands ${stats.hands}, ${Math.round(ms / stats.hands)}ms/hand`);
console.log(`win ${(stats.wins / stats.hands * 100).toFixed(1)}% (tsumo ${stats.tsumo}), draw ${(stats.draws / stats.hands * 100).toFixed(1)}%, riichi/hand ${(stats.riichi / stats.hands).toFixed(2)}, calls/hand ${(stats.calls / stats.hands).toFixed(2)}, kans ${stats.kans}, falseWin ${stats.falseWin}`);
console.log(Object.entries(stats.yaku).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
