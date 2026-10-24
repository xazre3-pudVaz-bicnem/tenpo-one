import 'server-only';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { readHandyClerk } from '@/lib/handy-session';
import { formatDateTime, formatTime, todayJst } from '@/lib/format';
import { handyDayLabel, handyEmptyText, handyReservationsTitle, parseHandyDate, shiftDate } from '@/lib/handy-reservations';
import { loadReservationTags } from '@/lib/reservation-tags-server';
import { RESERVATION_STATUS, type ReservationStatus } from '@/lib/reservations';
import { CREATED_VIA_LABEL } from '@/components/reservations/constants';
import { loadReservationInbox } from '@/lib/reservation-inbox-server';
import { reservationClerkOptions } from '@/lib/reservation-clerks-server';
import { loadReservationEntryData } from '@/lib/reservation-entry-server';
import { stayLabel } from '@/lib/reservation-entry';
import { cancelReasonText } from '@/lib/reservation-cancel';
import {
  acknowledgeReservation,
  assignTables,
  cancelReservation,
  confirmPendingReservation,
  createManualReservation,
  getReservationCalendar,
  markNoShow,
  markReservationContacted,
  resolveInboxImport,
  transitionReservationStatus,
} from '@/app/app/reservations/actions';
import { nativeBad, nativeErrorText } from '@/lib/native-modules/guard';
import { isRequestFromStoreNetwork } from '@/lib/store-access-server';
import { ACCESS_MESSAGE } from '@/lib/store-access';
import {
  handyMonthGrid,
  handyMonthRange,
  handyRsvStayMinutes,
  isHandyRsvOpen,
  parseHandyRsvMonth,
  parseHandyRsvTab,
  parseNativeHandyRsvAction,
  shiftHandyMonth,
} from '@/lib/native-handy-reservations';
import type { NativeModuleArgs, NativeModuleGet, NativeModulePost, NativeModuleResult } from '@/lib/native-modules/registry';

/**
 * iPhone アプリのネイティブのハンディ：予約（RESERVATION）の画面（2026-10-25 Ronnie「iPhone も native に。デザインは iPad のネイティブ」）。
 * 中身・操作は Web のハンディの予約（app/handy/reservations・reservations/new、components/handy/handy-reservation-*.tsx、
 * components/reservations/inbox/reservation-inbox.tsx）と同じ。Web のハンディは変えない（店が営業中）。
 * 権限も Web と同じ：見る＝reservations.view、来店・テーブル変更・受付管理・登録＝reservations.write、
 * キャンセル＝reservations.cancel（無断キャンセルは reservations.write）。中の Server Action も同じ権限を見る。
 * 担当者（ハンディのログインで選んだ人）が要る：Cookie tenpo_handy_clerk（アプリは WKWebView の Cookie をそのまま送る）。
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ハンディに出す予約の状態（キャンセル待ちは台帳側の管理なので出さない。Web と同じ） */
const LISTED_STATUSES: ReservationStatus[] = ['pending', 'confirmed', 'waiting', 'arrived', 'seated', 'billing', 'completed', 'no_show', 'cancelled'];
const UPCOMING: ReadonlySet<string> = new Set(['pending', 'confirmed', 'waiting', 'arrived', 'seated', 'billing']);
/** ウォークインは店にいる（着席・会計待ち）か、会計して帰った（退店）ものだけ履歴として出す（Web と同じ） */
const WALK_IN_HISTORY: ReadonlySet<string> = new Set(['seated', 'billing', 'completed']);

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

type GuardOk = { clerk: { id: string; name: string } };

