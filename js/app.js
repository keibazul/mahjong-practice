// 화면: 홈 · 대국 · 내 실력
import { tileHTML } from './tiles.js';
import { Game, mulberry32, kindOf, countsOf, roundName } from './game.js';
import { AIPlayer, analyzeDiscards } from './ai.js';
import {
  SKILLS, level, observe, updateModel, aiTheta, afterHand, afterGame,
  rankName, strengthLabel, styleReport, weakest, DELTA_MIN, DELTA_MAX,
} from './ml.js';
import {
  askProb, judgeEfficiency, judgeDefense, scoreChoices, makeDealShaper, LINES, pickLine, FALSE_WIN_TEXT,
} from './coach.js';
import { load, save, reset, addMistake } from './store.js';
import { waits as waitsOf, tileName, toString, parse, toList } from './engine.js';
import { limitLabel, pointLabel } from './yaku.js';
import { sfx, configure as configureSound, unlock as unlockSound } from './sound.js';

const main = document.getElementById('main');
const sheet = document.getElementById('sheet');
let P = load();
if (P.settings.calls === undefined) P.settings.calls = true;
if (!P.settings.sound) P.settings.sound = 'mid';
configureSound(P.settings.sound);
// 모바일은 사용자가 화면을 처음 누를 때 소리를 열어야 한다
document.addEventListener('pointerdown', unlockSound, { passive: true });
document.addEventListener('keydown', unlockSound);
let S = null; // 진행 중인 대국

const NAMES = ['나', '작사 A', '작사 B', '작사 C'];
const OFFSET = [0, -0.12, 0, 0.12];
const SPEED = { fast: 120, normal: 420, slow: 800 };
const WIND_GLYPH = ['東', '南', '西', '北'];
const ICON_SOUND = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const ICON_MUTE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
const rnd = Math.random;
const fmt = (n) => n.toLocaleString('ko-KR');
const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');
const josa = (word, a, b) => {
  const ch = word.charCodeAt(word.length - 1);
  if (ch < 0xac00 || ch > 0xd7a3) return word + b;
  return word + ((ch - 0xac00) % 28 ? a : b);
};

// ---------- 패 그리기 ----------
const t1 = (k, cls = '') => tileHTML(k, { cls });
const tilesRow = (kinds, cls = '') => `<span class="mini">${kinds.map((k) => t1(k, cls)).join('')}</span>`;
const namesOf = (kinds) => kinds.map(tileName).join(' · ');

function meldHTML(m) {
  const ks = m.tiles.map(kindOf);
  if (m.type === 'ankan') {
    const back = '<span class="tile back" role="img" aria-label="뒷면"></span>';
    return `<span class="grp">${back}${t1(ks[1])}${t1(ks[2])}${back}</span>`;
  }
  const called = m.called !== undefined ? kindOf(m.called) : -1;
  let marked = false;
  return `<span class="grp">${ks.map((k) => {
    const side = !marked && k === called;
    if (side) marked = true;
    return t1(k, side ? 'side' : '');
  }).join('')}</span>`;
}

// ---------- 라우팅 ----------
function current() { return location.hash.replace(/^#\/?/, ''); }

function route() {
  const r = current();
  document.querySelectorAll('.topnav a').forEach((a) => {
    a.setAttribute('aria-current', a.getAttribute('href') === `#/${r}` ? 'page' : 'false');
  });
  if (S && S.over) closeSheet();
  if (r === 'play') renderPlayPage();
  else if (r === 'me') renderMe();
  else renderHome();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// ---------- 홈 ----------
function skillsHTML(showN = false) {
  const weak = weakest(P.mastery).slice(0, 2);
  return `<ul class="skills">${Object.entries(SKILLS).map(([k, v]) => {
    const m = level(P.mastery[k]);
    return `<li class="${weak.includes(k) ? 'weak' : ''}"><span>${v.ko}</span><span class="bar" role="img" aria-label="${v.ko} ${Math.round(m * 100)}%"><i style="width:${Math.round(m * 100)}%"></i></span><span class="pct">${Math.round(m * 100)}%${showN ? `<br><small>${P.mastery[k].n}회</small>` : ''}</span></li>`;
  }).join('')}</ul>`;
}

function segHTML(key, opts) {
  return `<div class="seg" data-set="${key}">${opts.map(([v, label]) => `<button type="button" data-v="${v}" aria-pressed="${String(P.settings[key]) === String(v)}">${label}</button>`).join('')}</div>`;
}

function renderHome() {
  const weak = weakest(P.mastery).slice(0, 2);
  const live = S && !S.over;
  const rs = P.resume;
  const resumeName = rs ? `${['동', '남'][rs.roundWindIdx]}${rs.handNo + 1}국부터` : '';
  main.innerHTML = `
  <section class="felt">
    <h1>작사 도장</h1>
    <p class="quote">"패는 거짓말을 하지 않는다. 서두르는 건 언제나 손이다."</p>
    <div class="rack"><div class="hand">${toList(parse('234m406p77s')).map((k) => t1(k)).join('')}<span class="sp"></span>${toList(parse('555z')).map((k) => t1(k)).join('')}</div></div>
    <p class="choose-label">대국 길이</p>
    <div class="choose" data-set="rounds">
      <button type="button" data-v="1" aria-pressed="${P.settings.rounds === 1}">동풍전</button>
      <button type="button" data-v="2" aria-pressed="${P.settings.rounds === 2}">반장전</button>
    </div>
    <div class="row">
      ${live ? '<a class="btn light" href="#/play">대국으로 돌아가기</a>' : ''}
      ${!live && rs ? `<button type="button" class="btn light" data-act="resume">이어하기 · ${resumeName}</button>` : ''}
      <button type="button" class="btn ${live || rs ? '' : 'light'}" style="${live || rs ? 'color:var(--on-felt);border-color:var(--on-felt-2)' : ''}" data-act="new">새 대국</button>
    </div>
  </section>

  <section class="panel">
    <h2>지금 네 실력 · ${rankName(P)}</h2>
    <p class="lead">AI 강도 ${strengthLabel(P.delta)} · 학습한 네 타패 ${fmt(P.model.n)}개</p>
    ${skillsHTML()}
    <p class="note">사부의 처방: ${josa(SKILLS[weak[0]].ko, '과', '와')} ${josa(SKILLS[weak[1]].ko, '을', '를')} 대국 중에 자주 물어본다. 붉은 막대가 지금 약한 곳이다.</p>
  </section>

  <section class="panel">
    <h2>설정</h2>
    <div class="settings">
      <div><p class="opt-label">사부의 질문</p>${segHTML('coach', [['many', '자주'], ['auto', '보통'], ['off', '끄기']])}</div>
      <div><p class="opt-label">진행 속도</p>${segHTML('speed', [['fast', '빠름'], ['normal', '보통'], ['slow', '느림']])}</div>
      <div><p class="opt-label">치·퐁·깡 기회 알림</p>${segHTML('calls', [['true', '알림'], ['false', '끄기']])}</div>
      <div><p class="opt-label">효과음</p>${segHTML('sound', [['off', '끄기'], ['low', '작게'], ['mid', '보통'], ['high', '크게']])}</div>
    </div>
  </section>

  <section class="panel">
    <h2>이 도장의 규칙</h2>
    <p class="lead">상대 셋은 네 타패를 배운 AI다. 네가 이기면 강해지고, 지면 약해져서 늘 팽팽한 승부가 되도록 맞춘다. 대국 중에는 사부가 네 약점을 골라 묻는다.</p>
    <p class="note">화료 형태가 되면 역이 없거나 후리텐이어도 론·쯔모 버튼이 뜬다. 날 수 있는지는 네가 판단해야 한다. 규칙은 쿠이탄 있음, 아카도라 없음, 절상만관 없음이다. 기록은 이 기기의 브라우저에만 저장된다.</p>
  </section>`;
}

main.addEventListener('click', (e) => {
  const mute = e.target.closest('[data-sound]');
  if (mute) {
    const on = P.settings.sound !== 'off';
    if (on) P.settings.soundLast = P.settings.sound;
    P.settings.sound = on ? 'off' : (P.settings.soundLast || 'mid');
    configureSound(P.settings.sound);
    unlockSound();
    if (!on) sfx.select();
    save();
    renderTable();
    return;
  }
  if (S && e.target.closest('.play')) { playClick(e); return; }
  const seg = e.target.closest('[data-set] button');
  if (seg) {
    const key = seg.parentElement.dataset.set;
    let v = seg.dataset.v;
    if (key === 'rounds') v = Number(v);
    if (key === 'calls') v = v === 'true';
    P.settings[key] = v;
    save();
    if (key === 'sound') { configureSound(v); unlockSound(); sfx.discard(); }
    seg.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === seg)));
    return;
  }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const a = act.dataset.act;
  if (a === 'new') { startGame(null); location.hash = '#/play'; if (current() === 'play') renderTable(); }
  if (a === 'resume') { startGame(P.resume); location.hash = '#/play'; if (current() === 'play') renderTable(); }
  if (a === 'export') {
    const text = exportText();
    const msg = document.getElementById('export-msg');
    const box = document.getElementById('export-box');
    const fallback = () => {
      box.hidden = false;
      box.value = text;
      box.focus();
      box.select();
      msg.textContent = '아래 글을 길게 눌러 전체 선택한 뒤 복사해서 사부에게 붙여 넣어라.';
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => { msg.textContent = '복사했다. 대화창에 붙여 넣어라.'; sfx.good(); }, fallback);
    } else fallback();
    return;
  }
  if (a === 'reset') {
    if (window.confirm('학습한 모델과 숙련도, 대국 기록을 모두 지울까?')) { P = reset(); P.settings.calls = true; renderMe(); }
  }
});

