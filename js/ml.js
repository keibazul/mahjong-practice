// 학습 모듈
// 1) 타패 모방 모델: 후보 특징(ai.js)에 대한 다항 로지스틱 회귀를 네 타패로 온라인 학습한다.
// 2) 기술별 숙련도: 문제·실전 판단 결과를 베타 분포로 누적한다 (최근 기록에 무게).
// 3) 강도 조절: AI 가중치 = 네 모델 + δ × (강한 정책 − 네 모델). 성적에 따라 δ를 움직여 대등한 승부를 만든다.
import { FEATURES, STRONG, softmax, dot } from './ai.js';

export const SKILLS = {
  efficiency: { ko: '패효율', prior: [1, 2] },
  waits: { ko: '대기 읽기', prior: [3, 2] },
  furiten: { ko: '후리텐', prior: [1, 3] },
  yaku: { ko: '역 판단', prior: [3, 1] },
  scoring: { ko: '점수 계산', prior: [1, 3] },
  defense: { ko: '수비', prior: [3, 1.5] },
};

const SHARP = 3; // 강한 정책의 선명도
export const PRIOR_THETA = STRONG.map((w, i) => (i === 1 ? 0.6 : 1.2) * w);

export function initModel() {
  return { theta: PRIOR_THETA.slice(), n: 0, loss: null, agree: null };
}

export function initMastery() {
  const m = {};
  for (const [k, v] of Object.entries(SKILLS)) m[k] = { a: v.prior[0], b: v.prior[1], n: 0 };
  return m;
}

// 후보들(phi 포함)과 실제로 고른 번호로 한 걸음 학습
export function updateModel(model, cands, chosenIdx) {
  const th = model.theta;
  const p = softmax(cands.map((x) => dot(th, x.phi)));
  // 학습률과 규제는 가상의 사람 데이터에서 처음 보는 판단의 예측 오차가 가장 낮은 값으로 골랐다
  const lr = 0.5 / Math.sqrt(1 + model.n / 200);
  const l2 = 0.002;
  for (let i = 0; i < th.length; i++) {
    let g = cands[chosenIdx].phi[i];
    for (let k = 0; k < cands.length; k++) g -= p[k] * cands[k].phi[i];
    th[i] += lr * (g - l2 * (th[i] - PRIOR_THETA[i]));
  }
  const nll = -Math.log(Math.max(1e-6, p[chosenIdx]));
  model.loss = model.loss === null ? nll : model.loss * 0.97 + nll * 0.03;
  const predicted = p.indexOf(Math.max(...p));
  const hit = predicted === chosenIdx ? 1 : 0;
  model.agree = model.agree === null ? hit : model.agree * 0.97 + hit * 0.03;
  model.n += 1;
  return p;
}

// 네 모델이 이 후보들 중 무엇을 고를지 확률
export function predict(model, cands) {
  return softmax(cands.map((x) => dot(model.theta, x.phi)));
}

// AI 한 명의 가중치
export function aiTheta(model, delta) {
  const th = model.theta;
  if (delta >= 0) return th.map((w, i) => w + delta * (SHARP * STRONG[i] - w));
  return th.map((w) => (1 + delta) * w);
}

export function observe(mastery, skill, correct, weight = 1) {
  const s = mastery[skill];
  if (!s) return;
  s.a = Math.max(0.5, s.a * 0.96);
  s.b = Math.max(0.5, s.b * 0.96);
  if (correct) s.a += weight; else s.b += weight;
  s.n += 1;
}

export const level = (s) => s.a / (s.a + s.b);

export function weakest(mastery) {
  return Object.keys(SKILLS).sort((x, y) => level(mastery[x]) - level(mastery[y]));
}

// 강도 조절
export const DELTA_MIN = -0.6;
export const DELTA_MAX = 1.0;
const clampD = (d) => Math.max(DELTA_MIN, Math.min(DELTA_MAX, d));

export function afterHand(profile, before, after) {
  const me = after[0] - before[0];
  const opp = [1, 2, 3].map((s) => after[s] - before[s]);
  const r = Math.max(-1, Math.min(1, (me - opp.reduce((a, b) => a + b, 0) / 3) / 12000));
  profile.delta = clampD(profile.delta + 0.04 * r);
}

export function afterGame(profile, place) {
  profile.delta = clampD(profile.delta + 0.1 * ((2.5 - place) / 1.5));
}

// 사람이 읽을 실력 이름
export function rankName(profile) {
  const ms = Object.values(profile.mastery).map(level);
  const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
  const score = avg * 0.7 + ((profile.delta - DELTA_MIN) / (DELTA_MAX - DELTA_MIN)) * 0.3;
  if (score >= 0.8) return '고수';
  if (score >= 0.65) return '상급';
  if (score >= 0.5) return '중급';
  if (score >= 0.35) return '초급';
  return '입문';
}

// AI 강도를 사람 말로
export function strengthLabel(delta) {
  if (delta >= 0.7) return '너보다 확실히 강함';
  if (delta >= 0.35) return '너보다 조금 강함';
  if (delta >= 0.05) return '너와 비슷';
  if (delta >= -0.25) return '너보다 조금 약함';
  return '너보다 약함';
}

// 모델이 배운 성향
// - 비중: 네 가중치 전체에서 그 요소가 차지하는 몫을 강한 기준의 몫과 비교 (1 = 같은 비중)
// - 일관성: 가중치 크기를 강한 AI와 비교. 클수록 같은 상황에서 같은 패를 고른다
export function styleReport(model) {
  const norm = (v) => Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  const nu = norm(model.theta);
  const ns = norm(STRONG);
  return {
    consistency: nu / (SHARP * ns),
    items: FEATURES.map((f, i) => ({
      ...f,
      ratio: STRONG[i] ? (model.theta[i] / nu) / (STRONG[i] / ns) : 0,
    })),
  };
}