async function rsvGuard(ctx: NativeModuleArgs['ctx'], need: 'view' | 'write'): Promise<GuardOk | NativeModuleResult> {
  if (ctx.disabledFeatures?.has('pos')) return nativeBad('この機能は使えません', 403);
  if (!can(ctx.role, 'reservations.view')) return nativeBad('予約を見る権限がありません。店長・管理者に権限の付与を依頼してください。', 403);
  if (need === 'write' && !can(ctx.role, 'reservations.write')) {
    return nativeBad('予約を追加・変更する権限がありません。店長・管理者に権限の付与を依頼してください。', 403);
  }
  const clerk = await readHandyClerk();
  if (!clerk?.id) return { status: 409, body: { ok: false, error: '担当者を選んでください', needClerk: true } };
  return { clerk: { id: clerk.id, name: clerk.name } };
}

interface ReservationRow {
  id: string;
  start_at: string;
  end_at: string | null;
  guest_name: string;
  guest_phone: string | null;
  party_size: number;
  status: string;
  created_via: string;
  request_note: string | null;
  memo: string | null;
  code: string | null;
  guest_name_kana: string | null;
  guest_email: string | null;
  adults: number | null;
  children: number | null;
  allergy_note: string | null;
  seat_type: string | null;
  purpose: string | null;
  clerk_name?: string | null;
  cancel_reason: string | null;
  created_at: string | null;
  course: One<{ name: string }>;
  reservation_sources: One<{ name: string }>;
  reservation_tables: { table_id: string; restaurant_tables: One<{ name: string }> }[] | null;
}

