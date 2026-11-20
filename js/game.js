// 4인 리치 마작 진행. 화면과 AI는 players[i]의 비동기 메서드로 결정을 돌려준다.
//   players[i].chooseTurn(view, options) → {type:'discard', tile, riichi} | {type:'tsumo'} | {type:'ankan', kind} | {type:'kakan', kind}
//   players[i].chooseCall(view, options) → {type:'pass'|'ron'|'pon'|'minkan'} | {type:'chi', use:[종류, 종류]}
// 패는 0~135 번호(같은 종류 4장), 종류는 번호 >> 2.
import { waits as waitsOf, isAgari } from './engine.js';
import { evaluateWin, payments } from './yaku.js';

export const kindOf = (id) => id >> 2;
export const WIND_KO = ['동', '남', '서', '북'];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function countsOf(ids) {
  const c = new Array(34).fill(0);
  for (const id of ids) c[id >> 2] += 1;
  return c;
}

const DEFAULT_RULES = { rounds: 1, startScore: 25000, agariYame: true, wallCandidates: 1 };

export class Game {
  constructor({ players, rules = {}, seed = Date.now(), onEvent = null, dealShaper = null, firstDealer = null }) {
    this.players = players;
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.rng = mulberry32(seed);
    this.onEvent = onEvent;
    this.dealShaper = dealShaper;
    this.scores = [0, 1, 2, 3].map(() => this.rules.startScore);
    this.firstDealer = firstDealer ?? Math.floor(this.rng() * 4);
    this.dealer = this.firstDealer;
    this.roundWindIdx = 0; // 0 동장, 1 남장
    this.handNo = 0; // 그 장의 몇 국째 (0~3)
    this.honba = 0;
    this.sticks = 0;
    this.over = false;
    this.log = [];
  }

  // 국이 시작할 때의 상태 (이어하기용)
  snapshot() {
    const { scores, dealer, roundWindIdx, handNo, honba, sticks, firstDealer, rules } = this;
    return { scores: scores.slice(), dealer, roundWindIdx, handNo, honba, sticks, firstDealer, rules: { ...rules } };
  }

  restore(s) {
    this.scores = s.scores.slice();
    Object.assign(this, { dealer: s.dealer, roundWindIdx: s.roundWindIdx, handNo: s.handNo, honba: s.honba, sticks: s.sticks, firstDealer: s.firstDealer });
    this.rules = { ...this.rules, ...s.rules };
  }

  async emit(type, data = {}) {
    const ev = { ...data, type };
    this.log.push(type);
    if (this.onEvent) await this.onEvent(ev, this);
  }

  // ---------- 보기 ----------
  seatWind(seat) { return 27 + ((seat - this.dealer + 4) % 4); }
  roundWind() { return 27 + this.roundWindIdx; }
  doraIndicators() { return this.h.dead.slice(4, 4 + this.h.doraCount).map(kindOf); }
  uraIndicators() { return this.h.dead.slice(9, 9 + this.h.doraCount).map(kindOf); }

  view(seat) {
    const h = this.h;
    return {
      seat,
      hand: h.hands[seat].slice(),
      drawn: h.drawn[seat],
      melds: h.melds.map((m) => m.map((x) => ({ ...x, tiles: x.tiles.slice() }))),
      discards: h.discards.map((d) => d.map((x) => ({ ...x }))),
      riichi: h.riichi.slice(),
      riichiAt: h.riichiAt.slice(),
      scores: this.scores.slice(),
      dora: this.doraIndicators(),
      wallLeft: h.wall.length,
      dealer: this.dealer,
      seatWinds: [0, 1, 2, 3].map((s) => this.seatWind(s)),
      roundWind: this.roundWind(),
      roundWindIdx: this.roundWindIdx,
      handNo: this.handNo,
      honba: this.honba,
      sticks: this.sticks,
      turn: h.turn,
      furiten: this.furitenInfo(seat),
    };
  }

  furitenInfo(seat) {
    const h = this.h;
    const w = waitsOf(countsOf(h.hands[seat]));
    const own = new Set(h.discards[seat].map((d) => kindOf(d.tile)));
    return {
      waits: w,
      byDiscard: w.some((t) => own.has(t)),
      temp: h.tempFuriten[seat],
      riichi: h.riichiFuriten[seat],
    };
  }

  // ---------- 국 준비 ----------
  makeWall() {
    const ids = Array.from({ length: 136 }, (_, i) => i);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids;
  }

  // 배패 순서대로 나눠 줄 때 각자가 받을 13장
  static dealPreview(wall, dealer) {
    const hands = [[], [], [], []];
    let k = 0;
    for (let r = 0; r < 13; r++) for (let i = 0; i < 4; i++) hands[(dealer + i) % 4].push(wall[k++]);
    return hands;
  }

