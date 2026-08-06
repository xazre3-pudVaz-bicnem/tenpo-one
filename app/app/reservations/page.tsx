import type { Metadata } from 'next';
import Link from 'next/link';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { DateNav } from '@/components/reservations/date-nav';
import { ReservationCard, type ReservationCardData } from '@/components/reservations/reservation-card';
import { ACTIVE_TIMELINE_STATUSES, type ReservationStatus } from '@/components/reservations/status';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: '予約台帳' };

const START_MIN = 11 * 60;
const END_MIN = 23 * 60;
const SLOT = 30;
const SLOT_COUNT = (END_MIN - START_MIN) / SLOT;

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

const TIME_LABELS = Array.from({ length: SLOT_COUNT }, (_, i) => {
  const min = START_MIN + i * SLOT;
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
});

interface RawReservation {
  id: string;
  guest_name: string;
  party_size: number;
  start_at: string;
  end_at: string;
  status: ReservationStatus;
  memo: string | null;
  reservation_tables: { table_id: string }[];
}

type GridCell = { kind: 'empty' } | { kind: 'skip' } | { kind: 'block'; span: number; reservation: ReservationCardData };

function buildRow(reservations: ReservationCardData[]): GridCell[] {
  const cells: GridCell[] = Array.from({ length: SLOT_COUNT }, () => ({ kind: 'empty' }));
  for (const r of [...reservations].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    const startIdx = Math.max(0, Math.min(SLOT_COUNT - 1, Math.floor((jstMinutes(r.startAt) - START_MIN) / SLOT)));
    const endIdx = Math.max(startIdx + 1, Math.min(SLOT_COUNT, Math.ceil((jstMinutes(r.endAt) - START_MIN) / SLOT)));
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

export default async function ReservationsLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
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

  const { date: rawDate } = await searchParams;
  const date = rawDate ?? todayJst();

  const supabase = await createClient();

  const { data: tablesData } = await supabase
    .from('restaurant_tables')
    .select('id, name, capacity_min, capacity_max, floor_id')
    .eq('store_id', store.id)
    .eq('status', 'active')
    .order('sort_order');
  const tables = tablesData ?? [];

  const { data: reservationsData } = await supabase
    .from('reservations')
    .select('id, guest_name, party_size, start_at, end_at, status, memo, reservation_tables(table_id)')
    .eq('store_id', store.id)
    .eq('reserved_date', date)
    .in('status', ACTIVE_TIMELINE_STATUSES)
    .order('start_at');

  const raw = (reservationsData ?? []) as unknown as RawReservation[];
  const reservations: (ReservationCardData & { tableIds: string[] })[] = raw.map((r) => ({
    id: r.id,
    guestName: r.guest_name,
    partySize: r.party_size,
    startAt: r.start_at,
    endAt: r.end_at,
    status: r.status,
    memo: r.memo,
    assignedTableId: r.reservation_tables?.[0]?.table_id ?? null,
    tableIds: (r.reservation_tables ?? []).map((t) => t.table_id),
  }));

  const unassigned = reservations.filter((r) => r.tableIds.length === 0);
  const tableOptions = tables.map((t) => ({ id: t.id, name: t.name }));

  return (
    <div>
      <PageHeader
        title="予約台帳"
        description={`${store.name}｜${date.replaceAll('-', '/')}のタイムライン`}
        actions={
          <>
            <DateNav date={date} basePath="/app/reservations" />
            <Link href={`/app/reservations/list?from=${date}&to=${date}`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              リスト表示
            </Link>
          </>
        }
      />

      {unassigned.length > 0 && (
        <Card className="mb-4 p-4">
          <p className="mb-3 text-sm font-semibold text-navy">未割当の予約（{unassigned.length}件）</p>
          <div className="flex flex-wrap gap-3">
            {unassigned.map((r) => (
              <ReservationCard key={r.id} reservation={r} tables={tableOptions} variant="list" />
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
                {TIME_LABELS.map((label, i) => (
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
                const cells = buildRow(rowReservations);
                return (
                  <tr key={table.id}>
                    <th className="sticky left-0 z-10 border-b border-gray-100 bg-white px-3 py-2 text-left align-top font-medium text-navy whitespace-nowrap">
                      {table.name}
                      <span className="ml-1 text-[10px] font-normal text-gray-400">
                        {table.capacity_min}-{table.capacity_max}名
                      </span>
                    </th>
                    {cells.map((cell, i) => {
                      if (cell.kind === 'skip') return null;
                      if (cell.kind === 'block') {
                        return (
                          <td
                            key={i}
                            colSpan={cell.span}
                            className="border-b border-l border-gray-100 p-1 align-top"
                          >
                            <ReservationCard reservation={cell.reservation} tables={tableOptions} variant="grid" />
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

      <p className="mt-3 text-xs text-gray-400">
        凡例: <span className="text-primary">■</span> 予約確定　<span className="text-success">■</span> 着席中
        <span className="text-gray-400">■</span> 会計済み
      </p>
    </div>
  );
}
