import type { Metadata } from 'next';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { formatDateTime, formatTime, todayJst } from '@/lib/format';
import { requireHandyClerk } from '@/lib/handy-session';
import { handyDayLabel, handyEmptyText, handyReservationsHref, handyReservationsTitle, parseHandyDate } from '@/lib/handy-reservations';
import { HandyAddReservationButton, HandyReservationDateBar } from '@/components/handy/handy-reservation-date-bar';
import { loadReservationTags } from '@/lib/reservation-tags-server';
import { RESERVATION_STATUS, type ReservationStatus } from '@/lib/reservations';
import { CREATED_VIA_LABEL } from '@/components/reservations/constants';
import {
  HandyMain,
  HandyMenuButton,
  HandyRefreshButton,
  HandyTopBar,
} from '@/components/handy/handy-chrome';
import {
  HandyReservationList,
  type HandyReservationRow,
} from '@/components/handy/handy-reservation-list';
import { loadReservationInbox } from '@/lib/reservation-inbox-server';
import { reservationClerkOptions } from '@/lib/reservation-clerks-server';
import {
  InboxNoticeList,
  InboxTaskList,
  ReservationInboxTabs,
  type InboxTab,
} from '@/components/reservations/inbox/reservation-inbox';

export const metadata: Metadata = { title: '予約' };

/** ハンディに出す予約の状態（キャンセル待ちは台帳側の管理なので出さない） */
const LISTED_STATUSES: ReservationStatus[] = [
  'pending',
  'confirmed',
  'waiting',
  'arrived',
  'seated',
  'billing',
  'completed',
  'no_show',
  'cancelled',
];
const UPCOMING: ReadonlySet<string> = new Set(['pending', 'confirmed', 'waiting', 'arrived', 'seated', 'billing']);
/**
 * ウォークイン（レジで卓を開いたときに自動でできる予約）は、履歴として出す：店にいる（着席・会計待ち）か、会計して帰った（退店）ものだけ。
 * 注文せずに戻った・取消したウォークインは出さない（何も起きていないので）。2026-10-20 Ronnie「予約一覧で履歴を見られるように」
 */
const WALK_IN_HISTORY: ReadonlySet<string> = new Set(['seated', 'billing', 'completed']);

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

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

/**
 * 予約（承認済みレイアウトの RESERVATION）。既定は今日。?date=YYYY-MM-DD でほかの日も見られる
 * （2026-10-15 Ronnie「ハンディの予約でほかの日も見られるように。予約の追加もハンディで」）。
 * ウォークイン（ハンディ・フロアで着席させたもの）は予約ではないので出さない。
 */
