import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { todayJst } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DateNav } from '@/components/reservations/date-nav';
import { ReservationCard, type ReservationCardData } from '@/components/reservations/reservation-card';
import type { AssignableTable } from '@/components/reservations/assign-table-dialog';
import { WaitlistDialog } from '@/components/reservations/waitlist-dialog';
import { WaitlistPanel, type WaitlistRow, type WaitlistStatus } from '@/components/reservations/waitlist-panel';
import { ACTIVE_TIMELINE_STATUSES, ASSIGNABLE_STATUSES, statusBlockClass } from '@/components/reservations/constants';
import type { ReservationStatus } from '@/lib/reservations';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: '予約台帳' };

const SLOT = 30;
const DEFAULT_START_MIN = 11 * 60;
const DEFAULT_END_MIN = 23 * 60;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

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
  is_private_hire: boolean;
  staff_id: string | null;
  profiles: { display_name: string } | null;
  course: { name: string } | null;
  reservation_sources: { name: string } | null;
  reservation_tables: { table_id: string; restaurant_tables: { name: string } | null }[];
}

const RESERVATION_SELECT = `id, code, store_id, reserved_date, start_at, end_at, guest_name, guest_name_kana, guest_phone, guest_email,
   party_size, adults, children, status, seat_type, purpose, allergy_note, request_note, memo, created_via, is_private_hire,
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
  };
}

type GridCell = { kind: 'empty' } | { kind: 'skip' } | { kind: 'block'; span: number; reservation: ReservationCardData };

function buildRow(reservations: ReservationCardData[], startMin: number, slotCount: number): GridCell[] {
  const cells: GridCell[] = Array.from({ length: slotCount }, () => ({ kind: 'empty' }));
  for (const r of [...reservations].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    const startIdx = Math.max(0, Math.min(slotCount - 1, Math.floor((jstMinutes(r.startAt) - startMin) / SLOT)));
    const endIdx = Math.max(startIdx + 1, Math.min(slotCount, Math.ceil((jstMinutes(r.endAt) - startMin) / SLOT)));
    if (cells[startIdx]?.kind !== 'empty') continue; // 重複割当は先勝ち
    let span = 0;
    for (let i = startIdx; i < endIdx; i++) {
      if (cells[i]?.kind !== 'empty') break;
      span++;
    }
    cells[startIdx] = { kind: 'block', span, reservation: r };
    for (let i = startIdx + 1; i < startIdx + span; i++) cells[i] = { kind: 'skip' };
  }
  return cells;
}

interface SearchParams {
  date?: string;
  view?: string;
  wstatus?: string;
}

export default async function ReservationsLedgerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireMember();
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <PageHeader title="予約台帳" />
        <EmptyState title="アクセス可能な店舗がありません" description="管理者に店舗への招待を依頼してください。" />
      </div>
    );
  }

  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : todayJst();
  const view = sp.view === 'week' || sp.view === 'waitlist' ? sp.view : 'day';
  const canManagePrivateHire = can(ctx.role, 'store.settings');

  const supabase = await createClient();

  const [{ data: tablesData }, { data: businessHoursData }, { data: staffData }] = await Promise.all([
    supabase
      .from('restaurant_tables')
      .select('id, name, capacity_min, capacity_max')
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
  ]);

  const tables: AssignableTable[] = (tablesData ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    capacityMin: t.capacity_min,
    capacityMax: t.capacity_max,
  }));
  const totalCapacity = tables.reduce((sum, t) => sum + t.capacityMax, 0);
  const businessHoursMap = new Map<number, BusinessHourRow>((businessHoursData ?? []).map((b) => [b.day_of_week, b]));
  const staffOptions = (staffData ?? [])
    .map((m) => ({ id: m.profile_id as string, name: (m.profiles as unknown as { display_name: string } | null)?.display_name ?? '不明' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  const tabs: { key: string; label: string; href: string }[] = [
    { key: 'day', label: '日', href: `/app/reservations?date=${date}` },
    { key: 'week', label: '週', href: `/app/reservations?view=week&date=${date}` },
    { key: 'month', label: '月', href: '/app/reservations/calendar' },
    { key: 'list', label: 'リスト', href: '/app/reservations/list' },
    { key: 'floor', label: 'フロア', href: '/app/floor' },
    { key: 'waitlist', label: 'キャンセル待ち', href: '/app/reservations?view=waitlist' },
  ];

  let body: React.ReactNode;
  let description = `${store.name}｜${date.replaceAll('-', '/')}のタイムライン`;

  if (view === 'day') {
    const dow = dowOfDateStr(date);
    const bh = businessHoursMap.get(dow);
    let startMin = DEFAULT_START_MIN;
    let endMin = DEFAULT_END_MIN;
    if (bh && !bh.is_closed) {
      const o = parseTimeToMinutes(bh.open_time);
      const c = parseTimeToMinutes(bh.close_time);
      if (o != null && c != null) {
        startMin = o;
        endMin = c > o ? c : c + 24 * 60;
      }
    }
    const slotCount = Math.max(1, Math.ceil((endMin - startMin) / SLOT));
    const timeLabels = Array.from({ length: slotCount }, (_, i) => {
      const min = startMin + i * SLOT;
      return `${String(Math.floor((min / 60) % 24)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    });

    const { data: reservationsData } = await supabase
      .from('reservations')
      .select(RESERVATION_SELECT)
      .eq('store_id', store.id)
      .eq('reserved_date', date)
      .in('status', ACTIVE_TIMELINE_STATUSES)
      .order('start_at');

    const raw = (reservationsData ?? []) as unknown as RawReservation[];
    const reservations = raw.map((r) => mapReservationRow(r, null));
    const unassigned = reservations.filter((r) => r.tableIds.length === 0 && ASSIGNABLE_STATUSES.includes(r.status));

    let dayIsFull = false;
    if (totalCapacity > 0) {
      for (let i = 0; i < slotCount && !dayIsFull; i++) {
        const slotStart = startMin + i * SLOT;
        const slotEnd = slotStart + SLOT;
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

    if (bh?.is_closed) description += '（定休日設定あり）';

    body = (
      <>
        {dayIsFull && (
          <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-warning/40 bg-warning-soft p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              この日は満席の時間帯があります。キャンセル待ちを承れます。
            </p>
            <WaitlistDialog stores={ctx.stores} defaultStoreId={store.id} defaultDate={date} />
          </Card>
        )}

        {unassigned.length > 0 && (
          <Card className="mb-4 p-4">
            <p className="mb-3 text-sm font-semibold text-navy">未割当の予約（{unassigned.length}件）</p>
            <div className="flex flex-wrap gap-3">
              {unassigned.map((r) => (
                <ReservationCard
                  key={r.id}
                  reservation={r}
                  tables={tables}
                  staffOptions={staffOptions}
                  canManagePrivateHire={canManagePrivateHire}
                  variant="list"
                />
              ))}
            </div>
          </Card>
        )}

        {tables.length === 0 ? (
          <EmptyState title="テーブルが登録されていません" description="設定 &gt; テーブル管理からテーブルを登録してください。" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-[8rem] border-b border-gray-200 bg-gray-50 px-3 py-2 text-left font-medium text-gray-600">
                    テーブル
                  </th>
                  {timeLabels.map((label, i) => (
                    <th
                      key={label}
                      className={cn(
                        'min-w-[3.25rem] border-b border-l border-gray-100 bg-gray-50 px-1 py-2 text-center font-medium whitespace-nowrap text-gray-500',
                        i % 2 === 0 && 'bg-gray-100'
                      )}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tables.map((table) => {
                  const rowReservations = reservations.filter((r) => r.tableIds.includes(table.id));
                  const cells = buildRow(rowReservations, startMin, slotCount);
                  return (
                    <tr key={table.id}>
                      <th className="sticky left-0 z-10 border-b border-gray-100 bg-white px-3 py-2 text-left align-top font-medium text-navy whitespace-nowrap">
                        {table.name}
                        <span className="ml-1 text-[10px] font-normal text-gray-400">
                          {table.capacityMin}-{table.capacityMax}名
                        </span>
                      </th>
                      {cells.map((cell, i) => {
                        if (cell.kind === 'skip') return null;
                        if (cell.kind === 'block') {
                          return (
                            <td key={i} colSpan={cell.span} className="border-b border-l border-gray-100 p-1 align-top">
                              <ReservationCard
                                reservation={cell.reservation}
                                tables={tables}
                                staffOptions={staffOptions}
                                canManagePrivateHire={canManagePrivateHire}
                                variant="grid"
                              />
                            </td>
                          );
                        }
                        return <td key={i} className="border-b border-l border-gray-100 p-1" />;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-400">
          凡例:
          {(['confirmed', 'seated', 'billing', 'completed', 'cancelled'] as ReservationStatus[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className={cn('inline-block h-2.5 w-2.5 rounded-sm', statusBlockClass(s))} />
              {s === 'confirmed' ? '予約確定' : s === 'seated' ? '着席中' : s === 'billing' ? '会計待ち' : s === 'completed' ? '会計済み' : 'キャンセル'}
            </span>
          ))}
        </p>
      </>
    );
  } else if (view === 'week') {
    const weekStart = shiftDateStr(date, -dowOfDateStr(date));
    const weekDates = Array.from({ length: 7 }, (_, i) => shiftDateStr(weekStart, i));
    description = `${store.name}｜${weekDates[0].replaceAll('-', '/')} 〜 ${weekDates[6].replaceAll('-', '/')}の週間概況`;

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
      }
    }

    body = (
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[54rem] border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[4rem] border-b border-gray-200 bg-gray-50 px-2 py-2 text-left font-medium text-gray-500">
                時間帯
              </th>
              {weekDates.map((d, i) => {
                const agg = dayAgg.get(d)!;
                const occupancy = totalCapacity > 0 ? Math.min(100, Math.round((agg.guests / totalCapacity) * 100)) : null;
                const day = Number(d.slice(8, 10));
                return (
                  <th key={d} className="border-b border-l border-gray-100 bg-gray-50 p-0 text-center font-medium">
                    <Link href={`/app/reservations?date=${d}`} className="block px-2 py-2 hover:bg-primary-soft/40">
                      <div className={cn('text-sm font-semibold', i === 0 ? 'text-danger' : i === 6 ? 'text-primary' : 'text-navy')}>
                        {day}日（{WEEKDAYS[i]}）
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-500">
                        {agg.count}件 / {agg.guests}名
                      </div>
                      <div className="text-[11px] font-medium text-primary-deep">{occupancy != null ? `満席率 ${occupancy}%` : '—'}</div>
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
                <th className="sticky left-0 z-10 border-b border-gray-100 bg-white px-2 py-2 text-left font-medium whitespace-nowrap text-gray-500">
                  {label}
                </th>
                {weekDates.map((d) => {
                  const cell = cellAgg.get(`${d}|${bandIdx}`);
                  return (
                    <td key={d} className="border-b border-l border-gray-100 p-0 text-center">
                      <Link href={`/app/reservations?date=${d}`} className="block px-2 py-2 hover:bg-primary-soft/40">
                        {cell ? (
                          <span className="font-medium text-navy">
                            {cell.count}件 <span className="text-gray-400">{cell.guests}名</span>
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
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
    );
  } else {
    const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);
    const showStore = !ctx.currentStore && ctx.stores.length > 1;
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

    description = `${store.name}｜キャンセル待ち`;

    body = (
      <>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1">
            {wstatusOptions.map((o) => (
              <Link
                key={o.key || 'all'}
                href={`/app/reservations?view=waitlist${o.key ? `&wstatus=${o.key}` : ''}`}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-center text-xs font-medium transition-colors',
                  wstatus === o.key ? 'bg-navy text-white' : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                {o.label}
              </Link>
            ))}
          </div>
          <WaitlistDialog stores={ctx.stores} defaultStoreId={store.id} />
        </div>
        <WaitlistPanel entries={entries} showStore={showStore} allStores={ctx.stores} />
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title="予約台帳"
        description={description}
        actions={view === 'day' ? <DateNav date={date} basePath="/app/reservations" /> : undefined}
      />

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-gray-200">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={cn(
              'shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              view === t.key ? 'border-primary text-primary-deep' : 'border-transparent text-gray-500 hover:text-navy'
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {body}
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
