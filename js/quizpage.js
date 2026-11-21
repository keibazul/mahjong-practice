// 퀴즈 모드 화면
import { tileHTML } from './tiles.js';
import { tileName } from './engine.js';
import { kindOf } from './game.js';
import { SKILLS, level, observe } from './ml.js';
import { load, save, addMistake } from './store.js';
import { sfx } from './sound.js';
import {
  CATS, harvest, buildQuestions, planCategories, needFor,
} from './quiz.js';

const N = 10;
let Q = { phase: 'setup', mode: 'mix' };
let root = null;

const t1 = (k, cls = '') => tileHTML(k, { cls });
const row = (kinds, cls = '') => `<span class="mini">${kinds.map((k) => t1(k, cls)).join('')}</span>`;

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

function weightsFromMastery(P) {
  const w = {};
  for (const [k, c] of Object.entries(CATS)) w[k] = 0.12 + (1 - level(P.mastery[c.skill]));
  return w;
}

async function start() {
  const P = load();
  Q = { phase: 'loading', mode: Q.mode, progress: 0 };
  draw();
  const rng = Math.random;
  const plan = planCategories(Q.mode, weightsFromMastery(P), N, rng);
  const pool = await harvest(needFor(plan), {
    seed: Math.floor(rng() * 2 ** 31),
    maxGames: 5,
    onProgress: (g) => { Q.progress = g; draw(); },
    yieldFn: () => new Promise((r) => { setTimeout(r, 0); }),
  });
  const questions = buildQuestions(plan, pool, { showFu: level(P.mastery.scoring) < 0.55, rng });
  const before = Object.fromEntries(Object.keys(SKILLS).map((k) => [k, level(P.mastery[k])]));
  Q = { phase: 'question', mode: Q.mode, questions, i: 0, results: [], before, sel: null, picked: new Set(), answered: null };
  draw();
}

function answer(given) {
  const q = Q.questions[Q.i];
  if (Q.answered) return;
  let ok;
  if (q.kind === 'choice') ok = given === q.answer;
  if (q.kind === 'tile') ok = q.judge(given);
  if (q.kind === 'tiles') ok = given.length === q.answerSet.length && q.answerSet.every((k) => given.includes(k));
  Q.answered = { given, ok };
  Q.results.push({ cat: q.cat, ok });
  const P = load();
  observe(P.mastery, CATS[q.cat].skill, ok, 1);
  if (!ok) {
    let text = q.mistake;
    if (q.kind === 'tile') text = q.mistakeFor(given);
    if (q.kind === 'tiles') text = q.mistakeFor(given);
    addMistake({ skill: CATS[q.cat].skill, text: `[퀴즈] ${text}` });
  }
  save();
  if (ok) sfx.good(); else sfx.bad();
  draw();
}

