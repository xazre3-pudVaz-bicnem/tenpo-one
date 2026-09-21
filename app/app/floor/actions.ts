'use server';

import { revalidatePath } from 'next/cache';
import { assertStoreAccess, requireMember, requirePermission } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { resolveStartTime, startTimeProblem } from '@/lib/handy-visit';

/**
 * 会計後に「清掃中」になったテーブルを、自動で空席に戻すまでの分数。
 * 片付けが終わっても「清掃完了」を押し忘れて席が空かない、という現場の詰まりを防ぐ。
 */
const CLEANING_AUTO_RELEASE_MINUTES = 5;

function randomWalkInCode() {
  return `WI-${Math.floor(100000 + Math.random() * 900000)}`;
}

export interface WalkInOptions {
  /** 滞在時間（分）。省略時は店舗の既定滞在時間（時間制のときにハンディが指定する） */
  durationMinutes?: number;
  /** 利用目的・シーン（reservations.purpose。予約台帳の「目的」に出る） */
  purpose?: string;
  /** 伝票メモ（orders.memo。レジ・レシートの「メモ」に出る） */
  memo?: string;
  /** 伝票の種類（コース利用なら 'course'） */
  orderType?: 'dine_in' | 'course';
  /**
   * 開始時間（'HH:MM'・日本時間。ハンディで直したとき）。12時間前〜今。
   * 予約の開始・終了予定（開始＋滞在時間）と伝票の開始時刻（経過時間の起点）をこの時刻にする。省略時は今
   */
  startTime?: string;
}

/** 滞在時間として受け付ける範囲（分）。それ以外は店舗の既定値にする */
const WALK_IN_STAY_MIN = 15;
const WALK_IN_STAY_MAX = 480;

/**
 * ウォークイン着席: 予約(walk_in/seated)+注文(open)を作成する。呼び出し側で /app/pos?order=id へ遷移すること。
 * options はハンディの「お客様情報」（時間制・利用シーン・伝票メモ）用で、フロア画面からは省略する。
 */
export async function startWalkIn(
  tableId: string,
  partySize: number,
  options: WalkInOptions = {}
): Promise<{ orderId: string }> {
  const ctx = await requirePermission('tables.operate');
  const supabase = await createClient();

  // 上限は orders.guest_count の制約（0〜999）に合わせる（大人数の貸切もフロアから着席できるように）
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 999) {
    throw new Error('人数は1〜999名で指定してください');
  }

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
  const requestedStay = options.durationMinutes;
  const stayMinutes =
    typeof requestedStay === 'number' &&
    Number.isInteger(requestedStay) &&
    requestedStay >= WALK_IN_STAY_MIN &&
    requestedStay <= WALK_IN_STAY_MAX
      ? requestedStay
      : (settings?.default_stay_minutes ?? 120);
  const purpose = options.purpose?.trim().slice(0, 60) || null;
  const memo = options.memo?.trim().slice(0, 200) || null;
  const now = new Date();
  let startAt = now;
  if (options.startTime) {
    const problem = startTimeProblem(options.startTime, now.getTime());
    if (problem) throw new Error(problem);
    startAt = new Date(resolveStartTime(options.startTime, now.getTime()) as number);
  }
  const customStart = startAt !== now;
  const endAt = new Date(startAt.getTime() + stayMinutes * 60000);
  const today = startAt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  let reservationId: string | null = null;
  for (let attempt = 0; attempt < 3 && !reservationId; attempt++) {
    const { data: reservation, error } = await supabase
      .from('reservations')
      .insert({
        organization_id: table.organization_id,
        store_id: table.store_id,
        code: randomWalkInCode(),
        reserved_date: today,
        start_at: startAt.toISOString(),
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
        ...(purpose ? { purpose } : {}),
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
      order_type: options.orderType === 'course' ? 'course' : 'dine_in',
      status: 'open',
      guest_count: partySize,
      staff_id: ctx.userId,
      created_by: ctx.userId,
      ...(memo ? { memo } : {}),
      // 開始時間を直したときは、フロア・ハンディの経過時間もその時刻から数える
      ...(customStart ? { opened_at: startAt.toISOString() } : {}),
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

/**
 * 清掃中のまま指定時間を過ぎたテーブルを空席に戻す。
 * テーブル一覧を開いている端末から定期的に呼ばれる（押し忘れても席が自然に空く）。
 * 権限が無いユーザーや他店舗のテーブルには何もしない（画面を見ているだけで失敗させない）。
 */
export async function releaseFinishedCleaning(storeId: string): Promise<{ released: number }> {
  const ctx = await requireMember();
  if (!can(ctx.role, 'tables.operate')) return { released: 0 };
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === storeId)) return { released: 0 };

  const supabase = await createClient();
  const threshold = new Date(Date.now() - CLEANING_AUTO_RELEASE_MINUTES * 60_000).toISOString();
  const { data } = await supabase
    .from('restaurant_tables')
    .update({ current_status: 'available', updated_by: ctx.userId })
    .eq('store_id', storeId)
    .eq('current_status', 'cleaning')
    .lt('updated_at', threshold)
    .select('id');

  const released = data?.length ?? 0;
  if (released > 0) {
    revalidatePath('/app/floor');
    revalidatePath('/app/pos');
  }
  return { released };
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