  setupHand() {
    let wall = this.makeWall();
    const n = this.rules.wallCandidates;
    if (this.dealShaper && n > 1) {
      const cands = [wall];
      for (let i = 1; i < n; i++) cands.push(this.makeWall());
      const idx = this.dealShaper(cands.map((w) => Game.dealPreview(w, this.dealer)), this);
      wall = cands[Math.max(0, Math.min(cands.length - 1, idx | 0))];
    }
    const hands = Game.dealPreview(wall, this.dealer);
    const live = wall.slice(52, 136 - 14);
    const dead = wall.slice(136 - 14);
    this.h = {
      hands,
      wall: live,
      dead,
      doraCount: 1,
      rinshanUsed: 0,
      kanCount: 0,
      melds: [[], [], [], []],
      discards: [[], [], [], []],
      riichi: [false, false, false, false],
      riichiAt: [-1, -1, -1, -1],
      doubleRiichi: [false, false, false, false],
      ippatsu: [false, false, false, false],
      tempFuriten: [false, false, false, false],
      riichiFuriten: [false, false, false, false],
      drawn: [null, null, null, null],
      anyCall: false,
      firstTurnDone: [false, false, false, false],
      turn: 0,
    };
  }

  // ---------- 판정 도우미 ----------
  winContext(seat, winTile, { tsumo, rinshan = false, closedIds }) {
    const h = this.h;
    const closed = countsOf(closedIds);
    return {
      closed,
      melds: h.melds[seat].map((m) => ({ type: m.type, tiles: m.tiles.map(kindOf) })),
      winTile,
      tsumo,
      seatWind: this.seatWind(seat),
      roundWind: this.roundWind(),
      riichi: h.riichi[seat],
      doubleRiichi: h.doubleRiichi[seat],
      ippatsu: h.ippatsu[seat],
      haitei: tsumo && !rinshan && h.wall.length === 0,
      houtei: !tsumo && h.wall.length === 0,
      rinshan,
      dora: this.doraIndicators(),
      ura: this.uraIndicators(),
    };
  }

  // 화료 형태인지와 실제로 화료할 수 있는지(역·후리텐)를 함께 돌려준다
  checkTsumo(seat, rinshan) {
    const ids = this.h.hands[seat];
    if (!isAgari(countsOf(ids))) return null;
    const tile = kindOf(this.h.drawn[seat]);
    const r = evaluateWin(this.winContext(seat, tile, { tsumo: true, rinshan, closedIds: ids }));
    if (!r) return null;
    return { valid: !r.noYaku, reason: r.noYaku ? 'noYaku' : null, result: r };
  }

  checkRon(seat, tileId) {
    const ids = [...this.h.hands[seat], tileId];
    if (!isAgari(countsOf(ids))) return null;
    const tile = kindOf(tileId);
    const r = evaluateWin(this.winContext(seat, tile, { tsumo: false, closedIds: ids }));
    if (!r) return null;
    const f = this.furitenInfo(seat);
    let reason = null;
    if (f.byDiscard) reason = 'furitenDiscard';
    else if (f.riichi) reason = 'furitenRiichi';
    else if (f.temp) reason = 'furitenTemp';
    else if (r.noYaku) reason = 'noYaku';
    return { valid: !reason, reason, result: r };
  }

  isTenpai(seat) {
    return waitsOf(countsOf(this.h.hands[seat])).length > 0;
  }

  // 리치 가능한 타패 종류
  riichiDiscards(seat) {
    const h = this.h;
    if (h.riichi[seat] || this.scores[seat] < 1000 || h.wall.length < 4) return [];
    if (h.melds[seat].some((m) => m.type !== 'ankan')) return [];
    const c = countsOf(h.hands[seat]);
    const out = [];
    for (let t = 0; t < 34; t++) {
      if (!c[t]) continue;
      c[t]--;
      if (waitsOf(c).length) out.push(t);
      c[t]++;
    }
    return out;
  }

  turnOptions(seat, { afterCall, rinshan, forbidden }) {
    const h = this.h;
    const c = countsOf(h.hands[seat]);
    const opt = { tsumo: null, riichi: [], ankan: [], kakan: [], forbidden: forbidden || [], mustTsumogiri: false };
    if (!afterCall) {
      opt.tsumo = this.checkTsumo(seat, rinshan);
      opt.riichi = this.riichiDiscards(seat);
      if (h.kanCount < 4 && h.wall.length > 0) {
        if (!h.riichi[seat]) {
          for (let t = 0; t < 34; t++) if (c[t] === 4) opt.ankan.push(t);
          for (const m of h.melds[seat]) if (m.type === 'pon' && c[kindOf(m.tiles[0])] >= 1) opt.kakan.push(kindOf(m.tiles[0]));
        }
      }
    }
    if (h.riichi[seat]) opt.mustTsumogiri = true;
    return opt;
  }