function questionHTML(q) {
  const a = Q.answered;
  let body = '';
  const chips = (q.chips || []).map((c) => `<span class="chip">${c}</span>`).join('');
  if (q.dora) body += `<p class="k">도라 표시패 ${row(q.dora)}${q.ura && q.ura.length ? ` · 뒷도라 표시패 ${row(q.ura)}` : ''}</p>`;
  if (q.river) {
    body += `<div class="block"><p class="k">리치한 사람의 버림패 (옆으로 누운 패가 리치 선언패)</p><span class="mini">${q.river.map((d) => t1(d.k, d.riichi ? 'side' : '')).join('')}</span></div>`;
    if (q.after && q.after.length) body += `<div class="block"><p class="k">리치 뒤 다른 사람이 버린 패 (이것도 안전하다)</p>${row(q.after)}</div>`;
    if (q.seen && q.seen.length) body += `<p class="k">판에 보이는 자패 (네 손 포함): ${q.seen.map((x) => `${tileName(x.k)} ${x.n}장`).join(' · ')}</p>`;
  }
  if (q.ownRiver) body += `<div class="block"><p class="k">네 버림패</p>${row(q.ownRiver)}</div>`;

  if (q.kind === 'tile') {
    const ids = q.handIds.slice().sort((x, y) => x - y);
    const drawn = q.drawn !== null && q.drawn !== undefined && ids.includes(q.drawn) ? q.drawn : null;
    const rest = drawn === null ? ids : ids.filter((x) => x !== drawn);
    const btn = (id) => {
      const k = kindOf(id);
      let cls = '';
      if (a) cls = q.answerTiles.includes(k) ? 'hit' : (a.given === k ? 'mark' : '');
      return tileHTML(k, { button: true, cls, attrs: `data-quiz="tile" data-id="${id}" data-k="${k}" ${a ? 'disabled' : ''}` })
        .replace('aria-pressed="false"', `aria-pressed="${!a && Q.sel === id}"`);
    };
    body += `<div class="block"><p class="k">네 손패 · 한 번 눌러 들고, 한 번 더 누르면 답한다</p><div class="hand quiz-hand ${a ? 'done' : ''}">${rest.map(btn).join('')}${drawn !== null ? `<span class="sp"></span>${btn(drawn)}` : ''}</div></div>`;
  } else if (q.hand) {
    body += `<div class="block"><p class="k">${q.winTile !== undefined ? '화료한 손' : '네 손패'}</p><div class="hand">${q.hand.map((k) => t1(k)).join('')}${q.winTile !== undefined ? `<span class="sp"></span>${t1(q.winTile, 'hit')}` : ''}</div>${q.melds && q.melds.length ? `<div class="mymelds" style="justify-content:flex-start">${q.melds.map(meldHTML).join('')}</div>` : ''}</div>`;
  }

  if (q.kind === 'choice') {
    body += `<div class="choices">${q.choices.map((c) => {
      let cls = '';
      if (a) cls = c === q.answer ? 'right' : (c === a.given ? 'wrong' : '');
      return `<button type="button" class="choice ${cls}" data-quiz="choice" data-v="${c}" ${a ? 'disabled' : ''}>${c}</button>`;
    }).join('')}</div>`;
  }
  if (q.kind === 'tiles') {
    const suits = new Set(q.hand.map((k) => (k < 27 ? Math.floor(k / 9) : 3)));
    const rows = [...suits].sort().map((s) => (s < 3 ? Array.from({ length: 9 }, (_, i) => s * 9 + i) : [27, 28, 29, 30, 31, 32, 33]));
    body += `<div class="picker ${a ? 'done' : ''}">${rows.flat().map((k) => {
      let cls = '';
      if (a) cls = q.answerSet.includes(k) ? 'hit' : (Q.picked.has(k) ? 'mark' : 'dim');
      return tileHTML(k, { button: true, cls, attrs: `data-quiz="pick" data-k="${k}" ${a ? 'disabled' : ''}` })
        .replace('aria-pressed="false"', `aria-pressed="${!a && Q.picked.has(k)}"`);
    }).join('')}</div>`;
    if (!a) body += `<p class="err" id="qerr"></p><div class="row block"><button type="button" class="btn primary" data-quiz="check">확인</button></div>`;
  }

  let after = '';
  if (a) {
    const table = q.table ? `<ul class="yaku">${q.table.map((r) => `<li><span>${t1(r.t)} ${tileName(r.t)}</span><span>${r.text}</span></li>`).join('')}</ul>` : '';
    after = `<div class="verdict ${a.ok ? 'ok' : 'ng'}"><b>${a.ok ? '맞다' : '틀렸다'}</b> · ${q.explain}</div>${table}
      <div class="row block"><button type="button" class="btn primary" data-quiz="next">${Q.i + 1 < Q.questions.length ? '다음 문제' : '결과 보기'}</button></div>`;
  }
  return `<p class="qmeta">${Q.i + 1} / ${Q.questions.length} · ${CATS[q.cat].ko}</p>
    <h2 class="qtitle">${q.prompt}</h2>
    <div class="chips">${chips}</div>
    ${body}${after}`;
}

