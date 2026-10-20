import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RESERVATION_STATUS } from '@/lib/reservations';

/**
 * 予約一覧で履歴を見る（2026-10-20 Ronnie「予約一覧で履歴をこのように見られるように。中のデータも押して見られるように」
 * 「店にいる＝来店済み、会計して終わった＝退店」）
 */
describe('予約一覧の履歴', () => {
  const page = readFileSync(new URL('../app/handy/reservations/page.tsx', import.meta.url), 'utf8');
  const list = readFileSync(new URL('../components/handy/handy-reservation-list.tsx', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('../components/handy/handy-reservation-detail.tsx', import.meta.url), 'utf8');

  it('状態の名前：来店済み・退店', () => {
    expect(RESERVATION_STATUS.arrived.label).toBe('来店済み');
    expect(RESERVATION_STATUS.completed.label).toBe('退店');
    expect(RESERVATION_STATUS.cancelled.label).toBe('キャンセル');
  });
  it('ウォークインも履歴に出す（店にいる・退店だけ。注文せずに戻った・取消は出さない）', () => {
    expect(page).toContain("const WALK_IN_HISTORY: ReadonlySet<string> = new Set(['seated', 'billing', 'completed']);");
    expect(page).toContain("(r) => r.created_via !== 'walk_in' || WALK_IN_HISTORY.has(r.status)");
    expect(page).not.toContain(".neq('created_via', 'walk_in')");
  });
  it('会計した金額・時刻・伝票番号を一覧と詳細に出す（別々会計は足す）', () => {
    expect(page).toContain("cur.total += o.total ?? 0;");
    expect(page).toContain(".in('status', ['open', 'paid'])");
    expect(list).toContain('会計 {yen(r.billTotal)}');
    expect(detail).toContain('<Row icon={Receipt} label="会計" strong>');
  });
});