/** 予約一覧・受付管理・メッセージ（Web の /handy/reservations と同じ中身。?date= ?tab=） */
export const handyReservationsGet: NativeModuleGet = async ({ ctx, store, url }) => {
  const g = await rsvGuard(ctx, 'view');
  if (!('clerk' in g)) return g;
  // 契約のアクセス制限（お店の回線）。Web のハンディ（app/handy/layout.tsx）と同じ。お客様の電話番号などが出るので
  if (!(await isRequestFromStoreNetwork(store.id))) return nativeBad(ACCESS_MESSAGE.network, 403);
  const supabase = await createClient();
  const today = todayJst();
  const date = parseHandyDate(url.searchParams.get('date'), today);
  const tab = parseHandyRsvTab(url.searchParams.get('tab'));

  const inboxPromise = loadReservationInbox(supabase, store.id, today);
  // 店舗キャンセルの担当（レジの担当名。2026-10-20 Ronnie「担当選択必ず」）
  const staffPromise = reservationClerkOptions(supabase, [store.id]);
  const [{ data: rows }, { data: openOrders }] = await Promise.all([
    supabase
      .from('reservations')
      .select(
        'id, start_at, end_at, guest_name, guest_phone, party_size, status, created_via, request_note, memo, code, guest_name_kana, guest_email, adults, children, allergy_note, seat_type, purpose, clerk_name, cancel_reason, created_at, course:menu_items(name), reservation_sources(name), reservation_tables(table_id, restaurant_tables(name))'
      )
      .eq('store_id', store.id)
      .eq('reserved_date', date)
      .in('status', LISTED_STATUSES)
      .order('start_at'),
    // 会計前の伝票（HANDY で注文へ）と、会計した伝票（金額を履歴に出す）
    supabase
      .from('orders')
      .select('id, order_no, reservation_id, table_id, status, total, closed_at')
      .eq('store_id', store.id)
      .in('status', ['open', 'paid'])
      .not('reservation_id', 'is', null)
      .gte('created_at', `${date}T00:00:00+09:00`)
      .lt('created_at', `${date}T23:59:59.999+09:00`)
      .order('created_at'),
  ]);
  const inbox = await inboxPromise;
  const staff = (await staffPromise)[store.id] ?? [];
  const tagsById = await loadReservationTags(supabase, (rows ?? []).map((r) => r.id as string));

  const tableByReservation = new Map<string, string>();
  const billByReservation = new Map<string, { total: number; orderNos: number[]; paidAt: string | null }>();
  type OrderRow = { id: string; order_no: number | null; reservation_id: string | null; table_id: string | null; status: string; total: number | null; closed_at: string | null };
  for (const o of (openOrders ?? []) as OrderRow[]) {
    if (!o.reservation_id) continue;
    if (o.status === 'open' && o.table_id) tableByReservation.set(o.reservation_id, o.table_id);
    if (o.status === 'paid') {
      const cur = billByReservation.get(o.reservation_id) ?? { total: 0, orderNos: [], paidAt: null };
      cur.total += o.total ?? 0;
      if (o.order_no != null) cur.orderNos.push(o.order_no);
      if (o.closed_at && (!cur.paidAt || o.closed_at > cur.paidAt)) cur.paidAt = o.closed_at;
      billByReservation.set(o.reservation_id, cur);
    }
  }

  const listed = ((rows ?? []) as unknown as ReservationRow[]).filter((r) => r.created_via !== 'walk_in' || WALK_IN_HISTORY.has(r.status));
  const reservations = listed.map((r) => {
    const names = (r.reservation_tables ?? []).map((l) => one(l.restaurant_tables)?.name).filter((n): n is string => !!n);
    const status = (r.status in RESERVATION_STATUS ? r.status : 'pending') as ReservationStatus;
    const time = formatTime(r.start_at);
    const endTime = r.end_at ? formatTime(r.end_at) : null;
    const stay = handyRsvStayMinutes(time, endTime);
    const bill = billByReservation.get(r.id);
    return {
      id: r.id,
      time,
      endTime,
      stayMinutes: stay,
      stayLabel: stayLabel(stay),
      name: r.guest_name,
      phone: r.guest_phone?.trim() || null,
      partySize: r.party_size,
      tableLabel: names.length > 0 ? names.join('+') : '席未定',
      tableIds: (r.reservation_tables ?? []).map((l) => l.table_id).filter((v): v is string => !!v),
      sourceLabel: one(r.reservation_sources)?.name ?? CREATED_VIA_LABEL[r.created_via] ?? r.created_via,
      tags: tagsById.get(r.id) ?? [],
      courseName: one(r.course)?.name ?? null,
      status,
      statusLabel: RESERVATION_STATUS[status].label,
      upcoming: UPCOMING.has(status),
      /** 来店・キャンセル・テーブル変更ができる（来店前） */
      open: isHandyRsvOpen(status),
      request: r.request_note || null,
      memo: r.memo || null,
      /** 着席済み（会計前の伝票がある）なら、その卓（HANDY で注文へ） */
      tableId: tableByReservation.get(r.id) ?? null,
      code: r.code || null,
      nameKana: r.guest_name_kana?.trim() || null,
      adults: r.adults ?? null,
      children: r.children ?? null,
      email: r.guest_email?.trim() || null,
      allergy: r.allergy_note?.trim() || null,
      seatType: r.seat_type?.trim() || null,
      purpose: r.purpose?.trim() || null,
      clerkName: r.clerk_name?.trim() || null,
      cancelReason: r.cancel_reason?.trim() || null,
      receivedAt: r.created_at ? formatDateTime(r.created_at) : null,
      walkIn: r.created_via === 'walk_in',
      billTotal: bill?.total ?? null,
      billOrderNos: bill?.orderNos ?? [],
      paidAt: bill?.paidAt ? formatTime(bill.paidAt) : null,
    };
  });

  return {
    body: {
      ok: true,
      store: { id: store.id, name: store.name },
      clerk: g.clerk,
      today,
      date,
      tab,
      title: handyReservationsTitle(date, today),
      dayLabel: handyDayLabel(date),
      emptyText: handyEmptyText(date, today),
      prevDate: shiftDate(date, -1),
      nextDate: shiftDate(date, 1),
      canWrite: can(ctx.role, 'reservations.write'),
      canCancel: can(ctx.role, 'reservations.cancel'),
      staff,
      reservations,
      inbox: { tasks: inbox.tasks, notices: inbox.notices, canAcknowledge: inbox.canAcknowledge },
    },
  };
};

