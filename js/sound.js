// 효과음: 음원 파일 없이 Web Audio로 그 자리에서 합성한다.
// SFX의 각 함수는 (오디오 컨텍스트, 출력 노드, 시작 시각, ...)을 받아 소리를 예약한다.

const LEVEL = { off: 0, low: 0.35, mid: 0.7, high: 1 };
let ctx = null;
let master = null;
let level = LEVEL.mid;

const noiseCache = new WeakMap();
function noise(ac) {
  if (noiseCache.has(ac)) return noiseCache.get(ac);
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseCache.set(ac, buf);
  return buf;
}

function env(g, t, attack, peak, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function burst(ac, out, t, { f = 3000, q = 1, dur = 0.05, gain = 0.5, type = 'bandpass' } = {}) {
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const flt = ac.createBiquadFilter();
  flt.type = type;
  flt.frequency.value = f;
  flt.Q.value = q;
  const g = ac.createGain();
  env(g, t, 0.002, gain, dur);
  src.connect(flt);
  flt.connect(g);
  g.connect(out);
  src.start(t, Math.random() * 0.3);
  src.stop(t + dur + 0.05);
}

function tone(ac, out, t, { f, f2 = f, type = 'sine', dur = 0.2, gain = 0.3, attack = 0.005, lp = 0 } = {}) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, t + attack + dur);
  const g = ac.createGain();
  env(g, t, attack, gain, dur);
  let node = o;
  if (lp) {
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = lp;
    o.connect(flt);
    node = flt;
  }
  node.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + attack + dur + 0.05);
}

const jitter = (x, p = 0.08) => x * (1 + (Math.random() * 2 - 1) * p);

function gong(ac, out, t, base, len = 1.8, gain = 0.32) {
  const parts = [[1, 1], [2.0, 0.55], [2.76, 0.42], [4.07, 0.22], [5.4, 0.14]];
  for (const [m, a] of parts) tone(ac, out, t, { f: base * m, dur: len * (1.1 - m * 0.08), gain: gain * a, attack: 0.004 });
  burst(ac, out, t, { f: 500, q: 0.7, dur: 0.08, gain: 0.35, type: 'lowpass' });
}

function notes(ac, out, t, list, { step = 0.09, dur = 0.45, gain = 0.16, type = 'triangle' } = {}) {
  list.forEach((f, i) => tone(ac, out, t + i * step, { f, type, dur, gain }));
}