// ---------- 대국 ----------
class Human {
  chooseTurn(view, opt) {
    return new Promise((resolve) => {
      S.pending = { kind: 'turn', view, opt, resolve };
      S.sel = null;
      S.riichiMode = false;
      prepareTurn();
      renderTable();
      if (opt.mustTsumogiri && !opt.tsumo) {
        const p = S.pending;
        setTimeout(() => { if (S && S.pending === p) humanDiscard(kindOf(view.drawn)); }, SPEED[P.settings.speed] + 150);
      }
    });
  }

  chooseCall(view, opt) {
    if (!opt.ron && !P.settings.calls) return Promise.resolve({ type: 'pass' });
    return new Promise((resolve) => {
      S.pending = { kind: 'call', view, opt, resolve };
      sfx.alert();
      renderTable();
    });
  }
}

function startGame(snapshot) {
  closeSheet();
  const seed = Math.floor(rnd() * 2 ** 31);
  const rng = mulberry32(seed ^ 0x5bd1e995);
  const think = () => wait(SPEED[P.settings.speed]);
  const human = new Human();
  const ais = [1, 2, 3].map((i) => new AIPlayer({
    name: NAMES[i], rng, think,
    weights: () => aiTheta(P.model, Math.max(DELTA_MIN, Math.min(DELTA_MAX, P.delta + OFFSET[i]))),
  }));
  const rounds = snapshot ? snapshot.rules.rounds : P.settings.rounds;
  const game = new Game({
    players: [human, ...ais],
    rules: { rounds, wallCandidates: P.settings.coach === 'off' ? 1 : 12 },
    seed,
    onEvent,
    dealShaper: makeDealShaper(P, rng),
  });
  if (snapshot) game.restore(snapshot);
  S = {
    game, pending: null, sel: null, riichiMode: false, active: game.dealer, last: null, over: false,
    msg: { tone: '', text: snapshot ? '이어서 하자. 패를 다시 섞었다.' : '천천히 해라. 내가 옆에서 보고 있다.' },
    an: null, ask: null, handBefore: null, deltaStart: P.delta, masteryStart: Object.fromEntries(Object.keys(SKILLS).map((k) => [k, level(P.mastery[k])])),
  };
  const mine = S;
  game.run().catch((err) => {
    console.error(err);
    if (S === mine) say('bad', `진행 중 오류가 났다: ${err.message}. 새 대국을 시작해라.`);
  });
}

function renderPlayPage() {
  if (!S || S.over) {
    if (P.resume && !S) startGame(P.resume);
    else startGame(null);
  }
  renderTable();
}

function say(tone, text, detail = '') {
  if (!S) return;
  S.msg = { tone, text, detail };
  if (tone === 'good') sfx.good();
  if (tone === 'bad') sfx.bad();
}

// ---------- 차례마다 사부가 보는 것 ----------
function prepareTurn() {
  const { view, opt } = S.pending;
  S.an = null;
  S.ask = null;
  if (opt.mustTsumogiri) return;
  const an = analyzeDiscards(view, opt);
  S.an = an;
  if (an.cands.length < 2) return;
  if (S.holdMsg) { S.holdMsg = false; return; }
  if (an.riichiThreat && an.minSh >= 1 && rnd() < askProb(P, 'defense')) {
    S.ask = 'defense';
    say('', pickLine(LINES.defAsk));
  } else if (!an.riichiThreat && an.yakuSecured && an.minSh <= 2) {
    const same = an.cands.filter((x) => x.shanten === an.minSh);
    const best = Math.max(...same.map((x) => x.accept));
    if (same.some((x) => x.accept < best * 0.85) && rnd() < askProb(P, 'efficiency')) {
      S.ask = 'efficiency';
      say('', pickLine(LINES.effAsk));
    }
  }
}