/**
 * 予約登録・テーブル変更に使うその日のデータ（Web の getReservationEntryData と同じ：卓・その日の予約の時間と卓・確保時間・
 * キーワード・担当者・コースの所要時間）と、予約登録の選ぶ欄（予約経路・コース。Web の /handy/reservations/new と同じ）。
 * ?exclude=<予約> はテーブル変更のとき、その予約自身を「予約あり」に数えない
 */
export const handyReservationEntryGet: NativeModuleGet = async ({ ctx, store, url }) => {
  const g = await rsvGuard(ctx, 'write');
  if (!('clerk' in g)) return g;
  const today = todayJst();
  const date = parseHandyDate(url.searchParams.get('date'), today);
  const exclude = url.searchParams.get('exclude');
  const supabase = await createClient();
  const [{ data: sources }, { data: courseRows }, entry] = await Promise.all([
    supabase
      .from('reservation_sources')
      .select('code, name')
      .or(`organization_id.is.null,organization_id.eq.${ctx.organizationId}`)
      .eq('status', 'active')
      .order('sort_order'),
    supabase
      .from('menu_items')
      .select('id, name, store_id')
      .eq('organization_id', ctx.organizationId as string)
      .eq('item_type', 'course')
      .eq('status', 'active')
      .order('sort_order'),
    loadReservationEntryData(supabase, store.id, date),
  ]);
  return {
    body: {
      ok: true,
      date,
      today,
      ...entry,
      booked: exclude && UUID.test(exclude) ? entry.booked.filter((b) => b.id !== exclude) : entry.booked,
      // web・ウォークインは自動で付くので選ばない（予約台帳と同じ）
      sources: (sources ?? [])
        .filter((s) => s.code !== 'web' && s.code !== 'walk_in')
        .map((s) => ({ value: s.code as string, label: s.name as string })),
      courses: (courseRows ?? [])
        .filter((c) => c.store_id == null || c.store_id === store.id)
        .map((c) => ({ value: c.id as string, label: c.name as string })),
      clerk: g.clerk,
    },
  };
};

/** 日付選択のカレンダー（Web の ReservationCalendarSheet と同じ：日ごとの予約人数・休業日・仮予約／要連絡・祝日）。?month=YYYY-MM */
export const handyReservationMonthGet: NativeModuleGet = async ({ ctx, store, url }) => {
  const g = await rsvGuard(ctx, 'view');
  if (!('clerk' in g)) return g;
  const today = todayJst();
  const month = parseHandyRsvMonth(url.searchParams.get('month'), today);
  const { from, to } = handyMonthRange(month);
  try {
    const data = await getReservationCalendar(store.id, from, to);
    return {
      body: { ok: true, today, month, prevMonth: shiftHandyMonth(month, -1), nextMonth: shiftHandyMonth(month, 1), weeks: handyMonthGrid(month, data) },
    };
  } catch (e) {
    return nativeBad(nativeErrorText(e, 'カレンダーを読めませんでした'));
  }
};