export const SFX = {
  // 패가 탁자에 닿는 딸깍 소리
  clack(ac, out, t, strength = 1) {
    burst(ac, out, t, { f: jitter(3300), q: 1.4, dur: 0.045, gain: 0.5 * strength });
    burst(ac, out, t, { f: jitter(1300), q: 2.4, dur: 0.07, gain: 0.32 * strength });
    tone(ac, out, t, { f: jitter(950), f2: 520, type: 'triangle', dur: 0.06, gain: 0.2 * strength });
  },
  discard(ac, out, t) { SFX.clack(ac, out, t, 1); },
  draw(ac, out, t) {
    burst(ac, out, t, { f: 5200, q: 2, dur: 0.025, gain: 0.22 });
    burst(ac, out, t + 0.03, { f: 2600, q: 2, dur: 0.03, gain: 0.16 });
  },
  select(ac, out, t) {
    burst(ac, out, t, { f: 4300, q: 3, dur: 0.02, gain: 0.3 });
  },
  call(ac, out, t, kind = 'pon') {
    const n = kind === 'kan' ? 4 : 3;
    for (let i = 0; i < n; i++) SFX.clack(ac, out, t + i * 0.06, 1.15);
    const f = kind === 'chi' ? 587 : kind === 'kan' ? 440 : 523;
    tone(ac, out, t + n * 0.06 + 0.02, { f, f2: f * 1.5, type: 'triangle', dur: 0.16, gain: 0.2 });
  },
  riichi(ac, out, t) {
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.32);
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(500, t);
    flt.frequency.exponentialRampToValueAtTime(3200, t + 0.32);
    const g = ac.createGain();
    env(g, t, 0.15, 0.13, 0.2);
    o.connect(flt);
    flt.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.45);
    tone(ac, out, t + 0.3, { f: 2637, dur: 0.6, gain: 0.12 });
    tone(ac, out, t + 0.3, { f: 3951, dur: 0.4, gain: 0.06 });
    SFX.clack(ac, out, t + 0.32, 1.4);
  },
  // mood: 'me' 내 화료, 'dealtIn' 내가 쏘임, 'other' 남의 화료
  win(ac, out, t, mood = 'other') {
    if (mood === 'dealtIn') {
      gong(ac, out, t, 73, 1.6, 0.3);
      notes(ac, out, t + 0.25, [392, 311, 262], { step: 0.22, dur: 0.6, gain: 0.14 });
      return;
    }
    gong(ac, out, t, 98, mood === 'me' ? 2.2 : 1.4, mood === 'me' ? 0.34 : 0.24);
    if (mood === 'me') {
      notes(ac, out, t + 0.18, [523, 659, 784, 1047], { step: 0.09, dur: 0.6, gain: 0.17 });
      notes(ac, out, t + 0.6, [1568, 2093], { step: 0.07, dur: 0.5, gain: 0.07, type: 'sine' });
    } else {
      notes(ac, out, t + 0.18, [392, 523], { step: 0.12, dur: 0.4, gain: 0.12 });
    }
  },
  ryuukyoku(ac, out, t) {
    notes(ac, out, t, [523, 440, 392], { step: 0.22, dur: 0.5, gain: 0.13, type: 'sine' });
  },
  good(ac, out, t) {
    tone(ac, out, t, { f: 1047, dur: 0.35, gain: 0.12 });
    tone(ac, out, t + 0.08, { f: 1568, dur: 0.45, gain: 0.1 });
  },
  bad(ac, out, t) {
    tone(ac, out, t, { f: 233, f2: 207, type: 'triangle', dur: 0.16, gain: 0.18, lp: 1200 });
    tone(ac, out, t + 0.17, { f: 196, f2: 175, type: 'triangle', dur: 0.24, gain: 0.18, lp: 1200 });
  },
  alert(ac, out, t) {
    tone(ac, out, t, { f: 880, dur: 0.12, gain: 0.11 });
    tone(ac, out, t + 0.1, { f: 1175, dur: 0.18, gain: 0.11 });
  },
  gameEnd(ac, out, t, place = 2) {
    if (place === 1) {
      const chords = [[523, 659, 784], [587, 740, 880], [659, 831, 988], [784, 988, 1175, 1568]];
      chords.forEach((c, i) => c.forEach((f) => tone(ac, out, t + i * 0.18, { f, type: 'sawtooth', dur: i === 3 ? 1.1 : 0.2, gain: 0.06, lp: 2400 })));
      gong(ac, out, t + 0.54, 131, 1.6, 0.2);
    } else if (place === 4) {
      notes(ac, out, t, [392, 370, 349, 330], { step: 0.32, dur: 0.5, gain: 0.13, type: 'sawtooth' });
    } else {
      notes(ac, out, t, [392, 523, 659], { step: 0.12, dur: 0.6, gain: 0.14 });
    }
  },
};

// ---- 실제 재생 ----
export function configure(setting) {
  level = LEVEL[setting] ?? LEVEL.mid;
  if (master) master.gain.value = level;
}

// 첫 터치·클릭 때 불러야 모바일에서 소리가 난다
export function unlock() {
  if (!level || typeof window === 'undefined') return;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = level;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* 소리를 못 내는 환경 */ }
}

function play(fn, ...args) {
  if (!level) return;
  unlock();
  if (!ctx) return;
  try { fn(ctx, master, ctx.currentTime + 0.01, ...args); } catch { /* 무시 */ }
}

export const sfx = Object.fromEntries(Object.keys(SFX).map((k) => [k, (...a) => play(SFX[k], ...a)]));