  callOptions(seat, from, tileId) {
    const h = this.h;
    const t = kindOf(tileId);
    const c = countsOf(h.hands[seat]);
    const opt = { ron: this.checkRon(seat, tileId), pon: false, minkan: false, chi: [], tile: tileId, from };
    const lastTile = h.wall.length === 0;
    if (!h.riichi[seat] && !lastTile) {
      if (c[t] >= 2) opt.pon = true;
      if (c[t] >= 3 && h.kanCount < 4) opt.minkan = true;
      if ((from + 1) % 4 === seat && t < 27) {
        const n = t % 9;
        const tryPair = (a, b) => {
          if (a < 0 || b > 8) return;
          const ta = t - n + a;
          const tb = t - n + b;
          if (c[ta] && c[tb]) opt.chi.push([ta, tb]);
        };
        tryPair(n - 2, n - 1);
        tryPair(n - 1, n + 1);
        tryPair(n + 1, n + 2);
      }
    }
    // 울고 나서 버릴 패가 하나도 없으면(쿠이카에) 그 울음은 못 한다
    if (opt.pon) {
      const rest = c.slice(); rest[t] -= 2;
      if (rest.every((n, k) => n === 0 || k === t)) opt.pon = false;
    }
    opt.chi = opt.chi.filter((pair) => {
      const rest = c.slice(); rest[pair[0]]--; rest[pair[1]]--;
      const forb = kuikae(t, pair);
      return rest.some((n, k) => n > 0 && !forb.includes(k));
    });
    const any = opt.ron || opt.pon || opt.minkan || opt.chi.length;
    return any ? opt : null;
  }

  // ---------- 진행 ----------
  takeTile(seat, kind) {
    const hand = this.h.hands[seat];
    const i = hand.findIndex((id) => kindOf(id) === kind);
    if (i < 0) throw new Error(`손에 없는 패: ${kind}`);
    return hand.splice(i, 1)[0];
  }

  revealDora() {
    if (this.h.doraCount < 5) this.h.doraCount += 1;
  }

  drawRinshan(seat) {
    const h = this.h;
    const id = h.dead[h.rinshanUsed];
    h.rinshanUsed += 1;
    h.wall.pop(); // 왕패를 14장으로 유지
    h.hands[seat].push(id);
    h.drawn[seat] = id;
    return id;
  }

  async run() {
    await this.emit('gameStart');
    while (!this.over) {
      await this.playHand();
    }
    const result = this.finalResult();
    await this.emit('gameEnd', { result });
    return result;
  }

  finalResult() {
    if (this.sticks) {
      const top = this.ranking()[0];
      this.scores[top] += this.sticks * 1000;
      this.sticks = 0;
    }
    const order = this.ranking();
    return { scores: this.scores.slice(), order, place: order.map((_, i) => i) };
  }

  ranking() {
    const seats = [0, 1, 2, 3];
    const dist = (s) => (s - this.firstDealer + 4) % 4;
    return seats.sort((a, b) => this.scores[b] - this.scores[a] || dist(a) - dist(b));
  }

  placeOf(seat) { return this.ranking().indexOf(seat) + 1; }

