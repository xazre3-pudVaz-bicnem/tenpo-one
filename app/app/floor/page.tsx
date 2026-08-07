import type { Metadata } from 'next';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { todayJst, formatTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { FloorBoard, type ReservationChip } from '@/components/floor/floor-board';
import { startWalkIn, goToOrder, completeCleaning, setTableAvailability } from './actions';

export const metadata: Metadata = { title: 'フロアマップ' };

export default async function FloorPage() {
  const ctx = await requireFeature('pos');
  const supabase = await createClient();
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <PageHeader title="フロアマップ" />
        <EmptyState
          title="アクセス可能な店舗がありません"
          description="管理者に店舗の割り当てを依頼してください"
        />
      </div>
    );
  }

  const [{ data: floors }, { data: tables }] = await Promise.all([
    supabase
      .from('floors')
      .select('id, name, sort_order')
      .eq('store_id', store.id)
      .eq('status', 'active')
      .order('sort_order'),
    supabase
      .from('restaurant_tables')
      .select(
        'id, floor_id, name, capacity_min, capacity_max, is_private_room, is_counter, current_status'
      )
      .eq('store_id', store.id)
      .eq('status', 'active')
      .order('sort_order'),
  ]);

  const today = todayJst();
  const { data: reservations } = await supabase
    .from('reservations')
    .select('id, start_at, guest_name, party_size, reservation_tables(table_id)')
    .eq('store_id', store.id)
    .eq('reserved_date', today)
    .in('status', ['pending', 'confirmed', 'seated'])
    .order('start_at');

  const reservationByTable: Record<string, ReservationChip> = {};
  for (const r of reservations ?? []) {
    const links = (r.reservation_tables ?? []) as unknown as { table_id: string }[];
    for (const link of links) {
      if (!reservationByTable[link.table_id]) {
        reservationByTable[link.table_id] = {
          time: formatTime(r.start_at),
          guestName: r.guest_name,
          partySize: r.party_size,
        };
      }
    }
  }

  const canOperate = can(ctx.role, 'tables.operate');

  return (
    <div>
      <PageHeader title="フロアマップ" description={`${store.name}｜${today.replaceAll('-', '/')}の座席状況`} />
      {(tables ?? []).length === 0 ? (
        <EmptyState
          title="テーブルが登録されていません"
          description="設定画面からフロア・テーブルを登録してください"
        />
      ) : (
        <FloorBoard
          storeId={store.id}
          floors={floors ?? []}
          tables={tables ?? []}
          reservationByTable={reservationByTable}
          canOperate={canOperate}
          startWalkInAction={startWalkIn}
          goToOrderAction={goToOrder}
          completeCleaningAction={completeCleaning}
          setTableAvailabilityAction={setTableAvailability}
        />
      )}
    </div>
  );
}
