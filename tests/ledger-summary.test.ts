import { describe, expect, it } from 'vitest';
import { summarizeLedgerDay } from '@/lib/ledger-summary';

describe('summarizeLedgerDay（店舗台帳・店舗ナウの本日の集計）', () => {
  it('来店済み・退店・来店待ち・キャンセル・当日予約', () => {
    const day = '2026-10-24';
    const s = summarizeLedgerDay(
      [
        { status: 'seated', party_size: 4, created_at: '2026-10-20T03:00:00Z', created_via: 'phone' },
        { status: 'completed', party_size: 2, created_at: '2026-10-24T01:00:00Z', created_via: 'phone' },
        { status: 'confirmed', party_size: 3, created_at: '2026-10-21T01:00:00Z', created_via: 'web', reservation_tables: [] },
        { status: 'cancelled', party_size: 5, created_at: '2026-10-21T01:00:00Z', created_via: 'web' },
        { status: 'arrived', party_size: 2, created_at: '2026-10-24T05:00:00Z', created_via: 'walk_in' },
      ],
      day
    );
    expect(s).toMatchObject({ count: 4, guests: 11, inCount: 2, outCount: 1, waitingCount: 1, cancelled: 1, sameDayCount: 1, sameDayGuests: 2, unseated: 1 });
  });
});