  async playHand() {
    this.setupHand();
    const h = this.h;
    await this.emit('handStart');
    let cur = this.dealer;
    let needDraw = true;
    let afterCall = false;
    let rinshan = false;
    let forbidden = [];

    for (;;) {
      if (needDraw) {
        if (h.wall.length === 0) return this.exhaustiveDraw();
        const id = h.wall.shift();
        h.hands[cur].push(id);
        h.drawn[cur] = id;
        h.tempFuriten[cur] = false;
        rinshan = false;
        await this.emit('draw', { seat: cur, tile: id });
      }
      h.turn += 1;

      const opt = this.turnOptions(cur, { afterCall, rinshan, forbidden });
      const act = await this.players[cur].chooseTurn(this.view(cur), opt);

      if (act.type === 'tsumo') {
        if (opt.tsumo && opt.tsumo.valid) return this.resolveWin(cur, null, opt.tsumo.result, h.drawn[cur]);
        await this.emit('falseWin', { seat: cur, kind: 'tsumo', reason: opt.tsumo ? opt.tsumo.reason : 'notAgari' });
        h.turn -= 1;
        // 잘못된 선언은 취소하고 같은 차례를 다시 묻는다 (연습용)
        needDraw = false;
        continue;
      }

      if (act.type === 'ankan' || act.type === 'kakan') {
        const k = act.kind;
        if (act.type === 'ankan') {
          const tiles = [0, 1, 2, 3].map(() => this.takeTile(cur, k));
          h.melds[cur].push({ type: 'ankan', tiles, from: cur });
        } else {
          const m = h.melds[cur].find((x) => x.type === 'pon' && kindOf(x.tiles[0]) === k);
          m.tiles.push(this.takeTile(cur, k));
          m.type = 'kakan';
        }
        h.kanCount += 1;
        h.anyCall = true;
        h.ippatsu = [false, false, false, false];
        this.revealDora();
        await this.emit('kan', { seat: cur, kind: k, kanType: act.type });
        const id = this.drawRinshan(cur);
        await this.emit('draw', { seat: cur, tile: id, rinshan: true });
        needDraw = false;
        afterCall = false;
        rinshan = true;
        forbidden = [];
        continue;
      }

      // 타패
      const kind = act.tile;
      if (forbidden.includes(kind)) throw new Error('쿠이카에 금지패');
      let tileId;
      if (opt.mustTsumogiri) tileId = h.drawn[cur];
      else if (h.drawn[cur] !== null && kindOf(h.drawn[cur]) === kind && !afterCall) tileId = h.drawn[cur];
      else tileId = null;
      if (tileId !== null) h.hands[cur].splice(h.hands[cur].indexOf(tileId), 1);
      else tileId = this.takeTile(cur, kind);

      const wasRiichi = h.riichi[cur];
      const declaring = Boolean(act.riichi) && !wasRiichi && opt.riichi.includes(kindOf(tileId));
      if (wasRiichi) h.ippatsu[cur] = false;
      const tsumogiri = h.drawn[cur] === tileId;
      h.discards[cur].push({ tile: tileId, tsumogiri, riichi: declaring, called: false, turn: h.turn });
      h.drawn[cur] = null;
      if (declaring) {
        h.riichi[cur] = true;
        h.riichiAt[cur] = h.discards[cur].length - 1;
        h.ippatsu[cur] = true;
        if (!h.anyCall && !h.firstTurnDone[cur]) h.doubleRiichi[cur] = true;
      }
      h.firstTurnDone[cur] = true;
      afterCall = false;
      rinshan = false;
      forbidden = [];
      await this.emit('discard', { seat: cur, tile: tileId, riichi: declaring, tsumogiri });

      // 다른 사람의 반응
      const order = [1, 2, 3].map((k) => (cur + k) % 4);
      const opts = order.map((s) => ({ s, o: this.callOptions(s, cur, tileId) }));

      // 1) 론
      let winner = null;
      for (const { s, o } of opts) {
        if (!o || !o.ron) continue;
        const ans = await this.players[s].chooseCall(this.view(s), { ...o, pon: false, minkan: false, chi: [], stage: 'ron' });
        if (ans.type === 'ron') {
          if (o.ron.valid) { winner = { s, o }; break; }
          await this.emit('falseWin', { seat: s, kind: 'ron', reason: o.ron.reason, tile: tileId });
        }
      }
      if (winner) return this.resolveWin(winner.s, cur, winner.o.ron.result, tileId);

      // 대기패를 보낸 사람은 동순 후리텐 (리치면 영구)
      for (const s of order) {
        const w = waitsOf(countsOf(h.hands[s]));
        if (w.includes(kindOf(tileId))) {
          h.tempFuriten[s] = true;
          if (h.riichi[s]) h.riichiFuriten[s] = true;
        }
      }

      if (declaring) {
        this.scores[cur] -= 1000;
        this.sticks += 1;
        await this.emit('riichiPaid', { seat: cur });
      }

      // 2) 퐁·깡, 3) 치
      let call = null;
      for (const { s, o } of opts) {
        if (!o || !(o.pon || o.minkan)) continue;
        const ans = await this.players[s].chooseCall(this.view(s), { ...o, ron: null, chi: [], stage: 'pon' });
        if (ans.type === 'pon' && o.pon) { call = { s, type: 'pon' }; break; }
        if (ans.type === 'minkan' && o.minkan) { call = { s, type: 'minkan' }; break; }
      }
      if (!call) {
        for (const { s, o } of opts) {
          if (!o || !o.chi.length) continue;
          const ans = await this.players[s].chooseCall(this.view(s), { ...o, ron: null, pon: false, minkan: false, stage: 'chi' });
          if (ans.type === 'chi' && o.chi.some((p) => p[0] === ans.use[0] && p[1] === ans.use[1])) {
            call = { s, type: 'chi', use: ans.use };
          }
          break;
        }
      }

      if (call) {
        const d = h.discards[cur][h.discards[cur].length - 1];
        d.called = true;
        h.anyCall = true;
        h.ippatsu = [false, false, false, false];
        const t = kindOf(tileId);
        let tiles;
        if (call.type === 'chi') tiles = [this.takeTile(call.s, call.use[0]), this.takeTile(call.s, call.use[1])];
        else if (call.type === 'pon') tiles = [this.takeTile(call.s, t), this.takeTile(call.s, t)];
        else tiles = [this.takeTile(call.s, t), this.takeTile(call.s, t), this.takeTile(call.s, t)];
        tiles.push(tileId);
        h.melds[call.s].push({ type: call.type, tiles, from: cur, called: tileId });
        cur = call.s;
        h.firstTurnDone[cur] = true;
        await this.emit('call', { seat: cur, callType: call.type, from: d, tile: tileId });
        if (call.type === 'minkan') {
          h.kanCount += 1;
          this.revealDora();
          const id = this.drawRinshan(cur);
          await this.emit('draw', { seat: cur, tile: id, rinshan: true });
          needDraw = false;
          afterCall = false;
          rinshan = true;
        } else {
          needDraw = false;
          afterCall = true;
          forbidden = call.type === 'pon' ? [t] : kuikae(t, call.use);
          h.drawn[cur] = null;
        }
        continue;
      }

      cur = (cur + 1) % 4;
      needDraw = true;
    }
  }

