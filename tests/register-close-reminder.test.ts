import { describe, expect, it } from 'vitest';
import { closeReminderHiddenOn, closeReminderText, topClerkName } from '@/lib/register-close-reminder';

/** レジクローズを忘れた店のポップアップ（2026-09-30 Ronnie「いちばんレジを担当した人の名前で」） */
describe('レジクローズのポップアップ', () => {
  it('いちばん多く会計した担当者（空・null は数えない、同じ件数なら先の人）', () => {
    expect(topClerkName(['田中', '佐藤', '田中', null, '', '佐藤', '田中'])).toEqual({ name: '田中', count: 3 });
    expect(topClerkName(['佐藤', '田中'])).toEqual({ name: '佐藤', count: 1 });
    expect(topClerkName([null, ' '])).toBeNull();
  });

  it('名前でよびかける・名前が無ければ名前なし', () => {
    const t = closeReminderText('continuing', '2026-09-30', 'ラム');
    expect(t.title).toBe('ラムさん、レジクローズがまだです');
    expect(t.body).toContain('9/30 の営業日のレジが閉まっていません');
    expect(closeReminderText('continuing', '2026-09-30', null).title).toBe('レジクローズがまだです');
    expect(closeReminderText('stale', '2026-09-28', 'ラム').body).toContain('9/28 から開いたままのレジ');
  });

  it('注文画面・レジクローズ／開局の画面では出さない', () => {
    expect(closeReminderHiddenOn('/app/pos')).toBe(true);
    expect(closeReminderHiddenOn('/app/cash/close')).toBe(true);
    expect(closeReminderHiddenOn('/app/cash/open')).toBe(true);
    expect(closeReminderHiddenOn('/app/dashboard')).toBe(false);
    expect(closeReminderHiddenOn('/app/cash')).toBe(false);
  });
});
