import { describe, expect, it } from 'vitest';
import { offlineCashPayments, offlineRoundingAllowed, parseOfflineSync } from '@/lib/native-offline-sync';

const NOW = Date.parse('2026-10-24T08:00:00Z');
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-24T07:30:00.000Z';
const draft = { plans: ['normal'], planItemIds: [], male: 2, female: 1, source: '', timed: false, duration: 120, warningEnabled: false, warningMinutes: 10, startTime: '16:30' };

const base = () => ({
  type: 'offlineSync',
  order: {
    clientId: U(1), storeId: U(2), serverOrderId: null, tableId: U(3), draft, openedAt: at, localNo: 'OFF-1', clerkId: U(4), visitSourceId: 'walkin',
    lines: [
      { clientLineId: U(10), menuItemId: U(20), custom: null, optionItemIds: [U(30)], openPrice: null, quantity: 2, unitPrice: 650, at },
      { clientLineId: U(11), menuItemId: null, custom: { categoryId: U(21), price: 500, memo: '  持ち込み料  ' }, optionItemIds: [], openPrice: null, quantity: 1, unitPrice: 500, at },
    ],
    cancels: [{ ref: { kind: 'client', clientLineId: U(11) }, reason: '担当: Ronnie', approvedByClerkId: null, at }],
    cleared: null,
    checkout: { payments: [{ method: 'cash', amount: 1300, tendered: 2000 }], memo: '', at, total: 1300 },
  },
});

describe('オフライン伝票の同期の形', () => {
  it('オフラインで始めた伝票（卓・来店登録・品・取消・現金会計）', () => {
    const r = parseOfflineSync(base(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.draft?.male).toBe(2);
    expect(r.order.lines[1].custom).toEqual({ categoryId: U(21), price: 500, memo: '持ち込み料' });
    expect(r.order.lines[1].menuItemId).toBeNull();
    expect(r.order.cancels[0].ref).toEqual({ kind: 'client', clientLineId: U(11) });
    expect(r.order.checkout?.payments[0]).toEqual({ method: 'cash', amount: 1300, tendered: 2000 });
  });

  it('サーバーの伝票は卓・来店登録なしでよい', () => {
    const b = base();
    const r = parseOfflineSync({ ...b, order: { ...b.order, serverOrderId: U(9), tableId: null, draft: null } }, NOW);
    expect(r.ok).toBe(true);
  });

  it('オフラインで始めた伝票は卓と来店登録が要る', () => {
    const b = base();
    expect(parseOfflineSync({ ...b, order: { ...b.order, tableId: null } }, NOW).ok).toBe(false);
    expect(parseOfflineSync({ ...b, order: { ...b.order, draft: { male: -1 } } }, NOW).ok).toBe(false);
  });

  it('現金以外・お預かり不足・会計とクリアの同時は受けない', () => {
    const b = base();
    const pay = (p: unknown) => ({ ...b, order: { ...b.order, checkout: { ...b.order.checkout, payments: [p] } } });
    expect(parseOfflineSync(pay({ method: 'credit', amount: 1300, tendered: 1300 }), NOW).ok).toBe(false);
    expect(parseOfflineSync(pay({ method: 'cash', amount: 1300, tendered: 1000 }), NOW).ok).toBe(false);
    expect(parseOfflineSync({ ...b, order: { ...b.order, cleared: { reason: '', approvedByClerkId: null, at } } }, NOW).ok).toBe(false);
  });

  it('時刻が古すぎる・先すぎる（iPad の時計のずれ）は受けない', () => {
    const b = base();
    const line = (t: string) => ({ ...b, order: { ...b.order, lines: [{ ...b.order.lines[0], at: t }] } });
    expect(parseOfflineSync(line('2026-10-10T00:00:00Z'), NOW).ok).toBe(false);
    expect(parseOfflineSync(line('2026-10-24T09:00:00Z'), NOW).ok).toBe(false);
    expect(parseOfflineSync(line('2026-10-24T08:05:00Z'), NOW).ok).toBe(true);
  });

  it('数・金額・id の形', () => {
    const b = base();
    const line = (over: Record<string, unknown>) => ({ ...b, order: { ...b.order, lines: [{ ...b.order.lines[0], ...over }] } });
    expect(parseOfflineSync(line({ quantity: 0 }), NOW).ok).toBe(false);
    expect(parseOfflineSync(line({ unitPrice: -1 }), NOW).ok).toBe(false);
    expect(parseOfflineSync(line({ clientLineId: 'x' }), NOW).ok).toBe(false);
    expect(parseOfflineSync(line({ menuItemId: null }), NOW).ok).toBe(false);
  });
});

describe('同期の会計の支払い（サーバーの合計で払う）', () => {
  const co = { payments: [{ method: 'cash' as const, amount: 1300, tendered: 2000 }], memo: '', at, total: 1300 };
  it('同じ合計', () => expect(offlineCashPayments(1300, co)).toEqual([{ method: 'cash', amount: 1300, tendered: 2000 }]));
  it('サーバーが少し違っても、お預かりで足りれば入れる', () => expect(offlineCashPayments(1320, co)).toEqual([{ method: 'cash', amount: 1320, tendered: 2000 }]));
  it('お預かりで足りなければ人に見てもらう', () => expect(offlineCashPayments(2100, co)).toBeNull());
});

describe('端数調整で合わせてよい差', () => {
  it('¥200 か 5% まで', () => {
    expect(offlineRoundingAllowed(1210, 1200)).toBe(true);
    expect(offlineRoundingAllowed(10000, 10500)).toBe(true);
    expect(offlineRoundingAllowed(10000, 10600)).toBe(false);
    expect(offlineRoundingAllowed(1000, 1300)).toBe(false);
  });
});
