// 가상의 사람(가중치를 아는 정책)을 앉혀 놓고
// 1) 모방 모델이 그 사람의 성향을 따라잡는지, 2) 강도 조절(δ)이 맞는 방향으로 움직이는지 본다.
import assert from 'node:assert/strict';
import { Game, mulberry32, kindOf } from '../js/game.js';
import { AIPlayer, analyzeDiscards, softmax, dot, sample, STRONG } from '../js/ai.js';
import { initModel, initMastery, updateModel, aiTheta, afterHand, afterGame, PRIOR_THETA } from '../js/ml.js';

const cos = (a, b) => dot(a, b) / Math.sqrt(dot(a, a) * dot(b, b));

class SimHuman extends AIPlayer {
  constructor(theta, profile, rng) { super({ rng }); this.theta = theta; this.profile = profile; }
  async chooseTurn(view, opt) {
    if (opt.tsumo && opt.tsumo.valid) return { type: 'tsumo' };
    if (view.riichi[view.seat]) return { type: 'discard', tile: kindOf(view.drawn) };
    const { cands } = analyzeDiscards(view, opt);
    const i = sample(softmax(cands.map((x) => dot(this.theta, x.phi))), this.rng);
    if (cands.length > 1) updateModel(this.profile.model, cands, i);
    return { type: 'discard', tile: cands[i].t, riichi: (opt.riichi || []).includes(cands[i].t) };
  }
}

async function run(label, humanTheta, games, startDelta) {
  const profile = { model: initModel(), mastery: initMastery(), delta: startDelta };
  const rng = mulberry32(42);
  const places = [];
  const deltas = [profile.delta];
  for (let g = 0; g < games; g++) {
    const human = new SimHuman(humanTheta, profile, rng);
    const ais = [1, 2, 3].map(() => new AIPlayer({ rng, weights: () => aiTheta(profile.model, profile.delta) }));
    let before;
    const game = new Game({
      players: [human, ...ais], seed: 300 + g,
      onEvent: (ev, gm) => {
        if (ev.type === 'handStart') before = gm.scores.slice();
        if (ev.type === 'handEnd') afterHand(profile, before, gm.scores);
      },
    });
    const res = await game.run();
    const place = res.order.indexOf(0) + 1;
    places.push(place);
    afterGame(profile, place);
    deltas.push(profile.delta);
  }
  const m = profile.model;
  const out = {
    label, decisions: m.n, agree: m.agree.toFixed(2),
    cosPrior: cos(PRIOR_THETA, humanTheta).toFixed(3), cosLearned: cos(m.theta, humanTheta).toFixed(3),
    avgPlace: (places.reduce((a, b) => a + b, 0) / places.length).toFixed(2),
    deltaStart: startDelta, deltaEnd: profile.delta.toFixed(2),
  };
  console.log(JSON.stringify(out));
  return { out, profile, deltas };
}

const games = Number(process.argv[2] || 30);
// 유효패를 거의 안 세고, 수비를 안 하고, 자패부터 버리는 사람
const sloppy = [3.0, 0.2, 0.0, 0.0, 0.3, 0.1, 1.5, 1.2, 0.6, 0.1];
// 강한 기준에 가까운 사람
const sharp = STRONG.map((w) => w * 3);

const a = await run('허술한 사람', sloppy, games, 0.25);
const b = await run('강한 사람', sharp, games, 0.25);
assert.ok(Number(a.out.cosLearned) > Number(a.out.cosPrior), '허술한 사람의 성향 쪽으로 학습해야 한다');
assert.ok(Number(a.out.deltaEnd) < Number(b.out.deltaEnd), '허술한 사람 상대로는 AI가 더 약해져야 한다');
console.log('ml 테스트 통과');
