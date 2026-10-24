import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const db = { audit: [] as Row[], inserts: [] as { table: string; row: Row }[], updates: [] as { table: string; values: Row; filters: Row }[] };
  const state = { orderStatus: 'open', orderTotal: 1200, seq: 0, created: new Set<string>() };
  const client = {
    from(table: string) {
      const filters: Row = {};
      let op: 'select' | 'insert' | 'update' = 'select';
      let payload: Row | null = null;
      const result = (single: boolean) => {
        if (op === 'insert') {
          if (table === 'audit_logs') {
            const row = { ...payload, id: `a${String(++state.seq).padStart(5, '0')}`, created_at: new Date(Date.now() + state.seq).toISOString() };
            db.audit.push(row);
            return { data: row, error: null };
          }
          db.inserts.push({ table, row: payload! });
          if (table === 'reservations' || table === 'orders') {
            state.created.add(`${table}:${payload!.id}`);
            return { data: { id: payload!.id }, error: null };
          }
          return { data: { id: `x-${state.seq++}` }, error: null };
        }
        if (op === 'update') {
          db.updates.push({ table, values: payload!, filters: { ...filters } });
          return { data: null, error: null };
        }
        if (table === 'audit_logs') {
          const rows = db.audit.filter((a) => a.target_id === filters.target_id);
          return single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
        }
        if (table === 'orders') {
          const id = String(filters.id);
          // オフラインで始めた伝票（id＝iPad の伝票の id）は作るまで無い
          if (id === CLIENT && !state.created.has(`orders:${id}`)) return { data: null, error: null };
          return { data: { id, store_id: STORE, organization_id: 'org', status: state.orderStatus, total: state.orderTotal, rounding_adjustment: 0 }, error: null };
        }
        if (table === 'reservations') return { data: state.created.has(`reservations:${filters.id}`) ? { id: filters.id } : null, error: null };
        if (table === 'restaurant_tables') return { data: { id: filters.id, organization_id: 'org', store_id: STORE }, error: null };
        if (table === 'store_settings') return { data: { default_stay_minutes: 120 }, error: null };
        return { data: null, error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters[k] = v; return q; },
        in: () => q, or: () => q, gte: () => q, order: () => q, limit: () => q,
        insert: (row: Row) => { op = 'insert'; payload = row; return q; },
        update: (v: Row) => { op = 'update'; payload = v; return q; },
        maybeSingle: async () => result(true),
        single: async () => result(true),
        then: (resolve: (r: unknown) => void) => resolve(result(false)),
      };
      return q;
    },
    rpc: vi.fn(async () => ({ error: null })),
  };
  return {
    db, state, client,
    addItem: vi.fn(async () => ({ id: `item-${Math.random().toString(16).slice(2, 8)}` })),
    addCustomPriceItem: vi.fn(async () => ({ id: 'item-custom' })),
    cancelItem: vi.fn(async () => undefined),
    clearTable: vi.fn(async () => ({ cancelledItems: 0 })),
    checkout: vi.fn(async () => ({ ok: true })),
    setOrderClerk: vi.fn(async () => ({ ok: true })),
    setOrderVisitSource: vi.fn(async () => ({ ok: true })),
  };
});
const STORE = '00000000-0000-4000-8000-000000000002';
const CLIENT = '00000000-0000-4000-8000-000000000001';
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.client }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => h.client }));
vi.mock('@/app/app/pos/actions', () => ({ addItem: h.addItem, addCustomPriceItem: h.addCustomPriceItem, cancelItem: h.cancelItem, clearTable: h.clearTable, checkout: h.checkout }));
vi.mock('@/app/app/pos/clerk-actions', () => ({ setOrderClerk: h.setOrderClerk }));
vi.mock('@/lib/native-pos-server', () => ({ setOrderVisitSource: h.setOrderVisitSource }));

