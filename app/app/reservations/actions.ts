'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { canTransition, RESERVATION_STATUS, type ReservationStatus } from '@/lib/reservations';
import { MOVABLE_STATUSES, OCCUPYING_STATUSES } from '@/components/reservations/constants';

interface ReservationRow {
  id: string;
  organization_id: string;
  store_id: string;
  customer_id: string | null;
  party_size: number;
  status: ReservationStatus;
  reserved_date: string;
  start_at: string;
  end_at: string;
  is_private_hire: boolean;
}

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
    .select('id, organization_id, store_id, customer_id, party_size, status, reserved_date, start_at, end_at, is_private_hire')
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

/** テーブル割当（複数選択・全置換。テーブル結合対応）。tableIds が空配列なら割当解除のみ行う。 */
export async function assignTables(reservationId: string, tableIds: string[]) {
  const ctx = await requirePermission('reservations.write');
  const supabase = await createClient();
  const reservation = await loadReservation(supabase, ctx.organizationId, reservationId);

  const uniqueIds = [...new Set(tableIds)];
  if (uniqueIds.length > 0) {
    const { data: validTables } = await supabase
      .from('restaurant_tables')
      .select('id')
      .eq('store_id', reservation.store_id)
      .in('id', uniqueIds);
    if ((validTables?.length ?? 0) !== uniqueIds.length) {
      throw new Error('この店舗のテーブルではありません');
    }
  }

  await supabase.from('reservation_tables').delete().eq('reservation_id', reservationId);
  if (uniqueIds.length > 0) {
    const { error } = await supabase
      .from('reservation_tables')
      .insert(uniqueIds.map((tableId) => ({ reservation_id: reservationId, table_id: tableId })));
    if (error) throw new Error('テーブル割当に失敗しました');
  }

  revalidateAll();
}

/** 指定店舗・時間帯に重複して割当済みのテーブルID一覧（excludeReservationId自身は除く）。割当ダイアログの競合判定・自動候補算出に使う。 */
export async function getOccupiedTableIds(
  storeId: string,
  startAtIso: string,
  endAtIso: string,
  excludeReservationId?: string
): Promise<string[]> {
  await requirePermission('reservations.view');
  const supabase = await createClient();

  let query = supabase
    .from('reservations')
    .select('id, reservation_tables(table_id)')
    .eq('store_id', storeId)
    .in('status', OCCUPYING_STATUSES)
    .lt('start_at', endAtIso)
    .gt('end_at', startAtIso);
  if (excludeReservationId) query = query.neq('id', excludeReservationId);

  const { data } = await query;
  const ids = new Set<string>();
  for (const r of data ?? []) {
    for (const link of (r.reservation_tables ?? []) as { table_id: string }[]) {
      ids.add(link.table_id);
    }
  }
  return [...ids];
}

/**
 * ステータス遷移（来店待ち・来店・着席・会計待ち・会計済みなど）。
 * lib/reservations.ts の canTransition で許可された遷移のみ実行する。
 * キャンセル・無断キャンセルは理由入力が必須のため cancelReservation / markNoShow を使うこと。
 */
export async function transitionReservationStatus(reservationId: string, toStatus: ReservationStatus) {
  if (toStatus === 'cancelled' || toStatus === 'no_show') {
    throw new Error('この操作には理由の入力が必要です');
  }
  const ctx = await requirePermission('reservations.write');
  const supabase = await createClient();
  const reservation = await loadReservation(supabase, ctx.organizationId, reservationId);
  if (!canTransition(reservation.status, toStatus)) {
    throw new Error(
      `「${RESERVATION_STATUS[reservation.status].label}」から「${RESERVATION_STATUS[toStatus].label}」には変更できません`
    );
  }

  const { error } = await supabase
    .from('reservations')
    .update({ status: toStatus, updated_by: ctx.userId })
    .eq('id', reservationId);
  if (error) throw new Error('ステータスの更新に失敗しました');

  if (toStatus === 'seated' || toStatus === 'billing' || toStatus === 'completed') {
    const { data: links } = await supabase.from('reservation_tables').select('table_id').eq('reservation_id', reservationId);
    const tableIds = (links ?? []).map((l) => l.table_id as string);
    if (tableIds.length > 0) {
      const tableStatus = toStatus === 'seated' ? 'seated' : toStatus === 'billing' ? 'billing' : 'cleaning';
      await supabase.from('restaurant_tables').update({ current_status: tableStatus }).in('id', tableIds);
    }
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: reservation.store_id,
    p_action: 'reservation.status_change',
    p_target_table: 'reservations',
    p_target_id: reservationId,
    p_before: { status: reservation.status },
    p_after: { status: toStatus },
    p_note: null,
  });

  revalidateAll();
}

