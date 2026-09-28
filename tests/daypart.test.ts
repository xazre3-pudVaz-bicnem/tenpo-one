import { describe, it, expect } from 'vitest';
import { daypartSettingsFrom, guestGenderFromMemo, splitDaypart, DEFAULT_LUNCH_UNTIL } from '@/lib/daypart';
import { layoutRegisterReport, type RegisterReportData } from '@/lib/register-report';

describe('ランチ売上／ディナー売上（2026-09-28 Ronnie「3時までのオーダーがランチ、3時1分からディナー」）', () => {
  it('設定が無ければ 15:00。形の違う値は捨てる', () => {
    expect(daypartSettingsFrom(null).lunchUntil).toBe(DEFAULT_LUNCH_UNTIL);
    expect(daypartSettingsFrom({ registerReport: { lunchUntil: '14:30' } }).lunchUntil).toBe('14:30');
    expect(daypartSettingsFrom({ registerReport: { lunchUntil: '3時' } }).lunchUntil).toBe('15:00');
  });

  it('区切りまで（含む）がランチ、1分後からディナー。日付をまたいだ深夜の伝票はディナー', () => {
    // JST 15:00 = UTC 06:00
    const r = splitDaypart(
      [
        { openedAt: '2026-09-27T03:10:00Z', total: 3000, guests: 2 }, // 12:10 ランチ
        { openedAt: '2026-09-27T06:00:00Z', total: 2000, guests: 1 }, // 15:00 ランチ（含む）
        { openedAt: '2026-09-27T06:01:00Z', total: 8000, guests: 4 }, // 15:01 ディナー
        { openedAt: '2026-09-27T16:30:00Z', total: 5000, guests: 2 }, // 翌 01:30 ディナー（日付をまたぐ）
        { openedAt: null, createdAt: '2026-09-27T02:00:00Z', total: 1000, guests: 1 }, // 11:00 ランチ（created_at で判定）
      ],
      '2026-09-27'
    );
    expect(r.lunchUntil).toBe('15:00');
    expect(r.dinnerFrom).toBe('15:01');
    expect(r.lunch).toEqual({ sales: 6000, groups: 3, guests: 4, avg: 1500 });
    expect(r.dinner).toEqual({ sales: 13000, groups: 2, guests: 6, avg: 2167 });
  });

  it('区切りを変えられる（14:30 → ディナーは 14:31〜）', () => {
    const r = splitDaypart([{ openedAt: '2026-09-27T05:45:00Z', total: 1000, guests: 1 }], '2026-09-27', '14:30'); // 14:45
    expect(r.dinnerFrom).toBe('14:31');
    expect(r.dinner.groups).toBe(1);
    expect(r.lunch.groups).toBe(0);
  });

  it('レジ精算レシートに 客単価の下 → 総売上点数の上 に出る', () => {
    const base: RegisterReportData = {
      storeName: 'S', registerName: 'R', businessDateLabel: '2026/9/27 (日)', sessionNo: 'A', openedAtLabel: '', openedBy: '', closedAtLabel: '2026/9/27 22:26', closedBy: 'Raju', printedAtLabel: '',
      sales: { gross: 19000, net: 17273, grossBeforeDiscount: 19000, netBeforeDiscount: 17273, discount: 0, serviceCharge: 0, refunds: 0, ordersCount: 5, guests: 10, groups: 5, avgSpend: 1900, itemQuantity: 20, taxByRate: [{ rate: 10, taxable: 19000, tax: 1727 }] },
      daypart: { lunchUntil: '15:00', dinnerFrom: '15:01', lunch: { sales: 6000, groups: 3, guests: 4, avg: 1500 }, dinner: { sales: 13000, groups: 2, guests: 6, avg: 2167 } },
      payments: [], refundsByMethod: [], discounts: { count: 0, amount: 0 }, surcharges: { count: 0, amount: 0 }, byItemType: [], byChannel: [],
      cash: { openingFloat: 0, cashSales: 0, cashRefunds: 0, cashIn: 0, cashOut: 0, expected: 0, counted: null, difference: null, denominations: null, tendered: 0, change: 0 },
      differenceReason: null, cashIns: [], cashOuts: [], activity: [], note: null,
    };
    const text = layoutRegisterReport(base, { paperWidth: 80 }).map((l) => l.text).join('\n');
    expect(text).toMatch(/ランチ売上\s+¥6,000/);
    // 区切りの時刻（〜15:00／15:01〜）は紙に出さない（2026-09-28 Ronnie「要らない」）
    expect(text).not.toContain('15:00');
    expect(text).not.toContain('15:01');
    expect(text).toMatch(/  3組 4名様 単価\s+¥1,500/);
    expect(text).toMatch(/ディナー売上\s+¥13,000/);
    expect(text).toMatch(/  2組 6名様 単価\s+¥2,167/);
    expect(text.indexOf('客単価')).toBeLessThan(text.indexOf('ランチ売上'));
    expect(text.indexOf('ディナー売上')).toBeLessThan(text.indexOf('総売上点数'));
  });
});

describe('男性／女性は伝票メモ「男2・女1」から', () => {
  it('読める・無ければ null', () => {
    expect(guestGenderFromMemo('アラカルト / 男2・女1 / ホームページ')).toEqual({ male: 2, female: 1 });
    expect(guestGenderFromMemo('支払メモ: 領収書')).toBeNull();
    expect(guestGenderFromMemo(null)).toBeNull();
  });
});
