// 이 기기의 브라우저에 기록을 남긴다. 저장소를 못 쓰는 환경이면 메모리에만 둔다.
import { initModel, initMastery, migrateModel } from './ml.js';

const KEY = 'jaksa-dojo-v2';
let mem = null;

export function blankProfile() {
  return {
    version: 2,
    model: initModel(),
    mastery: initMastery(),
    delta: 0.25,
    games: [],
    hands: 0,
    mistakes: [],
    settings: { rounds: 1, coach: 'auto', speed: 'normal', calls: true, sound: 'mid' },
  };
}

export function load() {
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      const b = blankProfile();
      mem = { ...b, ...p, settings: { ...b.settings, ...(p.settings || {}) }, mastery: { ...b.mastery, ...(p.mastery || {}) } };
      mem.model = migrateModel(mem.model);
    } else mem = blankProfile();
  } catch {
    mem = blankProfile();
  }
  return mem;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* 저장 불가 환경 */ }
}

export function reset() {
  mem = blankProfile();
  save();
  return mem;
}

export function addMistake(entry) {
  const p = load();
  p.mistakes.unshift({ at: Date.now(), ...entry });
  p.mistakes = p.mistakes.slice(0, 40);
  save();
}