function judgeAfterDiscard(kind, view) {
  const an = S.an;
  const handStr = toString(countsOf(view.hand));
  const d = judgeDefense(an, kind);
  if (d) {
    observe(P.mastery, 'defense', d.correct, S.ask === 'defense' ? 1 : 0.5);
    if (d.correct && S.ask === 'defense') say('good', pickLine(LINES.defGood));
    if (!d.correct) {
      const why = d.far ? '손이 멀면(2샹텐 이상) 현물부터 버리고 접는다.' : '일샹텐이면 위험한 패는 피하면서 버틴다.';
      say('bad', `${pickLine(LINES.defBad)} 더 안전한 패: ${tilesRow(d.safest.slice(0, 5))}`, why);
      addMistake({ skill: 'defense', text: `리치 상대에게 ${tileName(kind)}${d.far ? ' (손이 멀었다)' : ''}. 안전한 패: ${namesOf(d.safest.slice(0, 4))}`, hand: handStr });
    }
    return;
  }
  const e = judgeEfficiency(an, kind);
  if (e && e.meaningful) {
    observe(P.mastery, 'efficiency', e.correct, S.ask === 'efficiency' ? 1 : 0.4);
    const show = S.ask === 'efficiency' || (!e.correct && rnd() < 0.4 + 0.6 * (1 - level(P.mastery.efficiency)));
    if (e.correct && show) say('good', `${pickLine(LINES.effGood)} ${josa(tileName(kind), '을', '를')} 버리면 유효패 ${e.mine.accept}장.`);
    if (!e.correct) {
      const worse = e.mine.shanten > e.minSh ? '샹텐이 하나 늘었다.' : `네가 버린 ${josa(tileName(kind), '은', '는')} ${e.mine.accept}장.`;
      if (show) say('bad', `${pickLine(LINES.effBad)} ${tilesRow(e.best.slice(0, 3))} 쪽이 ${e.bestAcc}장을 받는다.`, worse);
      addMistake({ skill: 'efficiency', text: `${tileName(kind)} 버림 (${e.mine.accept}장) → ${namesOf(e.best.slice(0, 3))} (${e.bestAcc}장)`, hand: handStr });
    }
  } else if (S.ask) {
    say('', '됐다. 이번엔 어느 쪽이든 큰 차이가 없었다.');
  }
}

async function humanDiscard(kind) {
  if (!S || !S.pending || S.pending.kind !== 'turn') return;
  const p = S.pending;
  const { view, opt, resolve } = p;
  if (opt.forbidden.includes(kind)) return;
  const riichi = S.riichiMode && opt.riichi.includes(kind);
  S.pending = null;
  S.sel = null;
  S.riichiMode = false;
  if (S.an) {
    const idx = S.an.cands.findIndex((x) => x.t === kind);
    if (idx >= 0 && S.an.cands.length > 1) updateModel(P.model, S.an.cands, idx);
    judgeAfterDiscard(kind, view);
  }
  renderTable();
  // 텐파이가 되면 대기·후리텐 문제
  const c = countsOf(view.hand);
  c[kind] -= 1;
  const w = waitsOf(c);
  if (w.length && !view.riichi[0] && !opt.mustTsumogiri) {
    const own = new Set(view.discards[0].map((d) => kindOf(d.tile)));
    own.add(kind);
    const furiten = w.some((t) => own.has(t));
    if (rnd() < askProb(P, 'waits')) await waitsQuiz(c, w);
    else if (rnd() < askProb(P, 'furiten') * (furiten ? 1.6 : 0.4)) await furitenQuiz(c, w, view, kind, furiten);
  }
  save();
  resolve({ type: 'discard', tile: kind, riichi });
}

function humanTurnAction(act) {
  const p = S.pending;
  if (!p || p.kind !== 'turn') return;
  if (act.type === 'tsumo') {
    const t = p.opt.tsumo;
    if (t && t.valid) { observe(P.mastery, 'yaku', true, 0.3); }
  }
  S.pending = null;
  S.sel = null;
  S.riichiMode = false;
  save();
  p.resolve(act);
}

function humanCall(ans) {
  const p = S.pending;
  if (!p || p.kind !== 'call') return;
  const r = p.opt.ron;
  if (r) {
    if (ans.type === 'ron' && r.valid) {
      observe(P.mastery, 'furiten', true, 0.3);
      observe(P.mastery, 'yaku', true, 0.3);
    }
    if (ans.type !== 'ron') {
      if (!r.valid && r.reason.startsWith('furiten')) {
        observe(P.mastery, 'furiten', true, 0.6);
        say('good', '잘 참았다. 지금은 후리텐이라 론이 안 된다.', FALSE_WIN_TEXT[r.reason]);
      } else if (!r.valid && r.reason === 'noYaku') {
        observe(P.mastery, 'yaku', true, 0.5);
        say('good', '그래, 역이 없으니 날 수 없다.');
      } else if (r.valid) {
        observe(P.mastery, 'furiten', false, 0.5);
        say('bad', `론할 수 있었다! ${tileName(kindOf(p.opt.tile))} 론이면 ${limitLabel(r.result)} 화료였다.`, '후리텐이 아니고 역이 있으면 망설이지 마라.');
        addMistake({ skill: 'furiten', text: `론할 수 있는 ${josa(tileName(kindOf(p.opt.tile)), '을', '를')} 보냈다`, hand: toString(countsOf(p.view.hand)) });
      }
    }
  }
  S.pending = null;
  save();
  p.resolve(ans);
}

