import { describe, it, expect } from 'vitest';
import { closingNetSales, isNativeHandyActionType, parseNativeHandyAction, summarizeOwnerReservations } from '@/lib/native-handy';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('iPhone ネイティブ：ハンディ・オーナーのホームの操作（2026-10-24）', () => {
  it('担当者を選ぶ：clerkId は UUID', () => {
    expect(parseNativeHandyAction({ type: 'handyLogin', clerkId: U1 })).toEqual({ ok: true, action: { type: 'handyLogin', clerkId: U1 } });
    expect(parseNativeHandyAction({ type: 'handyLogin', clerkId: null }).ok).toBe(false);
    expect(parseNativeHandyAction({ type: 'handyLogout' }).ok).toBe(true);
    expect(parseNativeHandyAction({ type: 'signOut' }).ok).toBe(true);
  });
  it('卓ロック：tableId と unavailable', () => {
    expect(parseNativeHandyAction({ type: 'handyLock', tableId: U1, unavailable: true }).ok).toBe(true);
    expect(parseNativeHandyAction({ type: 'handyLock', tableId: U1, unavailable: 'yes' }).ok).toBe(false);
  });
  it('まとめ：UUID の配列（重複は1つに。1卓だけ＝解除）', () => {
    const r = parseNativeHandyAction({ type: 'handyGroup', tableIds: [U1, U2] });
    expect(r.ok && r.action.type === 'handyGroup' && r.action.tableIds).toEqual([U1, U2]);
    expect(parseNativeHandyAction({ type: 'handyGroup', tableIds: [U1] }).ok).toBe(true);
    expect(parseNativeHandyAction({ type: 'handyGroup', tableIds: [] }).ok).toBe(false);
    expect(parseNativeHandyAction({ type: 'handyGroup', tableIds: [U1, 'x'] }).ok).toBe(false);
  });
  it('店舗の切り替え：null / all は全店舗', () => {
    expect(parseNativeHandyAction({ type: 'switchStore', storeId: null })).toEqual({ ok: true, action: { type: 'switchStore', storeId: null } });
    expect(parseNativeHandyAction({ type: 'switchStore', storeId: 'all' })).toEqual({ ok: true, action: { type: 'switchStore', storeId: null } });
    expect(parseNativeHandyAction({ type: 'switchStore', storeId: U2 }).ok).toBe(true);
    expect(parseNativeHandyAction({ type: 'switchStore', storeId: 'nope' }).ok).toBe(false);
  });
  it('知らない type は受けない', () => {
    expect(isNativeHandyActionType('handyCallDone')).toBe(true);
    expect(isNativeHandyActionType('floorStart')).toBe(false);
    expect(parseNativeHandyAction({ type: 'floorStart' }).ok).toBe(false);
  });
});

describe('オーナーのホーム：本日の予約のまとめ（Web の StoreDashboard と同じ数え方）', () => {
  const rows = [
    { id: 'a', time: '18:00', name: '山田', partySize: 4, status: 'seated', assigned: true },
    { id: 'b', time: '19:00', name: '佐藤', partySize: 2, status: 'confirmed', assigned: false },
    { id: 'c', time: '19:30', name: '鈴木', partySize: 3, status: 'pending', assigned: false },
    { id: 'd', time: '20:00', name: '高橋', partySize: 2, status: 'arrived', assigned: false },
  ];
  it('組数・人数・席未定・次のご予約', () => {
    const s = summarizeOwnerReservations(rows);
    expect(s.count).toBe(4);
    expect(s.covers).toBe(11);
    // 席未定は pending / confirmed で卓なし（arrived は数えない）
    expect(s.unassigned).toBe(2);
    expect(s.next?.id).toBe('b');
    expect(s.list.map((r) => r.status)).toEqual(['seated', 'confirmed', 'pending', 'confirmed']);
  });
  it('予約なし', () => {
    const s = summarizeOwnerReservations([]);
    expect(s).toEqual({ count: 0, covers: 0, unassigned: 0, next: null, list: [] });
  });
  it('30日推移：古い締め（net_sales=0）は sales_total − refund_total', () => {
    expect(closingNetSales({ sales_total: 100, net_sales: 90, refund_total: 10 })).toBe(90);
    expect(closingNetSales({ sales_total: 100, net_sales: 0, refund_total: 10 })).toBe(90);
    expect(closingNetSales({ sales_total: 0, net_sales: 0, refund_total: 0 })).toBe(0);
  });
});