import { syncOfflineOrder } from '@/lib/native-offline-sync-server';
import { parseOfflineSync } from '@/lib/native-offline-sync';
import type { SessionContext } from '@/lib/auth';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = new Date(Date.now() - 10 * 60_000).toISOString();
const opened = new Date(Date.now() - 40 * 60_000).toISOString();
const ctx = { organizationId: 'org', userId: 'u1', role: 'manager', isHq: false, stores: [{ id: STORE }] } as unknown as SessionContext;
const input = (over: Record<string, unknown> = {}) => {
  const r = parseOfflineSync({
    order: {
      clientId: U(1), storeId: STORE, serverOrderId: null, planItemIds: [U(40)], tableId: U(3), localNo: 'OFF-1', clerkId: null, visitSourceId: 'walkin', openedAt: opened,
      draft: { plans: ['normal'], planItemIds: [U(40)], male: 2, female: 0, source: '', timed: false, duration: 120, warningEnabled: false, warningMinutes: 10, startTime: '16:30' },
      lines: [
        { clientLineId: U(10), menuItemId: U(20), custom: null, optionItemIds: [], openPrice: null, quantity: 2, unitPrice: 600, at },
        { clientLineId: U(11), menuItemId: U(21), custom: null, optionItemIds: [], openPrice: null, quantity: 1, unitPrice: 390, at },
      ],
      cancels: [{ ref: { kind: 'client', clientLineId: U(11) }, reason: '担当: Ronnie', approvedByClerkId: null, at }],
      cleared: null,
      checkout: { payments: [{ method: 'cash', amount: 1200, tendered: 2000 }], memo: '', at, total: 1200 },
      ...over,
    },
  });
  if (!r.ok) throw new Error(r.error);
  return r.order;
};
const steps = () => h.db.audit.map((a) => String(a.target_id).split(':').slice(1).join(':')).filter((s) => !s.startsWith('lease'));

beforeEach(() => {
  h.db.audit.length = 0;
  h.db.inserts.length = 0;
  h.db.updates.length = 0;
  h.state.orderStatus = 'open';
  h.state.orderTotal = 1200;
  h.state.created.clear();
  for (const f of [h.addItem, h.addCustomPriceItem, h.cancelItem, h.clearTable, h.checkout, h.setOrderClerk, h.setOrderVisitSource]) f.mockClear();
});

