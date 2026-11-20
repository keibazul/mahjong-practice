// 점수 계산: 부·판 → 점수 (절상만관 없음)

export const ceil100 = (x) => Math.ceil(x / 100) * 100;

export function limitName(han, fu) {
  if (han >= 13) return '역만';
  if (han >= 11) return '삼배만';
  if (han >= 8) return '배만';
  if (han >= 6) return '하네만';
  if (han >= 5 || fu * 2 ** (han + 2) >= 2000) return '만관';
  return '';
}

export function basePoints(fu, han) {
  if (han >= 13) return 8000;
  if (han >= 11) return 6000;
  if (han >= 8) return 4000;
  if (han >= 6) return 3000;
  if (han >= 5) return 2000;
  return Math.min(2000, fu * 2 ** (han + 2));
}

// 받는 총점과 지불 내역
export function points({ fu, han, dealer, tsumo }) {
  const b = basePoints(fu, han);
  if (!tsumo) {
    const v = ceil100(b * (dealer ? 6 : 4));
    return { total: v, label: v.toLocaleString('ko-KR') };
  }
  if (dealer) {
    const each = ceil100(b * 2);
    return { total: each * 3, label: `${each.toLocaleString('ko-KR')} 올` };
  }
  const fromDealer = ceil100(b * 2);
  const fromOthers = ceil100(b);
  return {
    total: fromDealer + fromOthers * 2,
    label: `${fromOthers.toLocaleString('ko-KR')} / ${fromDealer.toLocaleString('ko-KR')}`,
  };
}

// 실제로 나올 수 있는 부·판 조합인지
export function validCombo({ fu, han, tsumo }) {
  if (fu === 20) return tsumo && han >= 2; // 핑후 쯔모
  if (fu === 25) return han >= (tsumo ? 3 : 2); // 칠대자
  return han >= 1;
}

// 부수 부품 문제용 표
export const MELD_FU = {
  // [중장패, 요구패]
  '밝은 커쯔': [2, 4],
  '암각': [4, 8],
  '밝은 깡': [8, 16],
  '암깡': [16, 32],
};