/** 来店なし記録: status=no_show / customers.no_show_count 加算 / 監査ログ */
export async function markNoShow(reservationId: string, reason?: string) {
  const ctx = await requirePermission('reservations.write');
  const supabase = await createClient();
  const reservation = await loadReservation(supabase, ctx.organizationId, reservationId);
  if (!canTransition(reservation.status, 'no_show')) {
    throw new Error(`「${RESERVATION_STATUS[reservation.status].label}」から無断キャンセルには変更できません`);
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
  if (!canTransition(reservation.status, 'cancelled')) {
    throw new Error(`「${RESERVATION_STATUS[reservation.status].label}」からキャンセルには変更できません`);
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

export interface MoveReservationInput {
  date: string; // 'YYYY-MM-DD'
  time: string; // 'HH:MM'
  stayMinutes: number;
}

/**
 * 予約の日時変更（開始時刻・滞在時間）。
 * ドラッグ&ドロップは未実装（将来対応時はタイムライン側からこのactionを呼び出す想定）。
 */
export async function moveReservation(reservationId: string, input: MoveReservationInput) {
  const ctx = await requirePermission('reservations.write');
  const supabase = await createClient();
  const reservation = await loadReservation(supabase, ctx.organizationId, reservationId);
  if (!MOVABLE_STATUSES.includes(reservation.status)) {
    throw new Error(`「${RESERVATION_STATUS[reservation.status].label}」の予約は日時を変更できません`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) {
    throw new Error('日時の形式が正しくありません');
  }
  const startAt = new Date(`${input.date}T${input.time}:00+09:00`);
  if (Number.isNaN(startAt.getTime())) throw new Error('日時の形式が正しくありません');
  const endAt = new Date(startAt.getTime() + input.stayMinutes * 60000);

  const { error } = await supabase
    .from('reservations')
    .update({
      reserved_date: input.date,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      updated_by: ctx.userId,
    })
    .eq('id', reservationId);
  if (error) throw new Error('日時の変更に失敗しました');

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: reservation.store_id,
    p_action: 'reservation.move',
    p_target_table: 'reservations',
    p_target_id: reservationId,
    p_before: { start_at: reservation.start_at, end_at: reservation.end_at },
    p_after: { start_at: startAt.toISOString(), end_at: endAt.toISOString() },
    p_note: null,
  });

  revalidateAll();
}

/** 担当者（店舗スタッフ）の設定・解除 */
export async function updateReservationStaff(reservationId: string, staffId: string | null) {
  const ctx = await requirePermission('reservations.write');
  const supabase = await createClient();
  await loadReservation(supabase, ctx.organizationId, reservationId);

  if (staffId) {
    const { data: membership } = await supabase
      .from('memberships')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .eq('profile_id', staffId)
      .eq('status', 'active')
      .maybeSingle();
    if (!membership) throw new Error('この組織のスタッフではありません');
  }

  const { error } = await supabase
    .from('reservations')
    .update({ staff_id: staffId, updated_by: ctx.userId })
    .eq('id', reservationId);
  if (error) throw new Error('担当者の更新に失敗しました');

  revalidateAll();
}

/**
 * 貸切設定の切替。この時間帯は他の予約を受け付けない（オンライン予約も満席表示になる）。
 * 店舗設定を扱える権限者のみ変更可・監査ログ必須。
 */
export async function updateReservationPrivateHire(reservationId: string, isPrivateHire: boolean) {
  const ctx = await requirePermission('store.settings');
  const supabase = await createClient();
  const reservation = await loadReservation(supabase, ctx.organizationId, reservationId);

  const { error } = await supabase
    .from('reservations')
    .update({ is_private_hire: isPrivateHire, updated_by: ctx.userId })
    .eq('id', reservationId);
  if (error) throw new Error('貸切設定の更新に失敗しました');

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: reservation.store_id,
    p_action: 'reservation.private_hire_change',
    p_target_table: 'reservations',
    p_target_id: reservationId,
    p_before: { is_private_hire: reservation.is_private_hire },
    p_after: { is_private_hire: isPrivateHire },
    p_note: null,
  });

  revalidateAll();
}

export interface ReservationDetailsInput {
  adults: number;
  children: number;
  guestPhone: string;
  guestEmail: string | null;
  seatType: string | null;
  purpose: string | null;
  allergyNote: string | null;
  requestNote: string | null;
}

