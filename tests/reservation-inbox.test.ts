import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { unreadCount } from '@/components/reservations/inbox/inbox-seen';

/**
 * 予約受付管理・メッセージ（2026-10-19 Ronnie「予約の画面の上のタブに。サイドメニューではなく」
 * 「受付管理は全部」「メッセージは新しい予約・変更・キャンセルのお知らせが来る箱」）。
 */
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('予約受付管理・メッセージ', () => {
  const ui = read('components/reservations/inbox/reservation-inbox.tsx');
  const loader = read('lib/reservation-inbox-server.ts');
  const handy = read('app/handy/reservations/page.tsx');
  const ledger = read('app/app/reservations/page.tsx');
  const actions = read('app/app/reservations/actions.ts');
  const sql = read('supabase/migrations/00100_reservation_acknowledged.sql');

  it('タブは予約の画面の上（ハンディ・レジ/PC の両方）。サイドメニューには足さない', () => {
    expect(ui).toContain("label: '受付管理'");
    expect(ui).toContain("label: 'メッセージ'");
    expect(handy).toContain('<ReservationInboxTabs');
    expect(handy).toContain("inbox: '/handy/reservations?tab=inbox'");
    expect(handy).toContain("messages: '/handy/reservations?tab=messages'");
    expect(ledger).toContain('<ReservationInboxTabs');
    expect(ledger).toContain("inbox: '/app/reservations?view=inbox'");
    expect(ledger).toContain("messages: '/app/reservations?view=messages'");
  });

  it('受付管理は全部：仮予約・要連絡・新しいネット予約・変更キャンセル・グルメサイト要確認', () => {
    for (const label of ['仮予約', '要連絡', '新しいネット予約', '変更・キャンセル', 'グルメサイト 要確認']) {
      expect(ui).toContain(`label: '${label}'`);
    }
    expect(loader).toContain(".eq('status', 'pending')");
    expect(loader).toContain('.contains(\'tags\', [NEEDS_CONTACT_TAG])');
    expect(loader).toContain("m.status === 'needs_review'");
    expect(loader).toContain("m.status === 'updated' || m.status === 'cancelled'");
  });

  it('ボタン：確定する・連絡済み・確認済み・対応済み（サーバーの処理につながる）', () => {
    expect(ui).toContain("label: '確定する'");
    expect(ui).toContain("label: '連絡済み'");
    expect(ui).toContain("label: '確認済み'");
    expect(ui).toContain("label: '対応済み'");
    for (const fn of ['confirmPendingReservation', 'markReservationContacted', 'acknowledgeReservation', 'resolveInboxImport']) {
      expect(actions).toContain(`export async function ${fn}(`);
    }
  });

  it('メッセージは新規・変更・キャンセル。開くと既読（端末ごと）、新着に印', () => {
    expect(ui).toContain("label: '新規'");
    expect(ui).toContain("label: '変更'");
    expect(ui).toContain("label: 'キャンセル'");
    expect(ui).toContain('markInboxSeen(storeId, latest)');
    expect(ui).toContain('新着');
  });

  it('ウォークインが帰ったのはキャンセルではなく「退店」（2026-10-20 Ronnie）', () => {
    expect(loader).toContain("const walkIn = r.created_via === 'walk_in';");
    expect(loader).toContain("kind: walkIn ? 'left' : 'cancel'");
    expect(loader).toContain('`退店　${r.guest_name} 様`');
    expect(ui).toContain("left: { icon: LogOut, label: '退店'");
  });

  it('00100：acknowledged_at を足し、今までの予約は確認済みにする（列が無くても画面は出る）', () => {
    expect(sql).toContain('add column if not exists acknowledged_at timestamptz');
    expect(sql).toContain('where acknowledged_at is null');
    expect(loader).toContain('const canAcknowledge = !ackErr');
  });

  it('未読の数：読んだ時刻より新しいものだけ。初めての端末は24時間分。サーバーでは0', () => {
    const now = Date.parse('2026-10-19T12:00:00Z');
    const times = ['2026-10-19T11:00:00Z', '2026-10-18T13:00:00Z', '2026-10-17T10:00:00Z'];
    expect(unreadCount(times, '2026-10-19T10:00:00Z', now)).toBe(1);
    expect(unreadCount(times, null, now)).toBe(2);
    expect(unreadCount(times, undefined, now)).toBe(0);
  });
});
