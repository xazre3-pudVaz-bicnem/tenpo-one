import { describe, it, expect } from 'vitest';
import { inPublishPeriod, popupQueue, POPUP_SNOOZE_MS, shouldShowPopup } from '@/lib/announcement-popup';

describe('重要なお知らせのポップアップ（2026-09-28 Ronnie「了解を押すまで時々出す」）', () => {
  const a = (id: string, from: string | null, to: string | null) => ({ id, title: id, body: '', publishFrom: from, publishTo: to });
  it('公開期間内で、まだ了解していないものだけ', () => {
    const rows = [a('now', '2026-09-28', '2026-10-05'), a('old', '2026-09-01', '2026-09-10'), a('read', null, null), a('future', '2026-10-01', null)];
    expect(popupQueue(rows, new Set(['read']), '2026-09-28').map((r) => r.id)).toEqual(['now']);
    expect(inPublishPeriod(a('x', null, null), '2026-09-28')).toBe(true);
  });
  it('「あとで」から10分は出さない。10分たったらまた出る。注文画面では出さない', () => {
    const now = 1_000_000;
    expect(shouldShowPopup({ queueLength: 1, snoozedUntil: null, now, pathname: '/app/dashboard' })).toBe(true);
    expect(shouldShowPopup({ queueLength: 1, snoozedUntil: now + POPUP_SNOOZE_MS, now, pathname: '/app/floor' })).toBe(false);
    expect(shouldShowPopup({ queueLength: 1, snoozedUntil: now, now: now + 1, pathname: '/app/floor' })).toBe(true);
    expect(shouldShowPopup({ queueLength: 1, snoozedUntil: null, now, pathname: '/app/pos' })).toBe(false);
    expect(shouldShowPopup({ queueLength: 0, snoozedUntil: null, now, pathname: '/app/dashboard' })).toBe(false);
    expect(POPUP_SNOOZE_MS).toBe(10 * 60 * 1000);
  });
});
