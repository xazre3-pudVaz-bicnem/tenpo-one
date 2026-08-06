'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'seated'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'waitlisted';

interface ReservationRow {
  id: string;
  organization_id: string;
  store_id: string;
  customer_id: string | null;
  party_size: number;
  status: ReservationStatus;
  reserved_date: string;
}

/** 着席・来店なし・キャンセルへ遷移できる元ステータス */
const SEATABLE: ReservationStatus[] = ['pending', 'confirmed', 'waitlisted'];
const NO_SHOWABLE: ReservationStatus[] = ['pending', 'confirmed', 'waitlisted'];
const CANCELLABLE: ReservationStatus[] = ['pending', 'confirmed', 'waitlisted'];

function revalidateAll() {
  revalidatePath('/app/reservations');
  revalidatePath('/app/reservations/list');
  revalidatePath('/app/reservations/calendar');
}

async function loadReservation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  reservationId: string
): Promise<ReservationRow> {
  const { data, error } = await supabase
    .from('reservations')
    .select('id, organization_id, store_id, customer_id, party_size, status, reserved_date')
    .eq('id', reservationId)
    .eq('organization_id', organizationId)
    .single();
  if (error || !data) throw new Error('予約が見つかりません');
  return data as ReservationRow;
}

function randomDigits(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10).toString();
  return s;
}

async function getDefaultStayMinutes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storeId: string
): Promise<number> {
  const { data } = await supabase
    .from('store_settings')
    .select('default_stay_minutes')
    .eq('store_id', storeId)
    .maybeSingle();
  return data?.default_stay_minutes ?? 120;
}

async function findOrCreateCustomer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  storeId: string,
  name: string,
  phone: string,
  email: string | null
): Promise<string | null> {
  const trimmedPhone = phone.trim();
  if (!trimmedPhone) return null;
  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('phone', trimmedPhone)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data: created, error } = await supabase
    .from('customers')
    .insert({
      organization_id: organizationId,
      primary_store_id: storeId,
      name,
      phone: trimmedPhone,
      email,
    })
    .select('id')
    .single();
  if (error || !created) throw new Error('顧客情報の登録に失敗しました');
  return created.id as string;
}

/** テーブル割当（既存割当は置換）。table_id が null なら割当解除のみ行う。 */
export async function assignTable(reservationId: string, tableId: string | null) {
  const ctx = await requirePermission('reservations.write');
  const supabase = await createClient();
  const reservation = await loadReservation(supabase, ctx.organizationId, reservationId);

  if (tableId) {
    const { data: table } = await supabase
      .from('restaurant_tables')
      .select('id')
      .eq('id', tableId)
      .eq('store_id', reservation.store_id)
      .maybeSingle();
    if (!table) throw new Error('この店舗のテーブルではありません');
  }

  await supabase.from('reservation_tables').delete().eq('reservation_id', reservationId);
  if (tableId) {
    const { error } = await supabase.from('reservation_tables').insert({ reservation_id: reservationId, table_id: tableId });
    if (error) throw new Error('テーブル割当に失敗しました');
  }

  revalidateAll();
}

/** 着席処理: reservations.status=seated / 割当テーブルの current_status=seated */
export async function setSeated(reservationId: string) {
  const ctx = await requirePermission('reservations.write');
  const supabase = await createClient();
  const reservation = await loadReservation(supabase, ctx.organizationId, reservationId);
  if (!SEATABLE.includes(reservation.status)) {
    throw new Error(`「${reservation.status}」から着席には変更できません`);
  }

  const { data: links } = await supabase
    .from('reservation_tables')
    .select('table_id')
    .eq('reservation_id', reservationId);
  const tableIds = (links ?? []).map((l) => l.table_id as string);

  const { error } = await supabase.from('reservations').update({ status: 'seated', updated_by: ctx.userId }).eq('id', reservationId);
  if (error) throw new Error('着席処理に失敗しました');

  if (tableIds.length > 0) {
    await supabase.from('restaurant_tables').update({ current_status: 'seated' }).in('id', tableIds);
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: reservation.store_id,
    p_action: 'reservation.seated',
    p_target_table: 'reservations',
    p_target_id: reservationId,
    p_before: { status: reservation.status },
    p_after: { status: 'seated' },
    p_note: null,
  });

  revalidateAll();
}

