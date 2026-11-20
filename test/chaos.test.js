// 무작위로 합법 행동을 고르는 선수로 엔진의 구석 경우를 두드린다
import assert from 'node:assert/strict';
import { Game, mulberry32, kindOf, countsOf } from '../js/game.js';

class Chaos {
  constructor(rng) { this.rng = rng; }
  async chooseTurn(view, opt) {
    const r = this.rng();
    if (opt.tsumo && r < 0.7) return { type: 'tsumo' };
    if (opt.ankan.length && r < 0.5) return { type: 'ankan', kind: opt.ankan[0] };
    if (opt.kakan.length && r < 0.5) return { type: 'kakan', kind: opt.kakan[0] };
    if (opt.mustTsumogiri) return { type: 'discard', tile: kindOf(view.drawn) };
    const c = countsOf(view.hand);
    const kinds = [];
    c.forEach((n, t) => { if (n && !opt.forbidden.includes(t)) kinds.push(t); });
    if (opt.riichi.length && this.rng() < 0.6) return { type: 'discard', tile: opt.riichi[Math.floor(this.rng() * opt.riichi.length)], riichi: true };
    return { type: 'discard', tile: kinds[Math.floor(this.rng() * kinds.length)] };
  }
  async chooseCall(view, opt) {
    const r = this.rng();
    if (opt.ron) return r < 0.8 ? { type: 'ron' } : { type: 'pass' };
    if (opt.minkan && r < 0.3) return { type: 'minkan' };
    if (opt.pon && r < 0.5) return { type: 'pon' };
    if (opt.chi.length && r < 0.5) return { type: 'chi', use: opt.chi[0] };
    return { type: 'pass' };
  }
}

const games = Number(process.argv[2] || 200);
const ev = {};
for (let g = 0; g < games; g++) {
  const rng = mulberry32(77 + g);
  const game = new Game({
    players: [0, 1, 2, 3].map(() => new Chaos(rng)), seed: 999 + g,
    onEvent: (e, gm) => {
      ev[e.type] = (ev[e.type] || 0) + 1;
      if (e.type === 'falseWin') ev[`false:${e.reason}`] = (ev[`false:${e.reason}`] || 0) + 1;
      const sum = gm.scores.reduce((a, b) => a + b, 0) + gm.sticks * 1000;
      assert.equal(sum, 100000);
      if (gm.h) {
        const all = [...gm.h.wall, ...gm.h.hands.flat(), ...gm.h.discards.flat().filter((d) => !d.called).map((d) => d.tile),
          ...gm.h.melds.flat().flatMap((m) => m.tiles), ...gm.h.dead.slice(gm.h.rinshanUsed)];
        if (e.type !== 'win' && e.type !== 'kan') assert.equal(new Set(all).size + gm.h.kanCount, 136 + 0 * 1, `패 수 불일치 ${e.type}`);
      }
    },
  });
  await game.run();
}
console.log(`chaos ${games}게임 통과`, ev);
