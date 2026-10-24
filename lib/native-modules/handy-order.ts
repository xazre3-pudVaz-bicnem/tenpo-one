import 'server-only';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { readHandyClerk } from '@/lib/handy-session';
import { groupHostTableId } from '@/lib/table-group-server';
import { loadHandyMenu } from '@/lib/handy-menu-server';
import { HANDY_CANCEL_WINDOW_MS, HANDY_EXTEND_OPTIONS } from '@/lib/handy-cancel';
import { handyModifierLabel, parseNativeHandyOrderAction } from '@/lib/native-handy-order';
import { nativeBad, nativeErrorText } from '@/lib/native-modules/guard';
import {
  cancelRecentHandyItem,
  extendHandyStay,
  openHandyOrder,
  setHandyGuestCount,
  startHandyVisit,
  submitHandyOrder,
} from '@/app/app/handy/actions';
import { loadSetupPlanItems } from '@/app/app/handy/setup-data';
import { HANDY_PLANS, visitSourcesFrom } from '@/lib/handy-visit';
import { tableState } from '@/components/handy/logic';
import { enqueueOrderSlipPrint } from '@/app/app/pos/print-actions';
import { loadNativeFloor } from '@/lib/native-floor-server';
import type { NativeModuleArgs, NativeModuleGet, NativeModulePost, NativeModuleResult } from '@/lib/native-modules/registry';

/**
 * iPhone アプリのネイティブのハンディ：卓の画面・注文の画面（2026-10-25 01:38 Ronnie「iPhone も native に。デザインは iPad のネイティブ」）。
 * 中身・操作は Web のハンディ（app/handy/[tableId]・order、app/app/handy/actions.ts）と同じ。Web のハンディは変えない（店が営業中）。
 * 担当者（ハンディのログインで選んだ人）が要る：Cookie tenpo_handy_clerk（アプリは WKWebView の Cookie をそのまま送る）。
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handyGuard(ctx: NativeModuleArgs['ctx']): Promise<{ clerk: { id: string; name: string } } | NativeModuleResult> {
  if (ctx.disabledFeatures?.has('pos')) return nativeBad('この機能は使えません', 403);
  if (!can(ctx.role, 'pos.order')) return nativeBad('注文の権限がありません', 403);
  const clerk = await readHandyClerk();
  if (!clerk?.id) return { status: 409, body: { ok: false, error: '担当者を選んでください', needClerk: true } };
  return { clerk: { id: clerk.id, name: clerk.name } };
}

/**
 * テーブル一覧の卓の箱（iPad のネイティブのテーブル一覧と同じ中身＝loadNativeFloor。2026-10-25 02:22 Ronnie
 * 「iPhone のハンディの卓は iPad のネイティブのように」）。iPad の part=floor（レジ端末の登録が要る）は変えずに、ハンディ用に別にする
 */
export const handyFloorGet: NativeModuleGet = async ({ ctx, store }) => {
  if (ctx.disabledFeatures?.has('pos')) return nativeBad('この機能は使えません', 403);
  if (!can(ctx.role, 'pos.order')) return nativeBad('注文の権限がありません', 403);
  const floor = await loadNativeFloor(ctx, await createClient(), store);
  return { body: { ok: true, serverNow: floor.serverNow, tables: floor.tables } };
};