function playClick(e) {
  const tileBtn = e.target.closest('button.tile[data-k]');
  const p = S.pending;
  if (tileBtn && p && p.kind === 'turn') {
    if (tileBtn.disabled) return;
    const id = Number(tileBtn.dataset.id);
    if (S.sel === id) humanDiscard(Number(tileBtn.dataset.k));
    else { S.sel = id; sfx.select(); renderTable(); }
    return;
  }
  const act = e.target.closest('[data-play]');
  if (!act || !p) return;
  const a = act.dataset.play;
  if (p.kind === 'turn') {
    if (a === 'tsumo') humanTurnAction({ type: 'tsumo' });
    if (a === 'riichi') { S.riichiMode = !S.riichiMode; S.sel = null; sfx.select(); renderTable(); }
    if (a === 'ankan') humanTurnAction({ type: 'ankan', kind: Number(act.dataset.k) });
    if (a === 'kakan') humanTurnAction({ type: 'kakan', kind: Number(act.dataset.k) });
  } else {
    if (a === 'ron') humanCall({ type: 'ron' });
    if (a === 'pon') humanCall({ type: 'pon' });
    if (a === 'minkan') humanCall({ type: 'minkan' });
    if (a === 'chi') humanCall({ type: 'chi', use: act.dataset.use.split(',').map(Number) });
    if (a === 'pass') humanCall({ type: 'pass' });
  }
}

// ---------- 게임 이벤트 ----------
async function onEvent(ev, g) {
  if (!S || S.game !== g) return;
  switch (ev.type) {
    case 'handStart':
      S.handBefore = g.scores.slice();
      S.last = null;
      S.active = g.dealer;
      P.resume = g.snapshot();
      save();
      break;
    case 'draw': S.active = ev.seat; if (ev.seat === 0) sfx.draw(); break;
    case 'discard': S.last = ev.tile; if (ev.riichi) sfx.riichi(); else sfx.discard(); break;
    case 'call': S.active = ev.seat; S.last = null; sfx.call(ev.callType === 'minkan' ? 'kan' : ev.callType); break;
    case 'kan': sfx.call('kan'); break;
    case 'falseWin':
      if (ev.seat === 0) {
        const skill = ev.reason === 'noYaku' || ev.reason === 'notAgari' ? 'yaku' : 'furiten';
        observe(P.mastery, skill, false, 1);
        say('bad', ev.kind === 'ron' ? '론 취소!' : '쯔모 취소!', FALSE_WIN_TEXT[ev.reason]);
        S.holdMsg = true;
        addMistake({ skill, text: `${ev.kind === 'ron' ? '론' : '쯔모'} 선언 실패: ${FALSE_WIN_TEXT[ev.reason]}`, hand: toString(countsOf(g.h.hands[0])) });
        save();
      }
      break;
    case 'win':
      renderTable();
      sfx.win(ev.win.seat === 0 ? 'me' : ev.win.loser === 0 ? 'dealtIn' : 'other');
      await wait(450);
      await showWin(ev.win, g);
      break;
    case 'exhaustive':
      renderTable();
      sfx.ryuukyoku();
      await wait(300);
      await showExhaustive(ev.draw, g);
      break;
    case 'handEnd':
      afterHand(P, S.handBefore, g.scores);
      P.hands += 1;
      save();
      break;
    case 'gameEnd':
      S.over = true;
      P.resume = null;
      await showGameEnd(ev.result, g);
      return;
    default: break;
  }
  renderTable();
}

// ---------- 대국 화면 ----------
function riverHTML(ds) {
  return ds.map((d) => {
    const cls = [d.riichi ? 'side' : '', d.called ? 'dim' : '', S.last === d.tile ? 'last' : ''].filter(Boolean).join(' ');
    return t1(kindOf(d.tile), cls);
  }).join('');
}

function renderTable() {
  if (!S || current() !== 'play' || !S.game.h) {
    if (S && current() === 'play' && !S.game.h) main.innerHTML = '<section class="play"><p class="hint">패를 섞는 중…</p></section>';
    return;
  }
  const g = S.game;
  const h = g.h;
  const p = S.pending;
  const seats = [0, 1, 2, 3].map((s) => {
    const wind = (s - g.dealer + 4) % 4;
    return `<div class="seat r${s} ${S.active === s ? 'active' : ''}">
      <div class="label"><span class="w ${wind === 0 ? 'dealer' : ''}">${WIND_GLYPH[wind]}</span>${s ? `<span class="who">${NAMES[s].slice(-1)}</span>` : ''}<span>${fmt(g.scores[s])}</span>${h.riichi[s] ? '<span class="stick" aria-label="리치"></span>' : ''}</div>
      <div class="river">${riverHTML(h.discards[s])}</div>
      ${s ? `<div class="melds">${h.melds[s].map(meldHTML).join('')}</div>` : ''}
    </div>`;
  }).join('');

  // 손패
  const turn = p && p.kind === 'turn' ? p : null;
  const drawn = turn ? turn.view.drawn : null;
  const ids = h.hands[0].slice().sort((a, b) => a - b);
  const main13 = drawn !== null && ids.includes(drawn) ? ids.filter((x) => x !== drawn) : ids;
  const enabled = (id) => {
    if (!turn) return false;
    const k = kindOf(id);
    if (turn.opt.mustTsumogiri) return id === drawn;
    if (turn.opt.forbidden.includes(k)) return false;
    if (S.riichiMode) return turn.opt.riichi.includes(k);
    return true;
  };
  const tileBtn = (id) => tileHTML(kindOf(id), { button: true, attrs: `data-id="${id}" data-k="${kindOf(id)}" ${enabled(id) ? '' : 'disabled'}` })
    .replace('aria-pressed="false"', `aria-pressed="${S.sel === id}"`);
  const handHTML = main13.map(tileBtn).join('') + (drawn !== null && ids.includes(drawn) ? `<span class="sp"></span>${tileBtn(drawn)}` : '');

  // 행동 버튼
  let acts = '';
  if (turn) {
    const o = turn.opt;
    if (o.tsumo) acts += '<button type="button" class="act win" data-play="tsumo">쯔모</button>';
    if (o.riichi.length) acts += `<button type="button" class="act riichi" data-play="riichi" aria-pressed="${S.riichiMode}">리치</button>`;
    for (const k of o.ankan) acts += `<button type="button" class="act call" data-play="ankan" data-k="${k}">깡 ${t1(k)}</button>`;
    for (const k of o.kakan) acts += `<button type="button" class="act call" data-play="kakan" data-k="${k}">깡 ${t1(k)}</button>`;
  } else if (p && p.kind === 'call') {
    const o = p.opt;
    const tk = kindOf(o.tile);
    if (o.ron) acts += `<button type="button" class="act win" data-play="ron">론 ${t1(tk)}</button>`;
    if (o.pon) acts += '<button type="button" class="act call" data-play="pon">퐁</button>';
    if (o.minkan) acts += '<button type="button" class="act call" data-play="minkan">깡</button>';
    for (const pair of o.chi) acts += `<button type="button" class="act call" data-play="chi" data-use="${pair.join(',')}">치 ${tilesRow([...pair, tk].sort((a, b) => a - b))}</button>`;
    acts += '<button type="button" class="act" data-play="pass">패스</button>';
  }

  let hint = '';
  if (turn) {
    if (turn.opt.mustTsumogiri) hint = turn.opt.tsumo ? '리치 중이다. 쯔모하거나 뽑은 패를 버린다.' : '리치 중이라 뽑은 패를 그대로 버린다.';
    else if (S.riichiMode) hint = '리치를 걸며 버릴 패를 골라라. 밝은 패만 고를 수 있다.';
    else hint = '패를 한 번 눌러 들고, 한 번 더 누르면 버린다.';
  } else if (p && p.kind === 'call') hint = `${NAMES[p.opt.from]}의 ${tileName(kindOf(p.opt.tile))}. 어떻게 할까?`;
  else hint = `${NAMES[S.active]} 차례…`;

  const v = g.view(0);
  main.innerHTML = `<section class="play">
    <div class="status">
      <span class="dora">도라 표시패 ${tilesRow(v.dora)}</span>
      <span class="right"><span>AI ${strengthLabel(P.delta)}</span><button type="button" class="mute" data-sound aria-pressed="${P.settings.sound !== 'off'}" aria-label="${P.settings.sound !== 'off' ? '효과음 끄기' : '효과음 켜기'}">${P.settings.sound !== 'off' ? ICON_SOUND : ICON_MUTE}</button></span>
    </div>
    <div class="table" role="img" aria-label="${roundName(v)}, 남은 패 ${v.wallLeft}장">
      <div class="center"><div class="rn">${roundName(v)}</div><div class="wl">남은 패 ${v.wallLeft}</div><div class="sticks">${v.honba}본장 · 공탁 ${v.sticks}</div></div>
      ${seats}
    </div>
    <div class="coach ${S.msg.tone}" aria-live="polite"><span class="who">사부</span>${S.msg.text}${S.msg.detail ? `<div class="detail">${S.msg.detail}</div>` : ''}</div>
    <div class="actions">${acts}</div>
    <div class="myrow">
      <div class="mymelds">${h.melds[0].map(meldHTML).join('')}</div>
      <div class="hand ${turn ? '' : 'waiting'}" aria-label="내 손패">${handHTML}</div>
    </div>
    <p class="hint">${hint}</p>
  </section>`;
}

