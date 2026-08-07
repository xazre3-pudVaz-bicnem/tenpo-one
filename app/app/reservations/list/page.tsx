import type { Metadata } from 'next';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { todayJst } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { ManualReservationDialog } from '@/components/reservations/manual-reservation-dialog';
import { WalkInDialog, type TableOption } from '@/components/reservations/walk-in-dialog';
import { ReservationListTable } from '@/components/reservations/reservation-list-table';
import { RESERVATION_STATUS, type ReservationStatus } from '@/lib/reservations';
import type { ReservationListRow } from '@/components/reservations/list-types';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: '予約リスト' };

const PAGE_SIZE = 50;

function addDaysJst(days: number): string {
  return new Date(Date.now() + days * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

interface RawListRow {
  id: string;
  code: string;
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
  store_id: string;
  is_private_hire: boolean;
  staff_id: string | null;
  profiles: { display_name: string } | null;
  stores: { name: string } | null;
  course: { name: string } | null;
  reservation_sources: { name: string } | null;
  reservation_tables: { table_id: string; restaurant_tables: { name: string } | null }[];
}

interface StaffMembershipRow {
  store_id: string;
  memberships: { profile_id: string; profiles: { display_name: string } | null } | null;
}

interface SearchParams {
  from?: string;
  to?: string;
  status?: string;
  source?: string;
  q?: string;
  sort?: string;
  page?: string;
}

export default async function ReservationListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireMember();
  if (ctx.stores.length === 0) {
    return (
      <div>
        <PageHeader title="予約リスト" />
        <EmptyState title="アクセス可能な店舗がありません" description="管理者に店舗への招待を依頼してください。" />
      </div>
    );
  }

  const sp = await searchParams;
  const from = sp.from || todayJst();
  const to = sp.to || addDaysJst(30);
  const status = sp.status || '';
  const sourceId = sp.source || '';
  const q = (sp.q || '').trim();
  const sort = sp.sort === 'start_at.desc' ? 'start_at.desc' : 'start_at.asc';
  const page = Math.max(1, Number(sp.page) || 1);

  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);
  const showStore = !ctx.currentStore && ctx.stores.length > 1;

  const supabase = await createClient();

  let query = supabase
    .from('reservations')
    .select(
      `id, code, reserved_date, start_at, end_at, guest_name, guest_name_kana, guest_phone, guest_email,
       party_size, adults, children, status, seat_type, purpose, allergy_note, request_note, memo, created_via, store_id,
       is_private_hire, staff_id, profiles(display_name),
       stores(name), course:menu_items(name), reservation_sources(name), reservation_tables(table_id, restaurant_tables(name))`,
      { count: 'exact' }
    )
    .in('store_id', storeIds)
    .gte('reserved_date', from)
    .lte('reserved_date', to);

  if (status) query = query.eq('status', status);
  if (sourceId) query = query.eq('source_id', sourceId);
  if (q) query = query.or(`guest_name.ilike.%${q}%,guest_phone.ilike.%${q}%`);

  const [sortColumn, sortDir] = sort.split('.');
  query = query.order(sortColumn, { ascending: sortDir === 'asc' });
  query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const { data, count } = await query;
  const raw = (data ?? []) as unknown as RawListRow[];

  const reservations: ReservationListRow[] = raw.map((r) => ({
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
    storeName: r.stores?.name ?? null,
    tableIds: (r.reservation_tables ?? []).map((t) => t.table_id),
    tableNames: (r.reservation_tables ?? [])
      .map((t) => t.restaurant_tables?.name)
      .filter((n): n is string => !!n),
    staffId: r.staff_id,
    staffName: r.profiles?.display_name ?? null,
    isPrivateHire: r.is_private_hire,
  }));

  const { data: sources } = await supabase
    .from('reservation_sources')
    .select('id, name')
    .or(`organization_id.is.null,organization_id.eq.${ctx.organizationId}`)
    .eq('status', 'active')
    .order('sort_order');

  const { data: tablesData } = await supabase
    .from('restaurant_tables')
    .select('id, name, capacity_min, capacity_max, store_id')
    .in('store_id', storeIds)
    .eq('status', 'active')
    .order('sort_order');
  const storeTables: Record<string, TableOption[]> = {};
  const storeAssignableTables: Record<string, { id: string; name: string; capacityMin: number; capacityMax: number }[]> = {};
  for (const t of tablesData ?? []) {
    (storeTables[t.store_id] ??= []).push({ id: t.id, name: t.name, capacityMax: t.capacity_max });
    (storeAssignableTables[t.store_id] ??= []).push({ id: t.id, name: t.name, capacityMin: t.capacity_min, capacityMax: t.capacity_max });
  }

  const { data: staffRows } = await supabase
    .from('membership_stores')
    .select('store_id, memberships!inner(profile_id, organization_id, status, profiles(display_name))')
    .in('store_id', storeIds)
    .eq('memberships.organization_id', ctx.organizationId)
    .eq('memberships.status', 'active');
  const staffByStore: Record<string, { id: string; name: string }[]> = {};
  for (const row of (staffRows ?? []) as unknown as StaffMembershipRow[]) {
    if (!row.memberships) continue;
    (staffByStore[row.store_id] ??= []).push({
      id: row.memberships.profile_id,
      name: row.memberships.profiles?.display_name ?? '不明',
    });
  }

  const canManagePrivateHire = can(ctx.role, 'store.settings');

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const baseParams = new URLSearchParams();
  if (sp.from) baseParams.set('from', from);
  if (sp.to) baseParams.set('to', to);
  if (status) baseParams.set('status', status);
  if (sourceId) baseParams.set('source', sourceId);
  if (q) baseParams.set('q', q);
  if (sp.sort) baseParams.set('sort', sort);

  const pageHref = (p: number) => {
    const params = new URLSearchParams(baseParams);
    params.set('page', String(p));
    return `/app/reservations/list?${params.toString()}`;
  };
  const exportHref = `/app/reservations/list/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  return (
    <div>
      <PageHeader
        title="予約リスト"
        description={`${from.replaceAll('-', '/')} 〜 ${to.replaceAll('-', '/')}｜${total}件`}
        actions={
          <>
            <ManualReservationDialog stores={ctx.stores} defaultStoreId={ctx.currentStore?.id ?? null} />
            <WalkInDialog stores={ctx.stores} defaultStoreId={ctx.currentStore?.id ?? null} storeTables={storeTables} />
            <a href={exportHref} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              <Download className="h-4 w-4" />
              CSV出力
            </a>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <form method="get" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <label htmlFor="f-from" className="mb-1 block text-xs font-medium text-gray-600">
              期間（開始）
            </label>
            <input id="f-from" type="date" name="from" defaultValue={from} className="h-9 w-full rounded-lg border border-gray-300 px-2 text-sm" />
          </div>
          <div>
            <label htmlFor="f-to" className="mb-1 block text-xs font-medium text-gray-600">
              期間（終了）
            </label>
            <input id="f-to" type="date" name="to" defaultValue={to} className="h-9 w-full rounded-lg border border-gray-300 px-2 text-sm" />
          </div>
          <div>
            <label htmlFor="f-status" className="mb-1 block text-xs font-medium text-gray-600">
              状態
            </label>
            <select id="f-status" name="status" defaultValue={status} className="h-9 w-full rounded-lg border border-gray-300 px-2 text-sm">
              <option value="">すべて</option>
              {(Object.keys(RESERVATION_STATUS) as ReservationStatus[]).map((s) => (
                <option key={s} value={s}>
                  {RESERVATION_STATUS[s].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-source" className="mb-1 block text-xs font-medium text-gray-600">
              経路
            </label>
            <select id="f-source" name="source" defaultValue={sourceId} className="h-9 w-full rounded-lg border border-gray-300 px-2 text-sm">
              <option value="">すべて</option>
              {(sources ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-sort" className="mb-1 block text-xs font-medium text-gray-600">
              並び替え
            </label>
            <select id="f-sort" name="sort" defaultValue={sort} className="h-9 w-full rounded-lg border border-gray-300 px-2 text-sm">
              <option value="start_at.asc">日時が近い順</option>
              <option value="start_at.desc">日時が新しい順</option>
            </select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor="f-q" className="mb-1 block text-xs font-medium text-gray-600">
              氏名・電話番号
            </label>
            <input id="f-q" type="text" name="q" defaultValue={q} placeholder="キーワード" className="h-9 w-full rounded-lg border border-gray-300 px-2 text-sm" />
          </div>
          <div className="col-span-2 flex items-end gap-2 sm:col-span-3 lg:col-span-6">
            <button type="submit" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
              検索
            </button>
            <Link href="/app/reservations/list" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              条件をクリア
            </Link>
          </div>
        </form>
      </Card>

      <ReservationListTable
        reservations={reservations}
        showStore={showStore}
        storeAssignableTables={storeAssignableTables}
        staffByStore={staffByStore}
        canManagePrivateHire={canManagePrivateHire}
      />

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-1">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={pageHref(p)}
              className={cn(
                'flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-medium',
                p === page ? 'bg-primary text-white' : 'border border-gray-300 text-navy hover:bg-gray-50'
              )}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