export default async function HandyReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[]; tab?: string | string[] }>;
}) {
  const ctx = await requireFeature('pos');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store || !can(ctx.role, 'reservations.view')) {
    return (
      <>
        <HandyTopBar left={<HandyMenuButton />} title="今日の予約" />
        <HandyMain>
          <p className="px-6 py-10 text-center text-[13px] leading-loose text-[#766b62]">
            {store
              ? '予約を見る権限がありません。店長・管理者に権限の付与を依頼してください。'
              : 'アクセス可能な店舗がありません。管理者に店舗の割り当てを依頼してください。'}
          </p>
        </HandyMain>
      </>
    );
  }
  await requireHandyClerk(); // 担当者を選んでいなければログイン画面へ

  const supabase = await createClient();
  const today = todayJst();
  const sp = await searchParams;
  const date = parseHandyDate(sp.date, today);
  // 上のタブ：予約一覧 ｜ 受付管理 ｜ メッセージ（2026-10-19 Ronnie「予約の画面の上のタブに」）
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: InboxTab = tabParam === 'inbox' || tabParam === 'messages' ? tabParam : 'list';
  const title = tab === 'inbox' ? '予約受付管理' : tab === 'messages' ? 'メッセージ' : handyReservationsTitle(date, today);
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
  const cancelStaff = (await staffPromise)[store.id] ?? [];
  // キーワード（列が無いデータベースでも一覧は出る。lib/reservation-tags-server.ts）
  const tagsById = await loadReservationTags(supabase, (rows ?? []).map((r) => r.id as string));
  const tableByReservation = new Map<string, string>();
  /** 会計した伝票：予約ごとの合計（別々会計なら足す）と伝票番号 */
  const billByReservation = new Map<string, { total: number; orderNos: number[]; paidAt: string | null }>();
  for (const o of (openOrders ?? []) as { id: string; order_no: number | null; reservation_id: string | null; table_id: string | null; status: string; total: number | null; closed_at: string | null }[]) {
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

  const listed = ((rows ?? []) as unknown as ReservationRow[]).filter(
    (r) => r.created_via !== 'walk_in' || WALK_IN_HISTORY.has(r.status)
  );
  const reservations: HandyReservationRow[] = listed.map((r) => {
    const names = (r.reservation_tables ?? [])
      .map((l) => one(l.restaurant_tables)?.name)
      .filter((n): n is string => !!n);
    const status = (r.status in RESERVATION_STATUS ? r.status : 'pending') as ReservationStatus;
    return {
      id: r.id,
      time: formatTime(r.start_at),
      endTime: r.end_at ? formatTime(r.end_at) : null,
      name: r.guest_name,
      phone: r.guest_phone?.trim() || null,
      partySize: r.party_size,
      tableLabel: names.length > 0 ? names.join('+') : '席未定',
      sourceLabel: one(r.reservation_sources)?.name ?? CREATED_VIA_LABEL[r.created_via] ?? r.created_via,
      tags: tagsById.get(r.id) ?? [],
      tableIds: (r.reservation_tables ?? []).map((l) => (l as { table_id?: string }).table_id).filter((v): v is string => !!v),
      courseName: one(r.course)?.name ?? null,
      status,
      statusLabel: RESERVATION_STATUS[status].label,
      upcoming: UPCOMING.has(status),
      request: r.request_note || null,
      memo: r.memo || null,
      note: r.request_note || r.memo || null,
      tableId: tableByReservation.get(r.id) ?? null,
      // 詳細のポップアップ（2026-10-16 Ronnie「予約を押したら詳細をポップアップで」）
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
      billTotal: billByReservation.get(r.id)?.total ?? null,
      billOrderNos: billByReservation.get(r.id)?.orderNos ?? [],
      paidAt: billByReservation.get(r.id)?.paidAt ? formatTime(billByReservation.get(r.id)!.paidAt!) : null,
    };
  });

  return (
    <>
      <HandyTopBar
        left={<HandyMenuButton />}
        storeName={store.name}
        title={title}
        right={
          // 右：更新と ＋予約登録（2026-10-19 Ronnie「予約の追加は上に。すっきりと」）
          <div className="flex items-center justify-end">
            <HandyRefreshButton labeled />
            {can(ctx.role, 'reservations.write') && <HandyAddReservationButton date={date} />}
          </div>
        }
      />
      {/* 担当者の行（Sankar など）は出さない：≡ の中に「担当者を変更（名前）」がある（2026-10-20 Ronnie「人の名前は ≡ の中へ。ここには要らない」） */}
      <ReservationInboxTabs
        active={tab}
        hrefs={{
          list: handyReservationsHref(date, today),
          inbox: '/handy/reservations?tab=inbox',
          messages: '/handy/reservations?tab=messages',
        }}
        taskCount={inbox.tasks.length}
        noticeTimes={inbox.notices.map((n) => n.at)}
        storeId={store.id}
        variant="handy"
      />
      <HandyMain>
        {tab === 'inbox' ? (
          <InboxTaskList
            tasks={inbox.tasks}
            canAcknowledge={inbox.canAcknowledge}
            canWrite={can(ctx.role, 'reservations.write')}
            variant="handy"
          />
        ) : tab === 'messages' ? (
          <InboxNoticeList notices={inbox.notices} storeId={store.id} variant="handy" />
        ) : (
          <>
            <HandyReservationDateBar date={date} today={today} />
            {/* 「ご予約リンクを紹介」はここには出さない（≡ の中だけ。2026-10-19 Ronnie「ここには要らない」） */}
            <HandyReservationList
              reservations={reservations}
              emptyText={handyEmptyText(date, today)}
              dateLabel={handyDayLabel(date)}
              actions={{
                storeId: store.id,
                date,
                today,
                canWrite: can(ctx.role, 'reservations.write'),
                canCancel: can(ctx.role, 'reservations.cancel'),
                staff: cancelStaff,
              }}
            />
            <p className="px-5 pb-5 text-center text-[10px] leading-relaxed text-[#766b62]">
              予約を押すと、来店・キャンセル・テーブル変更ができます。
            </p>
          </>
        )}
      </HandyMain>
    </>
  );
}