/** 来店なし記録: status=no_show / customers.no_show_count 加算 / 監査ログ */
export async function markNoShow(reservationId: string, reason?: string) {
  const ctx = await requirePermission('reservations.write');
  const supabase = await createClient();
  const reservation = await loadReservation(supabase, ctx.organizationId, reservationId);
  if (!NO_SHOWABLE.includes(reservation.status)) {
    throw new Error(`「${reservation.status}」から来店なしには変更できません`);
  }

  const { error } = await supabase.from('reservations').update({ status: 'no_show', updated_by: ctx.userId }).eq('id', reservationId);
  if (error) throw new Error('処理に失敗しました');

  if (reservation.customer_id) {
    const { data: customer } = await supabase
      .from('customers')
      .select('no_show_count')
      .eq('id', reservation.customer_id)
      .single();
    await supabase
      .from('customers')
      .update({ no_show_count: (customer?.no_show_count ?? 0) + 1 })
      .eq('id', reservation.customer_id);
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: reservation.store_id,
    p_action: 'reservation.no_show',
    p_target_table: 'reservations',
    p_target_id: reservationId,
    p_before: { status: reservation.status },
    p_after: { status: 'no_show' },
    p_note: reason ?? null,
  });

  revalidateAll();
}

/** キャンセル（理由必須）: status=cancelled / customers.cancel_count 加算 / 監査ログ */
export async function cancelReservation(reservationId: string, reason: string) {
  const ctx = await requirePermission('reservations.cancel');
  if (!reason || !reason.trim()) throw new Error('キャンセル理由を入力してください');
  const supabase = await createClient();
  const reservation = await loadReservation(supabase, ctx.organizationId, reservationId);
  if (!CANCELLABLE.includes(reservation.status)) {
    throw new Error(`「${reservation.status}」からキャンセルには変更できません`);
  }

  const { error } = await supabase
    .from('reservations')
    .update({ status: 'cancelled', cancel_reason: reason.trim(), cancelled_at: new Date().toISOString(), updated_by: ctx.userId })
    .eq('id', reservationId);
  if (error) throw new Error('キャンセル処理に失敗しました');

  if (reservation.customer_id) {
    const { data: customer } = await supabase
      .from('customers')
      .select('cancel_count')
      .eq('id', reservation.customer_id)
      .single();
    await supabase
      .from('customers')
      .update({ cancel_count: (customer?.cancel_count ?? 0) + 1 })
      .eq('id', reservation.customer_id);
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: reservation.store_id,
    p_action: 'reservation.cancel',
    p_target_table: 'reservations',
    p_target_id: reservationId,
    p_before: { status: reservation.status },
    p_after: { status: 'cancelled' },
    p_note: reason.trim(),
  });

  revalidateAll();
}

/** 内部メモの更新 */
export async function updateReservationMemo(reservationId: string, memo: string) {
  const ctx = await requirePermission('reservations.write');
  const supabase = await createClient();
  await loadReservation(supabase, ctx.organizationId, reservationId);
  const { error } = await supabase
    .from('reservations')
    .update({ memo: memo.trim() || null, updated_by: ctx.userId })
    .eq('id', reservationId);
  if (error) throw new Error('メモの更新に失敗しました');
  revalidatePath('/app/reservations/list');
  revalidatePath('/app/reservations');
}

/**
 * 予約から注文を作成し POS へ遷移する。
 * 既に open な注文があればそれを再利用する。
 */