describe('オフライン伝票の同期（サーバー）', () => {
  it('卓に新しい伝票（オフラインの開始時刻）→ 品（印刷済み・提供済み）→ 取消（紙は出さない）→ 現金会計（レシートは出さない）', async () => {
    const r = await syncOfflineOrder(ctx, input());
    expect(r).toMatchObject({ ok: true, orderId: CLIENT });
    const order = h.db.inserts.find((i) => i.table === 'orders')!.row;
    expect(order).toMatchObject({ id: CLIENT, table_id: U(3), status: 'open', guest_count: 2, opened_at: opened });
    // 卓は着席中に
    expect(h.db.updates.some((u) => u.table === 'restaurant_tables' && u.values.current_status === 'seated')).toBe(true);
    // プラン商品は未送信の品として（直しはしない）
    expect(h.addItem).toHaveBeenCalledWith(CLIENT, U(40), [], 1);
    expect(h.db.inserts.find((i) => i.table === 'reservations')!.row).toMatchObject({ status: 'seated', start_at: opened, created_via: 'walk_in' });
    expect(h.addItem).toHaveBeenCalledTimes(3);
    const fixes = h.db.updates.filter((u) => u.table === 'order_items' && 'kitchen_printed_qty' in u.values);
    expect(fixes.map((f) => f.values)).toEqual([
      { unit_price: 600, line_total: 1200, kitchen_sent_at: at, kitchen_printed_qty: 2, kitchen_status: 'served' },
      { unit_price: 390, line_total: 390, kitchen_sent_at: at, kitchen_printed_qty: 1, kitchen_status: 'served' },
    ]);
    expect(fixes.every((f) => f.filters.status === 'active')).toBe(true);
    expect(h.cancelItem).toHaveBeenCalledWith(CLIENT, expect.stringMatching(/^item-/), '担当: Ronnie', null, { offlineAt: at });
    expect(h.checkout).toHaveBeenCalledWith(CLIENT, [{ method: 'cash', amount: 1200, tendered: 2000 }], 'オフライン会計 OFF-1', undefined, { skipReceipt: true });
    expect(h.db.updates.some((u) => u.table === 'orders' && u.values.closed_at === at)).toBe(true);
    // 品は入れたらすぐ覚える（このあと止まっても入れ直さない）
    expect(steps()).toEqual(['order', 'plans', `line:${U(10)}`, `fix:${U(10)}`, `line:${U(11)}`, `fix:${U(11)}`, `cancel:c:${U(11)}`, 'visit', 'checkout-start', 'checkout']);
  });

  it('同じものをもう一度送っても二重にならない', async () => {
    await syncOfflineOrder(ctx, input());
    h.state.orderStatus = 'paid';
    const again = await syncOfflineOrder(ctx, input());
    expect(again.ok).toBe(true);
    expect(h.db.inserts.filter((i) => i.table === 'orders')).toHaveLength(1);
    expect(h.addItem).toHaveBeenCalledTimes(3);
    expect(h.cancelItem).toHaveBeenCalledTimes(1);
    expect(h.checkout).toHaveBeenCalledTimes(1);
  });

  it('途中で止まっても、次は続きから（レジが閉まっている → 開いたら会計だけ）', async () => {
    h.checkout.mockResolvedValueOnce({ ok: false, registerClosed: true } as never);
    expect(await syncOfflineOrder(ctx, input())).toMatchObject({ ok: false, retry: true });
    expect((await syncOfflineOrder(ctx, input())).ok).toBe(true);
    expect(h.addItem).toHaveBeenCalledTimes(3);
    // 直しは1回だけ（2回目の送信で数・値段を戻さない）
    expect(h.db.updates.filter((u) => u.table === 'order_items' && 'kitchen_printed_qty' in u.values)).toHaveLength(2);
    expect(h.checkout).toHaveBeenCalledTimes(2);
  });

  it('ほかの通信が同じ伝票を入れている最中は何もしない', async () => {
    h.db.audit.push({ id: 'a00000', created_at: new Date(Date.now() - 5_000).toISOString(), target_id: `${U(1)}:lease`, after_data: { leaseId: 'other' } });
    const r = await syncOfflineOrder(ctx, input());
    expect(r).toMatchObject({ ok: false, retry: true });
    expect(h.db.inserts.filter((i) => i.table === 'orders')).toHaveLength(0);
    expect(h.addItem).not.toHaveBeenCalled();
  });

  it('合計が少し違う → iPad で受け取った金額に端数調整して会計（大きく違えば人が見る）', async () => {
    h.state.orderTotal = 1210;
    const r = await syncOfflineOrder(ctx, input());
    expect(r.ok).toBe(true);
    expect(h.db.updates.some((u) => u.table === 'orders' && u.values.rounding_adjustment === -10)).toBe(true);
    expect(h.checkout).toHaveBeenCalledWith(CLIENT, [{ method: 'cash', amount: 1200, tendered: 2000 }], expect.any(String), undefined, { skipReceipt: true });

    h.db.audit.length = 0;
    h.checkout.mockClear();
    h.state.orderTotal = 3000;
    expect(await syncOfflineOrder(ctx, input({ serverOrderId: U(9), tableId: null, draft: null, clientId: U(2) }))).toMatchObject({ ok: false, retry: false });
    expect(h.checkout).not.toHaveBeenCalled();
  });

  it('ほかの端末で会計済みの伝票は成功にしない（人が見る）', async () => {
    h.state.orderStatus = 'paid';
    const r = await syncOfflineOrder(ctx, input({ serverOrderId: U(9), tableId: null, draft: null, lines: [], cancels: [] }));
    expect(r).toMatchObject({ ok: false, retry: false });
    expect(h.checkout).not.toHaveBeenCalled();
  });

  it('ほかの店の伝票は受けない', async () => {
    const r = await syncOfflineOrder({ ...ctx, stores: [{ id: U(99) }] } as unknown as SessionContext, input());
    expect(r.ok).toBe(false);
    expect(h.db.inserts).toHaveLength(0);
  });
});

describe('会計まで済んで記録だけ残せなかったとき', () => {
  it('次の送信で「ほかの端末で会計済み」にしない', async () => {
    const order = input({ serverOrderId: U(9), tableId: null, draft: null, lines: [], cancels: [] });
    // 1回目：会計の前の印は残った・会計の記録は残せなかった（を作る）
    h.db.audit.push({ id: 'a00001', created_at: new Date().toISOString(), target_id: `${order.clientId}:checkout-start`, after_data: { at } });
    h.state.orderStatus = 'paid';
    const r = await syncOfflineOrder(ctx, order);
    expect(r.ok).toBe(true);
    expect(h.checkout).not.toHaveBeenCalled();
  });
});