/** 予約内容（人数内訳・連絡先・席の希望・利用目的・アレルギー・ご要望）の編集 */
export async function updateReservationDetails(reservationId: string, input: ReservationDetailsInput) {
  const ctx = await requirePermission('reservations.write');
  if (!input.guestPhone.trim()) throw new Error('電話番号を入力してください');
  const partySize = input.adults + input.children;
  if (partySize < 1) throw new Error('ご人数をご確認ください');

  const supabase = await createClient();
  await loadReservation(supabase, ctx.organizationId, reservationId);

  const { error } = await supabase
    .from('reservations')
    .update({
      adults: input.adults,
      children: input.children,
      party_size: partySize,
      guest_phone: input.guestPhone.trim(),
      guest_email: input.guestEmail?.trim() || null,
      seat_type: input.seatType?.trim() || null,
      purpose: input.purpose?.trim() || null,
      allergy_note: input.allergyNote?.trim() || null,
      request_note: input.requestNote?.trim() || null,
      updated_by: ctx.userId,
    })
    .eq('id', reservationId);
  if (error) throw new Error('予約内容の更新に失敗しました');

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
  /** キャンセル待ちからの変換の場合に指定。作成成功時に waitlist_entries.status を converted にする */
  waitlistEntryId?: string;
}

/** 電話予約の手動登録（キャンセル待ちからの予約変換も兼ねる） */
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
      if (input.waitlistEntryId) {
        await supabase
          .from('waitlist_entries')
          .update({ status: 'converted', updated_by: ctx.userId })
          .eq('id', input.waitlistEntryId);
      }
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

export interface WaitlistInput {
  storeId: string;
  name: string;
  phone: string;
  partySize: number;
  desiredDate: string; // 'YYYY-MM-DD'
  timeFrom?: string; // 'HH:MM'
  timeTo?: string; // 'HH:MM'
  note?: string;
}

/** キャンセル待ちの登録 */
export async function createWaitlistEntry(input: WaitlistInput) {
  const ctx = await requirePermission('reservations.write');
  if (!ctx.stores.some((s) => s.id === input.storeId)) throw new Error('この店舗へのアクセス権限がありません');
  if (!input.name.trim() || input.phone.trim().length < 10) throw new Error('お名前・お電話番号をご確認ください');
  if (input.partySize < 1) throw new Error('ご人数をご確認ください');

  const supabase = await createClient();
  const { error } = await supabase.from('waitlist_entries').insert({
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    guest_name: input.name.trim(),
    guest_phone: input.phone.trim(),
    party_size: input.partySize,
    desired_date: input.desiredDate,
    desired_time_from: input.timeFrom || null,
    desired_time_to: input.timeTo || null,
    note: input.note?.trim() || null,
    created_by: ctx.userId,
  });
  if (error) throw new Error('キャンセル待ちの登録に失敗しました');
  revalidatePath('/app/reservations');
}

async function loadWaitlistEntry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  id: string
) {
  const { data, error } = await supabase
    .from('waitlist_entries')
    .select('id, organization_id, status')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .single();
  if (error || !data) throw new Error('キャンセル待ちが見つかりません');
  return data;
}

/** 連絡済みにする */
export async function markWaitlistContacted(id: string) {
  const ctx = await requirePermission('reservations.write');
  const supabase = await createClient();
  await loadWaitlistEntry(supabase, ctx.organizationId, id);
  const { error } = await supabase.from('waitlist_entries').update({ status: 'contacted', updated_by: ctx.userId }).eq('id', id);
  if (error) throw new Error('更新に失敗しました');
  revalidatePath('/app/reservations');
}

/** 期限切れにする */
export async function markWaitlistExpired(id: string) {
  const ctx = await requirePermission('reservations.write');
  const supabase = await createClient();
  await loadWaitlistEntry(supabase, ctx.organizationId, id);
  const { error } = await supabase.from('waitlist_entries').update({ status: 'expired', updated_by: ctx.userId }).eq('id', id);
  if (error) throw new Error('更新に失敗しました');
  revalidatePath('/app/reservations');
}

/** 取消 */
export async function cancelWaitlistEntry(id: string) {
  const ctx = await requirePermission('reservations.write');
  const supabase = await createClient();
  await loadWaitlistEntry(supabase, ctx.organizationId, id);
  const { error } = await supabase.from('waitlist_entries').update({ status: 'cancelled', updated_by: ctx.userId }).eq('id', id);
  if (error) throw new Error('更新に失敗しました');
  revalidatePath('/app/reservations');
}