// ---------- 시트 ----------
function openSheet(html) {
  sheet.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`;
  sheet.hidden = false;
  const f = sheet.querySelector('button:not([disabled])');
  if (f) f.focus({ preventScroll: true });
}
function closeSheet() { sheet.hidden = true; sheet.innerHTML = ''; }

function handBlock(kinds, extra = null, melds = []) {
  return `<div class="hand">${kinds.map((k) => t1(k)).join('')}${extra !== null ? `<span class="sp"></span>${t1(extra, 'hit')}` : ''}</div>${melds.length ? `<div class="mymelds" style="justify-content:flex-start">${melds.map(meldHTML).join('')}</div>` : ''}`;
}

function payTable(before, after) {
  return `<table class="pay">${[0, 1, 2, 3].map((s) => {
    const d = after[s] - before[s];
    return `<tr class="${s === 0 ? 'me' : ''}"><td>${NAMES[s]}</td><td class="n">${fmt(after[s])}</td><td class="n ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${signed(d)}</td></tr>`;
  }).join('')}</table>`;
}

function waitSheet(fill) {
  return new Promise((resolve) => { fill(resolve); });
}

async function showWin(win, g) {
  const r = win.result;
  const who = NAMES[win.seat];
  const how = win.loser === null ? '쯔모' : `론 ← ${NAMES[win.loser]}`;
  const kinds = win.hand.map(kindOf).filter((_, i) => win.loser !== null || win.hand[i] !== win.tile).sort((a, b) => a - b);
  const quiz = rnd() < askProb(P, 'scoring');
  const showFu = level(P.mastery.scoring) < 0.55;
  const dealerWin = win.seat === win.dealer;
  const label = pointLabel(r.base, dealerWin, win.loser === null);
  const yakuList = `<ul class="yaku">${r.yaku.map((y) => `<li><span>${y.name}</span><span>${r.yakuman ? '역만' : `${y.han}판`}</span></li>`).join('')}</ul>`;
  const head = `<h2>${who} ${how}</h2><p class="sub">${win.seat === 0 ? '잘했다.' : win.loser === 0 ? '네가 쏘였다.' : ''} ${dealerWin ? '친' : '자'}의 화료${win.honba ? ` · ${win.honba}본장` : ''}</p>
    <div class="block">${handBlock(kinds, kindOf(win.tile), win.melds)}</div>
    <div class="block"><p class="k">도라 표시패 ${tilesRow(win.dora)}${win.ura.length ? ` · 뒷도라 표시패 ${tilesRow(win.ura)}` : ''}</p>${yakuList}</div>`;
  const detail = `<p class="total">${limitLabel(r)} · ${label}</p>`;
  const rest = `<div class="block">${payTable(win.before, win.after)}</div>
    <div class="row block"><button type="button" class="btn primary" data-next>다음 국</button></div>`;

  await waitSheet((done) => {
    if (!quiz) {
      openSheet(head + detail + rest);
    } else {
      const { right, all } = scoreChoices(win);
      openSheet(`${head}<div class="block"><p class="k">사부: ${pickLine(LINES.scoreAsk)} ${showFu && !r.yakuman ? `(${r.fu}부 ${r.han}판, ${dealerWin ? '친' : '자'}${win.loser === null ? ' 쯔모' : ' 론'})` : `(${dealerWin ? '친' : '자'}${win.loser === null ? ' 쯔모' : ' 론'})`}</p>
        <div class="choices">${all.map((c) => `<button type="button" class="choice" data-pick="${c}">${c}</button>`).join('')}</div><div id="after"></div></div>`);
      sheet.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
        const ok = b.dataset.pick === right;
        if (ok) sfx.good(); else sfx.bad();
        observe(P.mastery, 'scoring', ok, 1);
        if (!ok) addMistake({ skill: 'scoring', text: `${r.fu}부 ${r.han}판 ${dealerWin ? '친' : '자'} ${win.loser === null ? '쯔모' : '론'}: ${b.dataset.pick}이라고 답함 → 정답 ${right}` });
        save();
        sheet.querySelectorAll('[data-pick]').forEach((x) => {
          x.disabled = true;
          if (x.dataset.pick === right) x.classList.add('right');
          else if (x === b) x.classList.add('wrong');
        });
        sheet.querySelector('#after').innerHTML = `<div class="verdict ${ok ? 'ok' : 'ng'}"><b>${ok ? '맞다' : '틀렸다'}</b> · ${r.yakuman ? '역만' : `${r.fu}부 ${r.han}판`}이면 ${right}.</div>${detail}${rest}`;
        sheet.querySelector('[data-next]').addEventListener('click', () => { closeSheet(); done(); });
        sheet.querySelector('[data-next]').focus({ preventScroll: true });
      }));
      return;
    }
    sheet.querySelector('[data-next]').addEventListener('click', () => { closeSheet(); done(); });
  });
}

async function showExhaustive(draw) {
  const rows = [0, 1, 2, 3].map((s) => `<div class="block"><p class="k">${NAMES[s]} · ${draw.tenpai[s] ? '텐파이' : '노텐'}</p>${draw.tenpai[s] || s === 0 ? handBlock(draw.hands[s].map(kindOf).sort((a, b) => a - b)) : ''}</div>`).join('');
  await waitSheet((done) => {
    openSheet(`<h2>유국</h2><p class="sub">패산이 다 떨어졌다. 노텐인 사람이 텐파이인 사람에게 3,000점을 나눠 낸다.</p>
      ${rows}<div class="block">${payTable(draw.before, draw.after)}</div>
      <div class="row block"><button type="button" class="btn primary" data-next>다음 국</button></div>`);
    sheet.querySelector('[data-next]').addEventListener('click', () => { closeSheet(); done(); });
  });
}

async function showGameEnd(result) {
  const place = result.order.indexOf(0) + 1;
  const d0 = S.deltaStart;
  afterGame(P, place);
  sfx.gameEnd(place);
  P.games.unshift({ at: Date.now(), place, score: result.scores[0], rounds: S.game.rules.rounds });
  P.games = P.games.slice(0, 50);
  save();
  const changes = Object.keys(SKILLS).map((k) => {
    const before = S.masteryStart[k];
    const now = level(P.mastery[k]);
    const diff = Math.round((now - before) * 100);
    return `<li><span>${SKILLS[k].ko}</span><span class="bar"><i style="width:${Math.round(now * 100)}%"></i></span><span class="pct">${diff > 0 ? `+${diff}` : diff}</span></li>`;
  }).join('');
  const msg = place === 1 ? '1등이다. 다음 판은 상대가 조금 더 세진다.' : place === 4 ? '4등이다. 상대를 조금 누그러뜨리마. 대신 복기는 꼭 해라.' : `${place}등. 나쁘지 않다.`;
  await waitSheet(() => {
    openSheet(`<h2>대국 종료 · ${place}등</h2><p class="sub">${msg}</p>
      <div class="block"><table class="pay">${result.order.map((s, i) => `<tr class="${s === 0 ? 'me' : ''}"><td>${i + 1}등 · ${NAMES[s]}</td><td class="n">${fmt(result.scores[s])}</td></tr>`).join('')}</table></div>
      <div class="block"><p class="k">AI 강도: ${strengthLabel(d0)} → ${strengthLabel(P.delta)}</p></div>
      <div class="block"><p class="k">이번 대국에서 숙련도 변화 (%p)</p><ul class="skills">${changes}</ul></div>
      <div class="row block"><button type="button" class="btn primary" data-again>한 판 더</button><button type="button" class="btn" data-me>내 실력 보기</button></div>`);
    sheet.querySelector('[data-again]').addEventListener('click', () => { closeSheet(); startGame(null); renderTable(); });
    sheet.querySelector('[data-me]').addEventListener('click', () => { closeSheet(); location.hash = '#/me'; });
  });
}

// 대기 맞히기
function waitsQuiz(c13, answer) {
  const kinds = toList(c13);
  const suits = new Set(kinds.map((k) => (k < 27 ? Math.floor(k / 9) : 3)));
  const rows = [...suits].sort().map((sIdx) => {
    const ks = sIdx < 3 ? Array.from({ length: 9 }, (_, i) => sIdx * 9 + i) : [27, 28, 29, 30, 31, 32, 33];
    return ks.map((k) => tileHTML(k, { button: true, attrs: `data-w="${k}"` })).join('');
  }).join('');
  return waitSheet((done) => {
    openSheet(`<h2>대기 맞히기</h2><p class="sub">사부: ${pickLine(LINES.waitAsk)} 하나만 있는 게 아닐 수도 있다.</p>
      <div class="block">${handBlock(kinds)}</div>
      <div class="picker">${rows}</div>
      <p class="err" id="err"></p>
      <div id="after"></div>
      <div class="row block" id="btns"><button type="button" class="btn primary" data-check>확인</button></div>`);
    const picked = new Set();
    sheet.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => {
      const k = Number(b.dataset.w);
      if (picked.has(k)) picked.delete(k); else picked.add(k);
      b.setAttribute('aria-pressed', String(picked.has(k)));
      sfx.select();
      sheet.querySelector('#err').textContent = '';
    }));
    sheet.querySelector('[data-check]').addEventListener('click', () => {
      if (!picked.size) { sheet.querySelector('#err').textContent = '대기패를 하나 이상 골라라.'; return; }
      const ok = picked.size === answer.length && answer.every((k) => picked.has(k));
      if (ok) sfx.good(); else sfx.bad();
      observe(P.mastery, 'waits', ok, 1);
      if (!ok) addMistake({ skill: 'waits', text: `대기 ${josa(namesOf([...picked].sort((a, b) => a - b)), '이라고', '라고')} 답함 → 정답 ${namesOf(answer)}`, hand: toString(c13) });
      save();
      sheet.querySelector('.picker').classList.add('done');
      sheet.querySelectorAll('[data-w]').forEach((b) => {
        const k = Number(b.dataset.w);
        b.disabled = true;
        b.setAttribute('aria-pressed', 'false');
        if (answer.includes(k)) b.classList.add('hit');
        else if (picked.has(k)) b.classList.add('mark');
        else b.classList.add('dim');
      });
      const missed = answer.filter((k) => !picked.has(k));
      sheet.querySelector('#after').innerHTML = `<div class="verdict ${ok ? 'ok' : 'ng'}"><b>${ok ? '정확하다' : '아깝다'}</b> · 대기는 ${tilesRow(answer)} ${answer.length}종.${missed.length ? ` 놓친 패: ${namesOf(missed)}.` : ''}</div>`;
      sheet.querySelector('#btns').innerHTML = '<button type="button" class="btn primary" data-go>계속</button>';
      sheet.querySelector('[data-go]').addEventListener('click', () => { closeSheet(); done(); });
      sheet.querySelector('[data-go]').focus({ preventScroll: true });
    });
  });
}

// 후리텐 판단
function furitenQuiz(c13, w, view, discarded, furiten) {
  const river = [...view.discards[0].map((d) => kindOf(d.tile)), discarded];
  return waitSheet((done) => {
    openSheet(`<h2>후리텐 판단</h2><p class="sub">사부: ${pickLine(LINES.furitenAsk)}</p>
      <div class="block"><p class="k">네 손패 (텐파이)</p>${handBlock(toList(c13))}</div>
      <div class="block"><p class="k">네 버림패 (방금 버린 패 포함)</p>${tilesRow(river)}</div>
      <div class="choices"><button type="button" class="choice" data-f="no">론 가능</button><button type="button" class="choice" data-f="yes">후리텐 (쯔모만)</button></div>
      <div id="after"></div>`);
    sheet.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
      const ok = (b.dataset.f === 'yes') === furiten;
      if (ok) sfx.good(); else sfx.bad();
      observe(P.mastery, 'furiten', ok, 1);
      if (!ok) addMistake({ skill: 'furiten', text: `후리텐 판단 틀림 (대기 ${namesOf(w)}, ${furiten ? '후리텐' : '후리텐 아님'})`, hand: toString(c13) });
      save();
      sheet.querySelectorAll('[data-f]').forEach((x) => {
        x.disabled = true;
        if ((x.dataset.f === 'yes') === furiten) x.classList.add('right');
        else if (x === b) x.classList.add('wrong');
      });
      const inRiver = w.filter((k) => river.includes(k));
      const why = furiten
        ? `대기는 ${namesOf(w)}인데 ${josa(namesOf(inRiver), '을', '를')} 네가 버렸다. 대기 중 하나라도 버렸으면 모든 대기로 론을 못 한다.`
        : `대기 ${namesOf(w)} 중 네가 버린 패가 없다. 론할 수 있다.`;
      sheet.querySelector('#after').innerHTML = `<div class="verdict ${ok ? 'ok' : 'ng'}"><b>${ok ? '맞다' : '틀렸다'}</b> · ${why}</div>
        <div class="row block"><button type="button" class="btn primary" data-go>계속</button></div>`;
      sheet.querySelector('[data-go]').addEventListener('click', () => { closeSheet(); done(); });
      sheet.querySelector('[data-go]').focus({ preventScroll: true });
    }));
  });
}

// ---------- 내 실력 ----------
function exportText() {
  const style = styleReport(P.model);
  const games = P.games;
  const pct = (x) => Math.round(x * 100);
  const avg = games.length ? (games.reduce((a, g) => a + g.place, 0) / games.length).toFixed(2) : '-';
  const places = [1, 2, 3, 4].map((k) => games.filter((g) => g.place === k).length).join('/');
  const bySkill = {};
  for (const m of P.mistakes) bySkill[m.skill] = (bySkill[m.skill] || 0) + 1;
  return [
    `[작사 도장 기록] ${new Date().toLocaleString('ko-KR')}`,
    `대국 ${games.length}판 (1/2/3/4등 ${places}) · 평균 ${avg}위 · 진행한 국 ${P.hands}`,
    `추정 실력 ${rankName(P)} · AI 강도 δ=${P.delta.toFixed(2)} (${strengthLabel(P.delta)})`,
    `숙련도: ${Object.entries(SKILLS).map(([k, v]) => `${v.ko} ${pct(level(P.mastery[k]))}% (${P.mastery[k].n}회)`).join(' / ')}`,
    `타패 모델: 학습 ${P.model.n}개 · 적중 ${P.model.agree === null ? '-' : pct(P.model.agree)}% · 일관성 ${pct(style.consistency)}%`,
    `비중(100%=강한 AI): ${style.items.filter((f) => STYLE_HELP[f.key]).map((f) => `${STYLE_HELP[f.key].name} ${pct(f.ratio)}%`).join(' / ')}`,
    `최근 대국: ${games.slice(0, 10).map((g) => `${g.place}등 ${g.score}`).join(', ') || '없음'}`,
    `저장된 실수 ${P.mistakes.length}개 (${Object.entries(bySkill).map(([k, n]) => `${SKILLS[k] ? SKILLS[k].ko : k} ${n}`).join(', ') || '없음'})`,
    ...P.mistakes.slice(0, 15).map((m) => `- [${SKILLS[m.skill] ? SKILLS[m.skill].ko : m.skill}] ${m.text}${m.hand ? ` | 손패 ${m.hand}` : ''}`),
  ].join('\n');
}

const STYLE_HELP = {
  shanten: {
    name: '샹텐 유지',
    desc: '텐파이까지 남은 거리(샹텐)를 늘리는 패는 버리지 않으려는 정도다.',
    low: '손을 뒤로 돌리는 타패가 잦은 편이다.',
    high: '역이나 수비보다 속도만 보는 편이다.',
  },
  accept: {
    name: '유효패 수',
    desc: '버린 뒤 손을 한 걸음 나아가게 하는 패(유효패)가 많이 남는 쪽을 고르는 정도다. 일샹텐에서는 받은 뒤 대기가 좋아지는지까지 본다. 패효율 그 자체다.',
    low: '받는 장수를 세지 않고 감으로 버리는 편이다.',
    high: '효율만 보고 도라나 역이 될 패를 가볍게 버리는 편이다.',
  },
  danger: {
    name: '위험 회피 · 텐파이 근처',
    desc: '내 손이 텐파이나 일샹텐일 때, 리치했거나 많이 운 상대에게 쏘일 만한 패를 피하는 정도다.',
    low: '좋은 손일 때도 위험한 패를 거침없이 내는 편이다.',
    high: '이길 수 있는 손도 일찍 접는 편이다.',
  },
  fold: {
    name: '위험 회피 · 밀 가치가 없을 때',
    desc: '리치를 받았는데 내 손이 멀거나, 싸거나, 대기가 나쁠 때 현물 같은 안전한 패로 접는 정도다. 수비의 핵심이다.',
    low: '가망 없는 손으로 끝까지 밀다가 쏘이기 쉬운 편이다.',
    high: '접기는 확실하지만, 너무 일찍 접어 기회를 놓치기도 한다.',
  },
  yakuhai: {
    name: '역패 쌍 지키기',
    desc: '백·발·중이나 내 바람·장의 바람 패를 2장 갖고 있을 때 버리지 않고 남기는 정도다. 한 장 더 오면(퐁) 바로 역이 된다.',
    low: '역이 될 패를 쉽게 버리는 편이다.',
    high: '역패 쌍에 매달려 효율을 잃는 편이다.',
  },
  dora: {
    name: '도라 지키기',
    desc: '도라(갖고 있으면 판수가 오르는 패)를 버리지 않으려는 정도다.',
    low: '도라를 쉽게 버려 점수를 깎는 편이다.',
    high: '도라에 매달려 손이 느려지는 편이다.',
  },
  value: {
    name: '손 점수 키우기',
    desc: '효율이 비슷하면 역(리치·탕야오·역패·혼일색)이나 도라가 살아남는 쪽을 고르는 정도다.',
    low: '점수가 될 재료를 쉽게 버리는 편이다.',
    high: '점수에 욕심을 내다 손이 느려지는 편이다.',
  },
  isolated: {
    name: '외톨이 끝패 먼저 버리기',
    desc: '이웃 패가 없는 1·9 수패나 자패 한 장을 초반에 먼저 정리하는 정도다.',
    low: '쓸모없는 끝패를 늦게까지 들고 있는 편이다.',
    high: '자패를 너무 빨리 버려 역패나 나중의 안전패를 잃는 편이다.',
  },
};

function renderMe() {
  const games = P.games;
  const avg = games.length ? (games.reduce((a, g) => a + g.place, 0) / games.length).toFixed(2) : '–';
  const style = styleReport(P.model);
  const SKILL_KO = Object.fromEntries(Object.entries(SKILLS).map(([k, v]) => [k, v.ko]));
  main.innerHTML = `
  <section class="panel">
    <h2>추정 실력 · ${rankName(P)}</h2>
    <div class="facts">
      <div class="fact"><small>AI 강도</small><b>${strengthLabel(P.delta)}</b></div>
      <div class="fact"><small>평균 순위 (${games.length}판)</small><b>${avg}</b></div>
      <div class="fact"><small>학습한 네 타패</small><b>${fmt(P.model.n)}개</b></div>
      <div class="fact"><small>모델이 네 타패를 맞힌 비율</small><b>${P.model.agree === null ? '–' : `${Math.round(P.model.agree * 100)}%`}</b></div>
    </div>
    <div class="row block"><button type="button" class="btn primary" data-act="export">사부에게 보낼 기록 복사</button></div>
    <p class="note" id="export-msg" aria-live="polite">대국 기록·숙련도·타패 성향·최근 실수를 글로 묶어 복사한다. 대화창에 붙여 넣으면 사부가 분석해 준다.</p>
    <textarea id="export-box" class="export" readonly hidden></textarea>
  </section>
  <section class="panel">
    <h2>기술별 숙련도</h2>
    <p class="lead">문제와 실전 판단 결과를 모아 추정한다. 최근 결과일수록 무겁게 본다.</p>
    ${skillsHTML(true)}
  </section>
  <section class="panel">
    <h2>AI가 배운 네 타패 성향</h2>
    <p class="lead">네가 패를 버릴 때마다, 그 순간 무엇을 중시했는지를 모델이 배운다. 상대 AI는 이 모델에서 출발해 강도만 조절한 것이다.</p>
    ${P.model.n < 300 ? `<p class="note">아직 학습한 타패가 ${fmt(P.model.n)}개라, 진단 결과로 넣은 시작값에 가깝다. 8~10판(타패 500개쯤)을 두면 네 성향이 드러난다.</p>` : ''}
    <div class="fact" style="margin-top:12px"><small>일관성</small><b>${Math.round(Math.min(1.5, style.consistency) * 100)}%</b>
      <p class="desc">비슷한 상황에서 얼마나 같은 기준으로 고르는지다. 100%면 강한 AI만큼 확실하게 고르고, 낮을수록 고르는 패가 들쭉날쭉하다.</p></div>
    <p class="note">아래 막대는 각 요소의 <b>비중</b>이다. 가운데 검은 선(100%)이 강한 AI의 비중이다. 선보다 짧으면 그 요소를 덜 따지고, 길면 더 따진다. 어느 쪽이든 선에서 멀수록 손해를 본다.</p>
    <ul class="style">${style.items.filter((f) => STYLE_HELP[f.key]).map((f) => {
      const h = STYLE_HELP[f.key];
      const pct = Math.max(0, Math.min(2, f.ratio)) / 2 * 100;
      const tag = f.ratio < 0.7 ? ['low', '덜 따진다'] : f.ratio > 1.3 ? ['high', '더 따진다'] : ['ok', '기준과 비슷'];
      const warn = tag[0] === 'low' ? h.low : tag[0] === 'high' ? h.high : '';
      return `<li><div class="head"><span>${h.name}</span><span class="tag ${tag[0]}">${tag[1]}</span></div>
        <div class="pair"><span class="track"><i style="width:${pct}%"></i><span class="goal" style="left:50%"></span></span><span class="v">${Math.round(f.ratio * 100)}%</span></div>
        <p class="desc">${h.desc}${warn ? ` <span class="warn">지금 너는 ${warn}</span>` : ''}</p></li>`;
    }).join('')}</ul>
  </section>
  <section class="panel">
    <h2>복기 노트</h2>
    <p class="lead">대국 중 틀린 판단이 자동으로 쌓인다.</p>
    <ul class="list">${P.mistakes.length ? P.mistakes.slice(0, 15).map((m) => `<li><span class="when">${new Date(m.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${SKILL_KO[m.skill] || ''}</span><br>${m.text}${m.hand ? `<div class="hand" style="padding-top:6px">${toList(parse(m.hand)).map((k) => t1(k)).join('')}</div>` : ''}</li>`).join('') : '<li>아직 없다. 한 판 두고 와라.</li>'}</ul>
  </section>
  <section class="panel">
    <h2>최근 대국</h2>
    <ul class="list">${games.length ? games.slice(0, 10).map((x) => `<li><span class="when">${new Date(x.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${x.rounds === 2 ? '반장전' : '동풍전'}</span><br>${x.place}등 · ${fmt(x.score)}점</li>`).join('') : '<li>기록이 없다.</li>'}</ul>
    <p class="block" style="margin-top:16px"><button type="button" class="link-btn" data-act="reset">기록과 학습 모델 지우기</button></p>
  </section>`;
}

// 화면 확인용 (주소에 ?test 가 있을 때만)
if (new URLSearchParams(location.search).has('test')) window.__dojo = { waitsQuiz, furitenQuiz, parse };

route();