  async resolveWin(seat, loser, result, tileId) {
    const pay = payments({ base: result.base, winner: seat, loser, dealer: this.dealer, honba: this.honba, sticks: this.sticks });
    const before = this.scores.slice();
    for (let p = 0; p < 4; p++) this.scores[p] += pay[p];
    const win = {
      seat, loser, result, tile: tileId, pay, before, after: this.scores.slice(),
      hand: this.h.hands[seat].slice(), melds: this.h.melds[seat].map((m) => ({ ...m, tiles: m.tiles.slice() })),
      dealer: this.dealer, honba: this.honba, sticks: this.sticks,
      ura: this.h.riichi[seat] ? this.uraIndicators() : [], dora: this.doraIndicators(),
    };
    this.sticks = 0;
    await this.emit('win', { win });
    this.advance({ dealerKeeps: seat === this.dealer, draw: false });
    await this.emit('handEnd', { kind: 'win', win });
  }

  async exhaustiveDraw() {
    const tenpai = [0, 1, 2, 3].map((s) => this.isTenpai(s));
    const k = tenpai.filter(Boolean).length;
    const pay = [0, 0, 0, 0];
    if (k > 0 && k < 4) {
      for (let s = 0; s < 4; s++) pay[s] = tenpai[s] ? 3000 / k : -3000 / (4 - k);
    }
    const before = this.scores.slice();
    for (let s = 0; s < 4; s++) this.scores[s] += pay[s];
    const draw = { tenpai, pay, before, after: this.scores.slice(), hands: this.h.hands.map((x) => x.slice()) };
    await this.emit('exhaustive', { draw });
    this.advance({ dealerKeeps: tenpai[this.dealer], draw: true });
    await this.emit('handEnd', { kind: 'draw', draw });
  }

  advance({ dealerKeeps, draw }) {
    const lastHand = this.roundWindIdx === this.rules.rounds - 1 && this.handNo === 3;
    if (this.scores.some((x) => x < 0)) { this.over = true; return; }
    if (dealerKeeps) {
      this.honba += 1;
      if (lastHand && this.rules.agariYame && this.ranking()[0] === this.dealer) this.over = true;
      return;
    }
    this.honba = draw ? this.honba + 1 : 0;
    this.dealer = (this.dealer + 1) % 4;
    this.handNo += 1;
    if (this.handNo === 4) {
      this.handNo = 0;
      this.roundWindIdx += 1;
      if (this.roundWindIdx >= this.rules.rounds) this.over = true;
    }
  }
}

// 울고 나서 바로 버릴 수 없는 패 종류
export function kuikae(t, pair) {
  if (!pair) return [t];
  const seq = [t, ...pair].sort((a, b) => a - b);
  const out = [t];
  const n = t % 9;
  if (t === seq[0] && n + 3 <= 8) out.push(t + 3);
  if (t === seq[2] && n - 3 >= 0) out.push(t - 3);
  return out;
}

export function roundName(view) {
  return `${WIND_KO[view.roundWindIdx]}${view.handNo + 1}국`;
}
