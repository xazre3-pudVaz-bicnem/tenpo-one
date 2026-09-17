import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StoreRealtimeRefresh } from '@/components/realtime/store-realtime-refresh';
import { DateNav } from '@/components/reservations/date-nav';
import type { ReservationCardData } from '@/components/reservations/reservation-card';
import { WaitlistDialog } from '@/components/reservations/waitlist-dialog';
import { WaitlistPanel, type WaitlistRow, type WaitlistStatus } from '@/components/reservations/waitlist-panel';
import { WaitingTicketDialog } from '@/components/reservations/waiting-ticket-dialog';
import { WaitingQueuePanel, type WaitingTicketRow, type WaitingHint } from '@/components/reservations/waiting-queue-panel';
import type { GuideTableOption } from '@/components/reservations/guide-table-dialog';
import { ACTIVE_TIMELINE_STATUSES } from '@/components/reservations/constants';
import { loadLedgerChrome } from '@/components/reservations/ledger-data';
import { LedgerTop, LedgerSummaryTiles, type LedgerTabKey } from '@/components/reservations/ledger-header';
import { ScheduleBoard, BOARD_SLOT, type BoardTable } from '@/components/reservations/schedule-board';
import { suggestTables, type TableLike, type ReservationStatus } from '@/lib/reservations';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: '店舗台帳' };

const DEFAULT_START_MIN = 11 * 60;
const DEFAULT_END_MIN = 23 * 60;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** テーブルの現在状態（restaurant_tables.current_status）の表示名 */
const TABLE_STATUS_LABEL: Record<string, string> = {
  available: '空席',
  reserved: '予約あり',
  waiting: 'キャンセル待ち',
  seated: '着席中',
  ordering: '注文中',
  billing: '会計中',
  cleaning: '清掃中',
  unavailable: '利用停止',
};

