import { describe, it, expect } from 'vitest';
import { actualSpan, hm } from '@/components/reservations/schedule-board';
import { earliestOpenedAt, latestClosedAt } from '@/components/reservations/row-mapper';

/**
 * 店舗台帳のバー＝実際の滞在（2026-10-05 Ronnie「お客様同士がつながって見える。会計したら同じ時刻で退店。
 * 入った時間と出た時間がはっきり分かるように」）
 */
describe('actualSpan（バーの位置）', () => {
  const planned = { s: 11 * 60 + 56, e: 13 * 60 + 56 }; // 11:56〜13:56（予定）

  it('退店（会計済み）は 入店〜会計した時刻。予定の終了まで伸ばさない', () => {
    const sp = actualSpan('out', planned, 12 * 60 + 16, 13 * 60 + 10);
    expect([hm(sp.s), hm(sp.e)]).toEqual(['12:16', '13:10']);
    expect(sp.inAt).toBe(12 * 60 + 16);
    expect(sp.outAt).toBe(13 * 60 + 10);
  });

  it('来店中・会計中は 入店〜予定の終了（退店はまだ無い）', () => {
    const sp = actualSpan('in', planned, 12 * 60 + 16, null);
    expect([hm(sp.s), hm(sp.e)]).toEqual(['12:16', '13:56']);
    expect(sp.outAt).toBeNull();
    expect(actualSpan('pay', planned, 12 * 60 + 16, null).e).toBe(planned.e);
  });

  it('来店前（予約・仮）は予定どおり。入店・退店の時刻は出さない', () => {
    for (const kind of ['wait', 'tentative', 'arrived', 'unset'] as const) {
      const sp = actualSpan(kind, planned, 12 * 60, 13 * 60);
      expect([sp.s, sp.e]).toEqual([planned.s, planned.e]);
      expect(sp.inAt).toBeNull();
      expect(sp.outAt).toBeNull();
    }
  });

  it('入店の記録が無い退店は 予定の開始〜会計した時刻', () => {
    const sp = actualSpan('out', planned, null, 13 * 60 + 10);
    expect([hm(sp.s), hm(sp.e)]).toEqual(['11:56', '13:10']);
  });

  it('退店が入店より前に見えるときは最低10分の幅', () => {
    const sp = actualSpan('out', planned, 13 * 60, 12 * 60 + 50);
    expect(sp.e - sp.s).toBe(10);
  });
});

describe('入店・退店の時刻（伝票から）', () => {
  it('入店＝最初に開いた伝票、退店＝最後に会計した伝票', () => {
    const orders = [
      { opened_at: '2026-10-05T03:16:00Z', closed_at: '2026-10-05T04:10:00Z' },
      { opened_at: '2026-10-05T03:40:00Z', closed_at: '2026-10-05T04:30:00Z' },
      { opened_at: '2026-10-05T03:50:00Z', closed_at: null },
    ];
    expect(earliestOpenedAt(orders)).toBe('2026-10-05T03:16:00Z');
    expect(latestClosedAt(orders)).toBe('2026-10-05T04:30:00Z');
    expect(earliestOpenedAt([])).toBeNull();
    expect(earliestOpenedAt(null)).toBeNull();
  });
});