/** 卓の画面（Web の /handy/[tableId] と同じ中身） */
export const handyTableGet: NativeModuleGet = async ({ ctx, store, url }) => {
  const g = await handyGuard(ctx);
  if (!('clerk' in g)) return g;
  const tableId = url.searchParams.get('tableId') ?? '';
  if (!UUID.test(tableId)) return nativeBad('卓の指定が正しくありません');
  const supabase = await createClient();
  const { data: table } = await supabase
    .from('restaurant_tables')
    .select('id, name, capacity_max, current_status, store_id')
    .eq('id', tableId)
    .eq('status', 'active')
    .maybeSingle();
  if (!table || table.store_id !== store.id) return nativeBad('このテーブルは存在しないか、現在の店舗からアクセスできません', 404);

  const [{ data: orders }, { data: calls }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_no, guest_count, opened_at, subtotal, tax_total, discount_total, total, reservation_id')
      .eq('table_id', tableId)
      .eq('status', 'open')
      .order('opened_at'),
    supabase.from('service_calls').select('id, table_id, kind, note, created_at').eq('table_id', tableId).eq('status', 'open').order('created_at'),
  ]);
  // まとめた卓で伝票がほかの卓にあるときは、その卓を開く（Web と同じ）
  if ((orders ?? []).length === 0) {
    const host = await groupHostTableId(supabase, store.id, tableId);
    if (host && host !== tableId) return { body: { ok: true, hostTableId: host } };
  }
  const orderIds = (orders ?? []).map((o) => o.id as string);
  const reservationIds = (orders ?? []).map((o) => o.reservation_id as string | null).filter((id): id is string => !!id);
  const [{ data: itemRows }, { data: rsvRows }] = await Promise.all([
    orderIds.length
      ? supabase
          .from('order_items')
          .select('id, order_id, name, quantity, unit_price, line_total, modifiers, kitchen_sent_at, created_at')
          .in('order_id', orderIds)
          .eq('status', 'active')
          .order('created_at')
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    reservationIds.length
      ? supabase.from('reservations').select('id, end_at').in('id', reservationIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const endById = new Map((rsvRows ?? []).map((r) => [r.id as string, (r.end_at as string | null) ?? null]));
  const ms = (iso: unknown) => (typeof iso === 'string' ? new Date(iso).getTime() : null);

  const slips = (orders ?? []).map((o) => {
    const end = o.reservation_id ? endById.get(o.reservation_id as string) : null;
    return {
      id: o.id as string,
      orderNo: o.order_no as number,
      guestCount: (o.guest_count as number | null) ?? 0,
      openedAt: ms(o.opened_at) ?? Date.now(),
      subtotal: Number(o.subtotal ?? 0),
      discountTotal: Number(o.discount_total ?? 0),
      total: Number(o.total ?? 0),
      endsAt: end ? ms(end) : null,
      items: (itemRows ?? [])
        .filter((i) => i.order_id === o.id)
        .map((i) => ({
          id: i.id as string,
          name: i.name as string,
          quantity: Number(i.quantity ?? 0),
          unitPrice: Number(i.unit_price ?? 0),
          lineTotal: Number(i.line_total ?? 0),
          optionLabel: handyModifierLabel(i.modifiers),
          sentAt: ms(i.kitchen_sent_at),
          orderedAt: ms(i.kitchen_sent_at ?? i.created_at) ?? Date.now(),
        })),
    };
  });

  return {
    body: {
      ok: true,
      table: { id: table.id, name: table.name, capacityMax: table.capacity_max ?? null, status: table.current_status ?? null },
      clerk: g.clerk,
      slips,
      calls: (calls ?? []).map((c) => ({
        id: c.id as string,
        kind: c.kind === 'checkout' ? 'checkout' : 'staff',
        note: (c.note as string | null) ?? null,
        createdAt: ms(c.created_at) ?? Date.now(),
      })),
      serverNow: Date.now(),
      cancelWindowMs: HANDY_CANCEL_WINDOW_MS,
      extendOptions: HANDY_EXTEND_OPTIONS,
    },
  };
};

/** 注文の画面のメニュー（Web の /handy/[tableId]/order と同じ loadHandyMenu） */
export const handyMenuGet: NativeModuleGet = async ({ ctx, store, url }) => {
  const g = await handyGuard(ctx);
  if (!('clerk' in g)) return g;
  const orderId = url.searchParams.get('orderId') ?? '';
  if (!UUID.test(orderId)) return nativeBad('伝票が指定されていません。卓の画面から開いてください');
  const supabase = await createClient();
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_no, status, store_id, table_id, guest_count, total, restaurant_tables(name)')
    .eq('id', orderId)
    .maybeSingle();
  if (!order || order.store_id !== store.id || order.status !== 'open') {
    return nativeBad('この伝票には注文できません。既に会計済み・取消済みの可能性があります', 409);
  }
  const menu = await loadHandyMenu(supabase, ctx.organizationId as string, store.id, order.id as string);
  return {
    body: {
      ok: true,
      order: {
        id: order.id,
        orderNo: order.order_no,
        tableId: order.table_id,
        tableName: (order.restaurant_tables as unknown as { name: string } | null)?.name ?? '—',
        guestCount: order.guest_count ?? 0,
        total: Number(order.total ?? 0),
      },
      clerk: g.clerk,
      pages: menu.pages,
      initialPageKey: menu.initialPageKey,
      optionGroupsByItem: menu.optionGroupsByItem,
    },
  };
};

/** お客様情報（空席の卓の来店登録。Web の /handy/[tableId]/setup と同じ中身） */
export const handySetupGet: NativeModuleGet = async ({ ctx, store, url }) => {
  const g = await handyGuard(ctx);
  if (!('clerk' in g)) return g;
  const tableId = url.searchParams.get('tableId') ?? '';
  if (!UUID.test(tableId)) return nativeBad('卓の指定が正しくありません');
  const supabase = await createClient();
  const { data: table } = await supabase
    .from('restaurant_tables')
    .select('id, name, current_status, store_id, capacity_max')
    .eq('id', tableId)
    .eq('status', 'active')
    .maybeSingle();
  if (!table || table.store_id !== store.id) return nativeBad('このテーブルは存在しないか、現在の店舗からアクセスできません', 404);
  const { count: openCount } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('table_id', tableId).eq('status', 'open');
  const state = tableState(table.current_status as string | null, (openCount ?? 0) > 0);
  // もう伝票がある卓・まとめた卓のほかの卓で始まっているときは、その卓を開く（Web と同じ）
  if (state === 'occupied') return { body: { ok: true, hostTableId: tableId } };
  const host = await groupHostTableId(supabase, store.id, tableId);
  if (host) return { body: { ok: true, hostTableId: host } };
  if (state !== 'available' && state !== 'cleaning') {
    return nativeBad(`この卓は現在「${state === 'blocked' ? '使用不可' : '予約あり'}」のため、ハンディからは着席できません。フロア画面で状態を変更してください`, 409);
  }
  const [planItems, { data: settingsRow }] = await Promise.all([
    loadSetupPlanItems(ctx.organizationId as string, store.id),
    supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle(),
  ]);
  return {
    body: {
      ok: true,
      table: { id: table.id, name: table.name, capacityMax: table.capacity_max ?? null },
      clerk: g.clerk,
      planItems,
      plans: HANDY_PLANS,
      sources: visitSourcesFrom(settingsRow?.settings ?? null).map((s) => s.label),
    },
  };
};

/** 卓・注文の操作（中身は Web のハンディと同じ Server Action） */
export const handyOrderPost: NativeModulePost = async ({ ctx, raw }) => {
  const g = await handyGuard(ctx);
  if (!('clerk' in g)) return g;
  const parsed = parseNativeHandyOrderAction(raw);
  if (!parsed.ok) return nativeBad(parsed.error);
  const a = parsed.action;
  try {
    switch (a.type) {
      case 'handyOpenOrder':
        return { body: { ok: true, ...(await openHandyOrder(a.tableId)) } };
      case 'handySubmit': {
        const r = await submitHandyOrder(a.orderId, a.lines);
        return { body: { ok: true, sentQuantity: r.sentQuantity, remaining: r.remaining, message: r.message } };
      }
      case 'handyGuests':
        await setHandyGuestCount(a.orderId, a.guestCount);
        return { body: { ok: true } };
      case 'handyExtend':
        return { body: { ok: true, ...(await extendHandyStay(a.orderId, a.minutes)) } };
      case 'handyCancelItem':
        return { body: { ok: true, ...(await cancelRecentHandyItem(a.orderId, a.orderItemId)) } };
      case 'handyStartVisit':
        return { body: { ok: true, ...(await startHandyVisit(a.tableId, a.draft, { sourceOptional: true })) } };
      case 'handyPrintBill': {
        const r = await enqueueOrderSlipPrint(a.orderId);
        if (!r.ok) return nativeBad(r.error ?? '会計伝票を印刷できませんでした');
        return { body: { ok: true, queued: r.queued ?? 0 } };
      }
    }
  } catch (e) {
    return nativeBad(nativeErrorText(e, 'うまくいきませんでした。もう一度お試しください'));
  }
};