/** 予約の操作（中身は Web のハンディと同じ Server Action） */
export const handyReservationPost: NativeModulePost = async ({ ctx, store, raw }) => {
  const parsed = parseNativeHandyRsvAction(raw);
  if (!parsed.ok) return nativeBad(parsed.error);
  const a = parsed.action;
  // 操作は reservations.write（Web の詳細も予約の登録の権限が無いと操作を出さない）。
  // キャンセル（お客様・店舗）はさらに reservations.cancel（Web と同じ。無断キャンセルは write だけ）
  const g = await rsvGuard(ctx, 'write');
  if (!('clerk' in g)) return g;
  if (a.type === 'handyRsvCancel' && a.kind !== 'no_show' && !can(ctx.role, 'reservations.cancel')) {
    return nativeBad('予約をキャンセルする権限がありません', 403);
  }

  try {
    switch (a.type) {
      case 'handyRsvArrive': {
        const r = await loadOpenReservation(store.id, a.reservationId);
        if ('error' in r) return nativeBad(r.error, r.status);
        // 仮予約はいったん確定にしてから来店（Web と同じ）
        if (r.status === 'pending') await transitionReservationStatus(a.reservationId, 'confirmed');
        await transitionReservationStatus(a.reservationId, 'arrived');
        return { body: { ok: true, message: `${r.name} 様を来店にしました` } };
      }
      case 'handyRsvCancel': {
        const r = await loadOpenReservation(store.id, a.reservationId);
        if ('error' in r) return nativeBad(r.error, r.status);
        if (a.kind === 'no_show') {
          if (r.status === 'pending') return nativeBad('仮予約は無断キャンセルにできません');
          await markNoShow(a.reservationId, cancelReasonText('no_show'));
          return { body: { ok: true, message: '無断キャンセルにしました' } };
        }
        if (a.kind === 'store') {
          // 担当はこの店舗のレジの担当名から（Web の担当の選択と同じ一覧）
          const staff = (await reservationClerkOptions(await createClient(), [store.id]))[store.id] ?? [];
          const who = staff.find((s) => s.id === a.staffId);
          if (!who) return nativeBad('担当を選んでください');
          await cancelReservation(a.reservationId, cancelReasonText('store', { staffName: who.name }));
          return { body: { ok: true, message: `店舗キャンセルにしました（担当: ${who.name}）` } };
        }
        await cancelReservation(a.reservationId, cancelReasonText('guest'));
        return { body: { ok: true, message: 'お客様キャンセルにしました' } };
      }
      case 'handyRsvTables': {
        const r = await loadOpenReservation(store.id, a.reservationId);
        if ('error' in r) return nativeBad(r.error, r.status);
        await assignTables(a.reservationId, a.tableIds);
        return { body: { ok: true, message: 'テーブルを変更しました' } };
      }
      case 'handyRsvInbox': {
        if (a.act === 'confirm') await confirmPendingReservation(a.id);
        else if (a.act === 'contacted') await markReservationContacted(a.id);
        else if (a.act === 'ack') await acknowledgeReservation(a.id);
        else await resolveInboxImport(a.id);
        const message = a.act === 'confirm' ? '予約を確定しました' : a.act === 'contacted' ? '連絡済みにしました' : a.act === 'ack' ? '確認済みにしました' : '対応済みにしました';
        return { body: { ok: true, message } };
      }
      case 'handyRsvCreate': {
        const i = a.input;
        await createManualReservation({
          storeId: store.id,
          date: i.date,
          time: i.time,
          adults: i.adults,
          children: i.children,
          name: i.name,
          phone: i.phone,
          note: i.note || undefined,
          sourceCode: i.sourceCode || undefined,
          courseId: i.courseId,
          tableIds: i.tableIds,
          stayMinutes: i.stayMinutes,
          status: i.status,
          tags: i.tags,
          clerkId: i.clerkId,
        });
        return { body: { ok: true, date: i.date, message: '予約を追加しました' } };
      }
    }
  } catch (e) {
    return nativeBad(nativeErrorText(e, '変更できませんでした'));
  }
};

/** 詳細から操作できる予約か（この店舗の・来店前の予約。Web の詳細は来店前の予約にだけ 来店・キャンセル・テーブル変更 を出す） */
async function loadOpenReservation(
  storeId: string,
  reservationId: string
): Promise<{ status: string; name: string } | { error: string; status: number }> {
  const supabase = await createClient();
  const { data } = await supabase.from('reservations').select('id, store_id, status, guest_name').eq('id', reservationId).maybeSingle();
  if (!data || data.store_id !== storeId) return { error: '予約が見つかりません', status: 404 };
  const status = data.status as string;
  if (!isHandyRsvOpen(status)) {
    const label = RESERVATION_STATUS[status as ReservationStatus]?.label ?? status;
    return { error: `「${label}」の予約は変更できません`, status: 409 };
  }
  return { status, name: (data.guest_name as string) ?? '' };
}