// ---- 日付ユーティリティ（すべてJST暦日として純粋なUTC計算で扱い、サーバーのタイムゾーン設定に依存しない） ----

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function dowOfDateStr(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function shiftDateStr(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toDateStr(dt);
}

/** timestamptz → JST時刻（分） */
function jstMinutes(iso: string): number {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

function parseTimeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

interface BusinessHourRow {
  day_of_week: number;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
}

// ---- 予約データ取得・整形 ----

interface RawReservation {
  id: string;
  code: string;
  store_id: string;
  reserved_date: string;
  start_at: string;
  end_at: string;
  guest_name: string;
  guest_name_kana: string | null;
  guest_phone: string;
  guest_email: string | null;
  party_size: number;
  adults: number;
  children: number;
  status: ReservationStatus;
  seat_type: string | null;
  purpose: string | null;
  allergy_note: string | null;
  request_note: string | null;
  memo: string | null;
  created_via: string;
  created_at: string;
  is_private_hire: boolean;
  staff_id: string | null;
  profiles: { display_name: string } | null;
  course: { name: string } | null;
  reservation_sources: { name: string } | null;
  reservation_tables: { table_id: string; restaurant_tables: { name: string } | null }[];
}

const RESERVATION_SELECT = `id, code, store_id, reserved_date, start_at, end_at, guest_name, guest_name_kana, guest_phone, guest_email,
   party_size, adults, children, status, seat_type, purpose, allergy_note, request_note, memo, created_via, created_at, is_private_hire,
   staff_id, profiles(display_name), course:menu_items(name), reservation_sources(name),
   reservation_tables(table_id, restaurant_tables(name))`;

function mapReservationRow(r: RawReservation, storeName: string | null): ReservationCardData {
  return {
    id: r.id,
    code: r.code,
    storeId: r.store_id,
    reservedDate: r.reserved_date,
    startAt: r.start_at,
    endAt: r.end_at,
    guestName: r.guest_name,
    guestNameKana: r.guest_name_kana,
    guestPhone: r.guest_phone,
    guestEmail: r.guest_email,
    partySize: r.party_size,
    adults: r.adults,
    children: r.children,
    status: r.status,
    courseName: r.course?.name ?? null,
    seatType: r.seat_type,
    purpose: r.purpose,
    allergyNote: r.allergy_note,
    requestNote: r.request_note,
    memo: r.memo,
    sourceName: r.reservation_sources?.name ?? null,
    createdVia: r.created_via,
    storeName,
    tableIds: (r.reservation_tables ?? []).map((t) => t.table_id),
    tableNames: (r.reservation_tables ?? []).map((t) => t.restaurant_tables?.name).filter((n): n is string => !!n),
    staffId: r.staff_id,
    staffName: r.profiles?.display_name ?? null,
    isPrivateHire: r.is_private_hire,
    createdAt: r.created_at,
  };
}

interface SearchParams {
  date?: string;
  view?: string;
  wstatus?: string;
}

export default async function ReservationsLedgerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireFeature('reservations');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <PageHeader title="店舗台帳" en="Reservation" />
        <EmptyState title="アクセス可能な店舗がありません" description="管理者に店舗への招待を依頼してください。" />
      </div>
    );
  }

  const sp = await searchParams;
  const view = sp.view === 'week' || sp.view === 'waitlist' ? sp.view : 'day';
  const canManagePrivateHire = can(ctx.role, 'store.settings');

  // 集計タイル・操作ボタン用の共通データ（today もここで算出）
  const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : undefined;
  const chrome = await loadLedgerChrome(ctx, store, view === 'waitlist' ? undefined : requestedDate);
  const today = chrome.today;
  const date = requestedDate ?? today;

  const supabase = await createClient();

  const [{ data: tablesData }, { data: businessHoursData }, { data: staffData }, { data: bookingSettings }] = await Promise.all([
    supabase
      .from('restaurant_tables')
      .select('id, name, capacity_min, capacity_max, current_status')
      .eq('store_id', store.id)
      .eq('status', 'active')
      .order('sort_order'),
    supabase.from('business_hours').select('day_of_week, is_closed, open_time, close_time').eq('store_id', store.id),
    supabase
      .from('memberships')
      .select('profile_id, profiles(display_name), membership_stores!inner(store_id)')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .eq('membership_stores.store_id', store.id),
    supabase.from('store_settings').select('cleaning_buffer_minutes').eq('store_id', store.id).maybeSingle(),
  ]);
  const bufferMinutes = bookingSettings?.cleaning_buffer_minutes ?? 0;

  const totalCapacity = (tablesData ?? []).reduce((sum, t) => sum + t.capacity_max, 0);
  const businessHoursMap = new Map<number, BusinessHourRow>((businessHoursData ?? []).map((b) => [b.day_of_week, b]));
  const staffOptions = (staffData ?? [])
    .map((m) => ({ id: m.profile_id as string, name: (m.profiles as unknown as { display_name: string } | null)?.display_name ?? '不明' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  let body: React.ReactNode;
  let active: LedgerTabKey = 'schedule';
  let nav: React.ReactNode = <DateNav date={date} basePath="/app/reservations" today={today} />;

  if (view === 'day') {
    const dow = dowOfDateStr(date);
    const bh = businessHoursMap.get(dow);
    let openMin = DEFAULT_START_MIN;
    let closeMin = DEFAULT_END_MIN;
    if (bh && !bh.is_closed) {
      const o = parseTimeToMinutes(bh.open_time);
      const c = parseTimeToMinutes(bh.close_time);
      if (o != null && c != null) {
        openMin = o;
        closeMin = c > o ? c : c + 24 * 60;
      }
    }
    // 営業時間の前後1時間まで表示し、営業時間外は斜線で示す
    const viewStartMin = Math.max(0, Math.floor((openMin - 60) / 60) * 60);
    const viewEndMin = Math.min(30 * 60, Math.ceil((closeMin + 60) / 60) * 60);
    const isClosedDay = !!bh?.is_closed;
    if (isClosedDay) {
      openMin = viewEndMin;
      closeMin = viewEndMin;
    }

    const { data: reservationsData } = await supabase
      .from('reservations')
      .select(RESERVATION_SELECT)
      .eq('store_id', store.id)
      .eq('reserved_date', date)
      .in('status', ACTIVE_TIMELINE_STATUSES)
      .order('start_at');

    const raw = (reservationsData ?? []) as unknown as RawReservation[];
    const reservations = raw.map((r) => mapReservationRow(r, null));
    const isToday = date === today;

    const boardTables: BoardTable[] = (tablesData ?? []).map((t) => {
      let statusLabel = '';
      if (isToday) {
        const onTable = reservations.filter((r) => r.tableIds.includes(t.id));
        const seated = onTable.find((r) => r.status === 'seated' || r.status === 'arrived');
        const billing = onTable.find((r) => r.status === 'billing');
        if (billing) statusLabel = '会計待ち';
        else if (seated) statusLabel = `着席中 ${seated.partySize}名 ・ ${seated.guestName} 様`;
        else statusLabel = TABLE_STATUS_LABEL[t.current_status] ?? '';
      }
      return { id: t.id, name: t.name, capacityMin: t.capacity_min, capacityMax: t.capacity_max, statusLabel };
    });

    let dayIsFull = false;
    if (totalCapacity > 0 && !isClosedDay) {
      for (let slotStart = openMin; slotStart < closeMin && !dayIsFull; slotStart += BOARD_SLOT) {
        const slotEnd = slotStart + BOARD_SLOT;
        let guests = 0;
        for (const r of reservations) {
          const rs = jstMinutes(r.startAt);
          const re = jstMinutes(r.endAt);
          if (rs < slotEnd && re > slotStart) {
            if (r.isPrivateHire) {
              guests = totalCapacity;
              break;
            }
            guests += r.partySize;
          }
        }
        if (guests >= totalCapacity) dayIsFull = true;
      }
    }

    body = (
      <>
        {dayIsFull && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 print:hidden">
            <p className="flex items-center gap-2 text-sm font-bold text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              この日は満席の時間帯があります。キャンセル待ちを承れます。
            </p>
            <WaitlistDialog stores={ctx.stores} defaultStoreId={store.id} defaultDate={date} />
          </div>
        )}
        <ScheduleBoard
          reservations={reservations}
          tables={boardTables}
          viewStartMin={viewStartMin}
          viewEndMin={viewEndMin}
          openMin={openMin}
          closeMin={closeMin}
          isClosedDay={isClosedDay}
          bufferMinutes={bufferMinutes}
          staffOptions={staffOptions}
          canManagePrivateHire={canManagePrivateHire}
          isToday={isToday}
          nowMs={chrome.nowMs}
          updatedAt={chrome.updatedAt}
        />
      </>
    );
  } else if (view === 'week') {
    active = 'week';
    nav = <DateNav date={date} basePath="/app/reservations" today={today} query="view=week" step={7} />;
    const weekStart = shiftDateStr(date, -dowOfDateStr(date));
    const weekDates = Array.from({ length: 7 }, (_, i) => shiftDateStr(weekStart, i));

    const range = unionHourRange([...businessHoursMap.values()]);
    const bandStart = Math.floor(range.startMin / 60) * 60;
    const bandEnd = Math.max(bandStart + 60, Math.ceil(range.endMin / 60) * 60);
    const bandCount = (bandEnd - bandStart) / 60;
    const bandLabels = Array.from({ length: bandCount }, (_, i) => `${String(Math.floor((bandStart + i * 60) / 60) % 24).padStart(2, '0')}:00`);

    const { data: weekData } = await supabase
      .from('reservations')
      .select('reserved_date, start_at, party_size, is_private_hire')
      .eq('store_id', store.id)
      .in('reserved_date', weekDates)
      .in('status', ACTIVE_TIMELINE_STATUSES);

    const rows = weekData ?? [];
    const dayAgg = new Map<string, { count: number; guests: number; hasPrivate: boolean }>();
    for (const d of weekDates) dayAgg.set(d, { count: 0, guests: 0, hasPrivate: false });
    const cellAgg = new Map<string, { count: number; guests: number }>();
    let maxCell = 0;
    for (const r of rows) {
      const agg = dayAgg.get(r.reserved_date);
      if (agg) {
        agg.count += 1;
        agg.guests += r.party_size;
        if (r.is_private_hire) agg.hasPrivate = true;
      }
      const startM = jstMinutes(r.start_at);
      const bandIdx = Math.floor((startM - bandStart) / 60);
      if (bandIdx >= 0 && bandIdx < bandCount) {
        const key = `${r.reserved_date}|${bandIdx}`;
        const cur = cellAgg.get(key) ?? { count: 0, guests: 0 };
        cur.count += 1;
        cur.guests += r.party_size;
        cellAgg.set(key, cur);
        maxCell = Math.max(maxCell, cur.guests);
      }
    }
    const weekCount = rows.length;
    const weekGuests = rows.reduce((s, r) => s + r.party_size, 0);

    body = (
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex flex-wrap items-baseline">
            週間
            <span className="en-inline">Week</span>
            <small className="ml-3 text-[13px] font-medium text-ink-2 tabular-nums">
              {weekDates[0].slice(5).replace('-', '/')} 〜 {weekDates[6].slice(5).replace('-', '/')}
            </small>
          </CardTitle>
          <span className="text-xs text-ink-3 tabular-nums">
            {weekCount}組 {weekGuests}名 ・ 日付をタップ＝その日のスケジュール
          </span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[5rem] border-r border-b border-line bg-lilac-soft px-3 py-2 text-left text-xs font-bold text-ink-2">
                  時間帯
                  <span className="en-sub">Time</span>
                </th>
                {weekDates.map((d, i) => {
                  const agg = dayAgg.get(d)!;
                  const occupancy = totalCapacity > 0 ? Math.min(100, Math.round((agg.guests / totalCapacity) * 100)) : null;
                  const day = Number(d.slice(8, 10));
                  const isTodayCol = d === today;
                  const isSelected = d === date;
                  return (
                    <th key={d} className="border-b border-l border-line bg-lilac-soft p-0 text-center font-medium">
                      <Link
                        href={`/app/reservations?date=${d}`}
                        className={cn(
                          'block px-2 py-2 transition-colors hover:bg-iris-soft',
                          isSelected && 'bg-iris-soft',
                          isTodayCol && 'shadow-[inset_0_-3px_0_var(--color-iris)]'
                        )}
                      >
                        <div className={cn('text-sm font-bold', i === 0 ? 'text-danger' : i === 6 ? 'text-iris' : 'text-ink')}>
                          <span className="tabular-nums">{day}</span>日（{WEEKDAYS[i]}）
                          {isTodayCol && (
                            <span className="ml-1 rounded-full bg-iris-soft px-1.5 py-px text-[10px] font-bold text-royal">今日</span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-ink-2 tabular-nums">
                          {agg.count}組 / {agg.guests}名
                        </div>
                        <div className="text-[11px] font-bold text-royal tabular-nums">
                          {occupancy != null ? `満席率 ${occupancy}%` : '—'}
                        </div>
                        {agg.hasPrivate && (
                          <Badge tone="primary" className="mt-1">
                            貸切あり
                          </Badge>
                        )}
                      </Link>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {bandLabels.map((label, bandIdx) => (
                <tr key={label}>
                  <th className="sticky left-0 z-10 border-r border-b border-line bg-white px-3 py-2 text-left font-[family-name:var(--font-num)] font-bold whitespace-nowrap text-ink-2 tabular-nums">
                    {label}
                  </th>
                  {weekDates.map((d) => {
                    const cell = cellAgg.get(`${d}|${bandIdx}`);
                    const heat = cell && maxCell > 0 ? cell.guests / maxCell : 0;
                    return (
                      <td key={d} className="border-b border-l border-line p-0 text-center">
                        <Link
                          href={`/app/reservations?date=${d}`}
                          className="block px-2 py-2 transition-colors hover:bg-lilac-soft"
                          style={cell ? { backgroundColor: `rgba(123, 63, 228, ${(0.06 + heat * 0.22).toFixed(2)})` } : undefined}
                        >
                          {cell ? (
                            <span className="font-bold text-royal tabular-nums">
                              {cell.count}組 <span className="font-medium text-ink-2">{cell.guests}名</span>
                            </span>
                          ) : (
                            <span className="text-wisteria">—</span>
                          )}
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    );
  } else {
    active = 'waiting';
    nav = null;
    const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);
    const showStore = !ctx.currentStore && ctx.stores.length > 1;

    // ---- 本日の店頭ウェイティング（ticket_no採番済み）----
    const [{ data: queueData }, { data: availableTablesData }] = await Promise.all([
      supabase
        .from('waitlist_entries')
        .select('id, store_id, guest_name, guest_phone, party_size, seat_preference, ticket_no, status, created_at, stores(name)')
        .in('store_id', storeIds)
        .eq('desired_date', today)
        .not('ticket_no', 'is', null)
        .order('ticket_no', { ascending: true }),
      supabase
        .from('restaurant_tables')
        .select('id, store_id, name, capacity_min, capacity_max')
        .in('store_id', storeIds)
        .eq('status', 'active')
        .eq('current_status', 'available')
        .order('sort_order'),
    ]);

    const queueEntries: WaitingTicketRow[] = (queueData ?? []).map((w) => ({
      id: w.id,
      storeId: w.store_id,
      storeName: (w.stores as unknown as { name: string } | null)?.name ?? null,
      ticketNo: w.ticket_no as number,
      guestName: w.guest_name,
      guestPhone: w.guest_phone,
      partySize: w.party_size,
      seatPreference: w.seat_preference,
      status: w.status as WaitingTicketRow['status'],
      createdAt: w.created_at,
    }));

    const tablesByStore: Record<string, GuideTableOption[]> = {};
    for (const t of availableTablesData ?? []) {
      (tablesByStore[t.store_id] ??= []).push({ id: t.id, name: t.name, capacityMax: t.capacity_max });
    }

    // 空席発生時の案内候補ヒント（現在availableなテーブルにsuggestTablesを適用）
    const hints: WaitingHint[] = [];
    const usedTableIds = new Set<string>();
    for (const w of queueEntries) {
      if (w.status !== 'waiting') continue;
      const storeTables = (availableTablesData ?? []).filter((t) => t.store_id === w.storeId && !usedTableIds.has(t.id));
      const tableLikes: TableLike[] = storeTables.map((t) => ({
        id: t.id,
        name: t.name,
        capacityMin: t.capacity_min,
        capacityMax: t.capacity_max,
        isActive: true,
        isOccupied: false,
      }));
      const suggestion = suggestTables(tableLikes, w.partySize)[0];
      if (suggestion) {
        hints.push({ ticketNo: w.ticketNo, guestName: w.guestName, partySize: w.partySize, label: suggestion.label });
        for (const id of suggestion.tableIds) usedTableIds.add(id);
      }
    }

    // ---- キャンセル待ち（満席時登録・ticket_noなし）----
    const wstatusOptions: { key: WaitlistStatus | ''; label: string }[] = [
      { key: 'waiting', label: '連絡待ち' },
      { key: 'contacted', label: '連絡済み' },
      { key: '', label: 'すべて' },
      { key: 'converted', label: '予約済み' },
      { key: 'expired', label: '期限切れ' },
      { key: 'cancelled', label: '取消' },
    ];
    const wstatus = (sp.wstatus ?? 'waiting') as WaitlistStatus | '';

    let waitlistQuery = supabase
      .from('waitlist_entries')
      .select('id, store_id, guest_name, guest_phone, party_size, desired_date, desired_time_from, desired_time_to, note, status, stores(name)')
      .in('store_id', storeIds)
      .is('ticket_no', null)
      .order('desired_date', { ascending: true });
    if (wstatus) waitlistQuery = waitlistQuery.eq('status', wstatus);

    const { data: waitlistData } = await waitlistQuery;
    const entries: WaitlistRow[] = (waitlistData ?? []).map((w) => ({
      id: w.id,
      storeId: w.store_id,
      storeName: (w.stores as unknown as { name: string } | null)?.name ?? null,
      guestName: w.guest_name,
      guestPhone: w.guest_phone,
      partySize: w.party_size,
      desiredDate: w.desired_date,
      desiredTimeFrom: w.desired_time_from,
      desiredTimeTo: w.desired_time_to,
      note: w.note,
      status: w.status as WaitlistStatus,
    }));
    const waitingNow = queueEntries.filter((w) => w.status === 'waiting' || w.status === 'called').length;

    body = (
      <div className="space-y-4">
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex flex-wrap items-baseline">
              本日のウェイティング
              <span className="en-inline">Waiting</span>
              <small className="ml-3 text-[13px] font-medium text-ink-2 tabular-nums">待ち {waitingNow}組</small>
            </CardTitle>
            <WaitingTicketDialog stores={ctx.stores} defaultStoreId={store.id} />
          </CardHeader>
          <div className="p-4">
            <WaitingQueuePanel entries={queueEntries} tablesByStore={tablesByStore} hints={hints} showStore={showStore} embedded />
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>
              キャンセル待ち（満席時の登録）
              <span className="en-inline">Waitlist</span>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1.5">
                {wstatusOptions.map((o) => (
                  <Link
                    key={o.key || 'all'}
                    href={`/app/reservations?view=waitlist${o.key ? `&wstatus=${o.key}` : '&wstatus='}`}
                    aria-current={wstatus === o.key ? 'page' : undefined}
                    className={cn(
                      'rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
                      wstatus === o.key ? 'border-royal bg-royal text-white' : 'border-line bg-white text-ink-2 hover:bg-lilac-soft'
                    )}
                  >
                    {o.label}
                  </Link>
                ))}
              </div>
              <WaitlistDialog stores={ctx.stores} defaultStoreId={store.id} />
            </div>
          </CardHeader>
          <WaitlistPanel entries={entries} showStore={showStore} allStores={ctx.stores} embedded />
        </Card>
      </div>
    );
  }

  const isSummaryToday = chrome.summaryDate === today;

  return (
    <div>
      {/* 予約・ウェイティングの追加・変更・キャンセルをRealtimeで検知し、台帳（日/週/ウェイティング）を自動更新する */}
      <StoreRealtimeRefresh storeId={store.id} tables={['reservations', 'waitlist_entries']} />
      <h1 className="sr-only">店舗台帳（{store.name}）</h1>
      <LedgerTop active={active} date={date} chrome={chrome} nav={nav} />
      <div className="print-area">
        <p className="mb-3 hidden text-base font-bold text-ink print:block">
          店舗台帳 ／ {store.name} ／ {chrome.summaryDate.replaceAll('-', '/')}
        </p>
        <LedgerSummaryTiles chrome={chrome} isToday={isSummaryToday} />
        {body}
      </div>
    </div>
  );
}

function unionHourRange(rows: BusinessHourRow[]): { startMin: number; endMin: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    if (r.is_closed) continue;
    const o = parseTimeToMinutes(r.open_time);
    const c = parseTimeToMinutes(r.close_time);
    if (o == null || c == null) continue;
    const cc = c > o ? c : c + 24 * 60;
    min = Math.min(min, o);
    max = Math.max(max, cc);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { startMin: DEFAULT_START_MIN, endMin: DEFAULT_END_MIN };
  return { startMin: min, endMin: max };
}
