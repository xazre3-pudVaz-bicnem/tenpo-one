/** 前期間比（増減率）の計算。金額・件数などスカラー値の比較に使う汎用ロジック */

export interface Delta {
  /** 増減率（%）。前期間が0で今期間も0以外の場合は比較不能として null */
  pct: number | null;
  direction: 'up' | 'down' | 'flat';
}

export function calcDelta(current: number, previous: number): Delta {
  if (previous === 0) {
    if (current === 0) return { pct: 0, direction: 'flat' };
    return { pct: null, direction: 'up' };
  }
  const pct = ((current - previous) / previous) * 100;
  const direction = pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat';
  return { pct, direction };
}

/** 急増判定（前期間比 multiplier 倍超）。前期間が0の場合は基準なしとして false */
export function isSpike(current: number, previous: number, multiplier: number): boolean {
  return previous > 0 && current > previous * multiplier;
}