export async function createOrderFromReservation(reservationId: string) {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();
  const reservation = await loadReservation(supabase, ctx.organizationId, reservationId);

  const { data: existingOrder } = await supabase
    .from('orders')
    .select('id')
    .eq('reservation_id', reservationId)
    .eq('status', 'open')
    .limit(1)
    .maybeSingle();

  if (existingOrder) {
    redirect(`/app/pos?order=${existingOrder.id}`);
  }

  const { data: links } = await supabase
    .from('reservation_tables')
    .select('table_id')
    .eq('reservation_id', reservationId)
    .limit(1);
  const tableId = links?.[0]?.table_id ?? null;

  const { data: created, error } = await supabase
    .from('orders')
    .insert({
      organization_id: ctx.organizationId,
      store_id: reservation.store_id,
      reservation_id: reservationId,
      customer_id: reservation.customer_id,
      table_id: tableId,
      guest_count: reservation.party_size,
      order_type: 'dine_in',
      staff_id: ctx.userId,
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !created) throw new Error('注文の作成に失敗しました');

  revalidateAll();
  redirect(`/app/pos?order=${created.id}`);
}

export interface ManualReservationInput {
  storeId: string;
  date: string; // 'YYYY-MM-DD'
  time: string; // 'HH:MM'
  adults: number;
  children: number;
  name: string;
  kana?: string;
  phone: string;
  email?: string;
  note?: string;
}

/** 電話予約の手動登録 */
export async function createManualReservation(input: ManualReservationInput) {
  const ctx = await requirePermission('reservations.write');
  if (!ctx.stores.some((s) => s.id === input.storeId)) throw new Error('この店舗へのアクセス権限がありません');
  if (!input.name.trim() || input.phone.trim().length < 10) throw new Error('お名前・お電話番号をご確認ください');
  const partySize = input.adults + input.children;
  if (partySize < 1) throw new Error('ご人数をご確認ください');

  const supabase = await createClient();
  const stayMinutes = await getDefaultStayMinutes(supabase, input.storeId);
  const startAt = new Date(`${input.date}T${input.time}:00+09:00`);
  const endAt = new Date(startAt.getTime() + stayMinutes * 60000);

  const customerId = await findOrCreateCustomer(
    supabase,
    ctx.organizationId,
    input.storeId,
    input.name.trim(),
    input.phone,
    input.email?.trim() || null
  );

  const { data: source } = await supabase
    .from('reservation_sources')
    .select('id')
    .is('organization_id', null)
    .eq('code', 'phone')
    .maybeSingle();

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `TEL-${randomDigits(6)}`;
    const { error } = await supabase.from('reservations').insert({
      organization_id: ctx.organizationId,
      store_id: input.storeId,
      customer_id: customerId,
      code,
      reserved_date: input.date,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      party_size: partySize,
      adults: input.adults,
      children: input.children,
      guest_name: input.name.trim(),
      guest_name_kana: input.kana?.trim() || null,
      guest_phone: input.phone.trim(),
      guest_email: input.email?.trim() || null,
      request_note: input.note?.trim() || null,
      status: 'confirmed',
      source_id: source?.id ?? null,
      created_via: 'phone',
      consent_accepted: false,
      created_by: ctx.userId,
    });
    if (!error) {
      revalidateAll();
      return;
    }
    lastError = error;
    if ((error as { code?: string }).code !== '23505') break;
  }
  throw new Error(
    lastError instanceof Error ? lastError.message : '電話予約の登録に失敗しました'
  );
}

export interface WalkInInput {
  storeId: string;
  tableId: string;
  adults: number;
  children: number;
  name?: string;
  phone?: string;
}

/** ウォークイン即時登録: status=seated / テーブル=seated */
export async function createWalkInReservation(input: WalkInInput) {
  const ctx = await requirePermission('reservations.write');
  if (!ctx.stores.some((s) => s.id === input.storeId)) throw new Error('この店舗へのアクセス権限がありません');
  const partySize = input.adults + input.children;
  if (partySize < 1) throw new Error('ご人数をご確認ください');

  const supabase = await createClient();
  const { data: table } = await supabase
    .from('restaurant_tables')
    .select('id')
    .eq('id', input.tableId)
    .eq('store_id', input.storeId)
    .maybeSingle();
  if (!table) throw new Error('テーブルを選択してください');

  const stayMinutes = await getDefaultStayMinutes(supabase, input.storeId);
  const now = new Date();
  const endAt = new Date(now.getTime() + stayMinutes * 60000);
  const reservedDate = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  const customerId = input.phone?.trim()
    ? await findOrCreateCustomer(supabase, ctx.organizationId, input.storeId, input.name?.trim() || 'ウォークイン', input.phone, null)
    : null;

  const { data: source } = await supabase
    .from('reservation_sources')
    .select('id')
    .is('organization_id', null)
    .eq('code', 'walk_in')
    .maybeSingle();

  let reservationId: string | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `WALK-${randomDigits(6)}`;
    const { data: created, error } = await supabase
      .from('reservations')
      .insert({
        organization_id: ctx.organizationId,
        store_id: input.storeId,
        customer_id: customerId,
        code,
        reserved_date: reservedDate,
        start_at: now.toISOString(),
        end_at: endAt.toISOString(),
        party_size: partySize,
        adults: input.adults,
        children: input.children,
        guest_name: input.name?.trim() || '当日受付',
        guest_phone: input.phone?.trim() || '',
        status: 'seated',
        source_id: source?.id ?? null,
        created_via: 'walk_in',
        consent_accepted: false,
        created_by: ctx.userId,
      })
      .select('id')
      .single();
    if (!error && created) {
      reservationId = created.id as string;
      break;
    }
    lastError = error;
    if ((error as { code?: string } | null)?.code !== '23505') break;
  }
  if (!reservationId) {
    throw new Error(lastError instanceof Error ? lastError.message : 'ウォークイン登録に失敗しました');
  }

  await supabase.from('reservation_tables').insert({ reservation_id: reservationId, table_id: input.tableId });
  await supabase.from('restaurant_tables').update({ current_status: 'seated' }).eq('id', input.tableId);

  revalidateAll();
}
