import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { groupKitchenTickets, type ClaimedKitchenItem } from '@/lib/kitchen-ticket';

/**
 * テーブルグループの厨房伝票に「注文した卓」の番号を出す（2026-09-29 FULL MOoN 御茶ノ水）。
 * グループの卓は同じ伝票（T-1）だが、T-3 の QR・T-3 から開いたレジで入れた品は T-3 で出す。
 */

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

const row = (over: Partial<ClaimedKitchenItem>): ClaimedKitchenItem => ({
  order_id: 'o1',
  order_no: 6467,
  table_name: 'T-1',
  guest_count: 18,
  clerk_name: null,
  item_name: 'F. 生ビール',
  modifiers: [],
  memo: null,
  station: 'drink',
  delta: 1,
  ...over,
});

describe('groupKitchenTickets（同じ伝票でも注文した卓ごとに1枚）', () => {
  it('T-1 の伝票に T-3・T-5 から入った品は、卓ごとに分けてその卓名で出す', () => {
    const t = groupKitchenTickets([
      row({ item_name: '生ビール', delta: 3 }),
      row({ table_name: 'T-3', item_name: 'ハイボール' }),
      row({ table_name: 'T-5', item_name: '緑茶' }),
      row({ table_name: 'T-3', item_name: '生ビール', delta: 2 }),
    ]);
    expect(t.map((x) => x.tableName)).toEqual(['T-1', 'T-3', 'T-5']);
    expect(t.every((x) => x.orderNo === '6467')).toBe(true);
    expect(t[1].lines.map((l) => [l.name, l.delta])).toEqual([
      ['ハイボール', 1],
      ['生ビール', 2],
    ]);
  });

  it('グループでない伝票は今まで通り1枚', () => {
    expect(groupKitchenTickets([row({}), row({ item_name: 'B' })])).toHaveLength(1);
  });
});

describe('migration 00091', () => {
  const sql = read('supabase/migrations/00091_group_table_seat.sql');
  it('order_items.ordered_table_id を足す', () => {
    expect(sql).toContain('add column if not exists ordered_table_id uuid references public.restaurant_tables(id) on delete set null');
  });
  it('QR は create_qr_order をそのまま呼び、同じグループの卓のときだけ卓を残す', () => {
    expect(sql).toContain('v_result := public.create_qr_order(p_slug, p_token, p_items);');
    expect(sql).toMatch(/g->'tableIds' \? v_seat_id::text\s+and g->'tableIds' \? v_host_table::text/);
    expect(sql).toContain('grant execute on function public.create_qr_order_at_seat(text, text, jsonb, text) to anon');
  });
  it('厨房伝票の卓名は 注文した卓 → 伝票の卓', () => {
    expect(sql).toContain('coalesce(seat.name, rt.name)');
    expect(sql).toContain('left join public.restaurant_tables seat on seat.id = oi.ordered_table_id');
  });
});

describe('注文する画面が「注文した卓」を渡す', () => {
  it('QR：伝票の卓へ振り向けたときは QR を開いた卓のトークンを一緒に送る', () => {
    expect(read('app/order/[storeSlug]/[tableToken]/page.tsx')).toContain('seatToken={resolved.redirected ? openedToken : null}');
    const app = read('components/qr-order/qr-order-app.tsx');
    expect(app).toContain("supabase.rpc('create_qr_order_at_seat'");
    expect(app).toContain('p_seat_token: seatToken');
  });
  it('レジ（iPad）：グループの卓から「注文」を開くと seat を付け、addItemAtSeat で入れる', () => {
    expect(read('components/floor/table-sheet.tsx')).toContain("table.groupTableIds.length > 1 ? `&seat=${table.id}` : ''");
    expect(read('app/app/pos/page.tsx')).toContain('addItemAtSeat.bind(null, seatTableId)');
    const actions = read('app/app/pos/actions.ts');
    expect(actions).toContain('if (group?.tableIds.includes(seatTableId)) orderedTableId = seatTableId;');
    expect(actions).toContain('...(orderedTableId ? { ordered_table_id: orderedTableId } : {})');
  });
});