function summaryHTML() {
  const P = load();
  const ok = Q.results.filter((r) => r.ok).length;
  const byCat = {};
  for (const r of Q.results) {
    byCat[r.cat] = byCat[r.cat] || { n: 0, ok: 0 };
    byCat[r.cat].n += 1;
    if (r.ok) byCat[r.cat].ok += 1;
  }
  const line = ok >= 9 ? '훌륭하다. 이 정도면 실전에서도 흔들리지 않는다.' : ok >= 6 ? '나쁘지 않다. 틀린 것만 다시 보자.' : '아직 멀었다. 틀린 문제는 복기 노트에 적어 뒀다.';
  const skills = Object.keys(SKILLS).map((k) => {
    const now = level(P.mastery[k]);
    const diff = Math.round((now - Q.before[k]) * 100);
    return `<li><span>${SKILLS[k].ko}</span><span class="bar"><i style="width:${Math.round(now * 100)}%"></i></span><span class="pct">${diff > 0 ? `+${diff}` : diff}</span></li>`;
  }).join('');
  return `<h2>${ok} / ${Q.results.length} 정답</h2><p class="lead">${line}</p>
    <ul class="list">${Object.entries(byCat).map(([c, v]) => `<li>${CATS[c].ko} · ${v.ok} / ${v.n}</li>`).join('')}</ul>
    <div class="block"><p class="k">숙련도 변화 (%p)</p><ul class="skills">${skills}</ul></div>
    <div class="row block"><button type="button" class="btn primary" data-quiz="again">한 번 더</button><button type="button" class="btn" data-quiz="setup">종류 바꾸기</button></div>`;
}

function setupHTML() {
  const opts = [['mix', '약점 위주 (추천)'], ...Object.entries(CATS).map(([k, v]) => [k, v.ko])];
  return `<h2>퀴즈 모드</h2>
    <p class="lead">AI 넷이 실제로 한 판 두는 동안 나온 장면으로 ${N}문제를 만든다. 매번 다른 문제가 나온다. 결과는 숙련도와 복기 노트에 반영된다.</p>
    <p class="opt-label" style="margin-top:14px">종류</p>
    <div class="choose quiz-choose">${opts.map(([v, l]) => `<button type="button" data-quiz="mode" data-v="${v}" aria-pressed="${Q.mode === v}">${l}</button>`).join('')}</div>
    <div class="row block"><button type="button" class="btn primary" data-quiz="start">시작</button></div>`;
}

function draw() {
  if (!root || !location.hash.startsWith('#/quiz')) return;
  let html = '';
  if (Q.phase === 'setup') html = setupHTML();
  if (Q.phase === 'loading') html = `<h2>문제를 만드는 중</h2><p class="lead">AI 넷이 한 판 두면서 장면을 모으고 있다${Q.progress ? ` (${Q.progress}판째)` : ''}.</p>`;
  if (Q.phase === 'question') html = questionHTML(Q.questions[Q.i]);
  if (Q.phase === 'done') html = summaryHTML();
  root.innerHTML = `<section class="panel quiz" data-quiz-root>${html}</section>`;
}

function onClick(e) {
  if (!location.hash.startsWith('#/quiz')) return;
  const el = e.target.closest('[data-quiz]');
  if (!el || el.disabled) return;
  const a = el.dataset.quiz;
  if (a === 'mode') { Q.mode = el.dataset.v; draw(); return; }
  if (a === 'start' || a === 'again') { start(); return; }
  if (a === 'setup') { Q = { phase: 'setup', mode: Q.mode }; draw(); return; }
  if (Q.phase !== 'question') return;
  if (a === 'choice') answer(el.dataset.v);
  if (a === 'tile') {
    const id = Number(el.dataset.id);
    if (Q.sel === id) answer(Number(el.dataset.k));
    else { Q.sel = id; sfx.select(); draw(); }
  }
  if (a === 'pick') {
    const k = Number(el.dataset.k);
    if (Q.picked.has(k)) Q.picked.delete(k); else Q.picked.add(k);
    sfx.select();
    draw();
  }
  if (a === 'check') {
    if (!Q.picked.size) { const err = document.getElementById('qerr'); if (err) err.textContent = '대기패를 하나 이상 골라라.'; return; }
    answer([...Q.picked].sort((x, y) => x - y));
  }
  if (a === 'next') {
    if (Q.i + 1 < Q.questions.length) {
      Q.i += 1;
      Q.sel = null;
      Q.picked = new Set();
      Q.answered = null;
    } else Q.phase = 'done';
    draw();
    window.scrollTo(0, 0);
  }
}

export function renderQuiz(main) {
  if (!root) main.addEventListener('click', onClick);
  root = main;
  if (Q.phase === 'loading') { draw(); return; }
  draw();
}
