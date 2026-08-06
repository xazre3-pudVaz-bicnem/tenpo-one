'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/** アクセス可能な店舗か検証（HQ系は全店舗） */
async function assertStoreAccess(
  ctx: { isHq: boolean; stores: { id: string }[] },
  storeId: string
) {
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === storeId)) {
    throw new Error('この店舗の操作はできません');
  }
}

function randomWalkInCode() {
  return `WI-${Math.floor(100000 + Math.random() * 900000)}`;
}

/** ウォークイン着席: 予約(walk_in/seated)+注文(open)を作成する。呼び出し側で /app/pos?order=id へ遷移すること */
export async function startWalkIn(tableId: string, partySize: number): Promise<{ orderId: string }> {
  const ctx = await requirePermission('tables.operate');
  const supabase = await createClient();

  const { data: table } = await supabase
    .from('restaurant_tables')
    .select('id, organization_id, store_id, current_status')
    .eq('id', tableId)
    .single();
  if (!table) throw new Error('テーブルが見つかりません');
  await assertStoreAccess(ctx, table.store_id);
  if (table.current_status !== 'available') {
    throw new Error('このテーブルは現在空席ではありません');
  }

  const { data: settings } = await supabase
    .from('store_settings')
    .select('default_stay_minutes')
    .eq('store_id', table.store_id)
    .maybeSingle();
  const stayMinutes = settings?.default_stay_minutes ?? 120;
  const now = new Date();
  const endAt = new Date(now.getTime() + stayMinutes * 60000);
  const today = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  let reservationId: string | null = null;
  for (let attempt = 0; attempt < 3 && !reservationId; attempt++) {
    const { data: reservation, error } = await supabase
      .from('reservations')
      .insert({
        organization_id: table.organization_id,
        store_id: table.store_id,
        code: randomWalkInCode(),
        reserved_date: today,
        start_at: now.toISOString(),
        end_at: endAt.toISOString(),
        party_size: partySize,
        adults: partySize,
        children: 0,
        guest_name: 'ウォークイン',
        guest_phone: '-',
        status: 'seated',
        created_via: 'walk_in',
        consent_accepted: true,
        created_by: ctx.userId,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') continue; // code重複のみリトライ
      throw new Error(error.message);
    }
    reservationId = reservation.id;
  }
  if (!reservationId) throw new Error('予約コードの発行に失敗しました');

  await supabase.from('reservation_tables').insert({ reservation_id: reservationId, table_id: tableId });

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      organization_id: table.organization_id,
      store_id: table.store_id,
      reservation_id: reservationId,
      table_id: tableId,
      order_type: 'dine_in',
      status: 'open',
      guest_count: partySize,
      staff_id: ctx.userId,
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (orderError || !order) throw new Error(orderError?.message ?? '注文の作成に失敗しました');

  await supabase.from('restaurant_tables').update({ current_status: 'seated' }).eq('id', tableId);

  revalidatePath('/app/floor');
  return { orderId: order.id as string };
}

/** 着席中テーブルの注文画面へ（openな注文が無ければ作成）。呼び出し側で /app/pos?order=id へ遷移すること */
export async function goToOrder(tableId: string): Promise<{ orderId: string }> {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();

  const { data: table } = await supabase
    .from('restaurant_tables')
    .select('id, organization_id, store_id')
    .eq('id', tableId)
    .single();
  if (!table) throw new Error('テーブルが見つかりません');
  await assertStoreAccess(ctx, table.store_id);

  const { data: existing } = await supabase
    .from('orders')
    .select('id')
    .eq('table_id', tableId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { orderId: existing.id as string };
  }

  const { data: reservation } = await supabase
    .from('reservations')
    .select('id, party_size, customer_id')
    .eq('status', 'seated')
    .in(
      'id',
      (
        await supabase.from('reservation_tables').select('reservation_id').eq('table_id', tableId)
      ).data?.map((r) => r.reservation_id) ?? []
    )
    .order('start_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      organization_id: table.organization_id,
      store_id: table.store_id,
      reservation_id: reservation?.id ?? null,
      customer_id: reservation?.customer_id ?? null,
      table_id: tableId,
      order_type: 'dine_in',
      status: 'open',
      guest_count: reservation?.party_size ?? 1,
      staff_id: ctx.userId,
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !order) throw new Error(error?.message ?? '注文の作成に失敗しました');

  revalidatePath('/app/floor');
  return { orderId: order.id as string };
}

/** 清掃完了: cleaning → available */
export async function completeCleaning(tableId: string) {
  const ctx = await requirePermission('tables.operate');
  const supabase = await createClient();

  const { data: table } = await supabase
    .from('restaurant_tables')
    .select('id, store_id')
    .eq('id', tableId)
    .single();
  if (!table) throw new Error('テーブルが見つかりません');
  await assertStoreAccess(ctx, table.store_id);

  await supabase.from('restaurant_tables').update({ current_status: 'available' }).eq('id', tableId);
  revalidatePath('/app/floor');
}

/** 利用停止・再開の切替 */
export async function setTableAvailability(tableId: string, unavailable: boolean) {
  const ctx = await requirePermission('tables.operate');
  const supabase = await createClient();

  const { data: table } = await supabase
    .from('restaurant_tables')
    .select('id, store_id')
    .eq('id', tableId)
    .single();
  if (!table) throw new Error('テーブルが見つかりません');
  await assertStoreAccess(ctx, table.store_id);

  await supabase
    .from('restaurant_tables')
    .update({ current_status: unavailable ? 'unavailable' : 'available' })
    .eq('id', tableId);
  revalidatePath('/app/floor');
}
