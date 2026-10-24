import type { SupabaseClient } from '@supabase/supabase-js';
import { floorBoardFrom } from '@/lib/floor-nav';
import { handyGroupView, tableGroupsFrom } from '@/lib/table-group';
import type { HandyTableCard } from '@/components/handy/handy-table-list';
import type { HandyServiceCall } from '@/components/handy/logic';

/**
 * ハンディのテーブル一覧（/handy）のデータを組み立てる。
 * Web の app/handy/page.tsx と、iPhone アプリのネイティブのテーブル一覧（/api/app/v1/pos?part=handy）で
 * 同じものを使う（2026-10-24 Ronnie「iPhone のホームもネイティブに」。画面が2つあっても中身の作り方は1つ）。
 */
export interface HandyTablesView {
  tables: HandyTableCard[];
  calls: HandyServiceCall[];
  floors: { id: string; name: string }[];
  defaultFloorId: string | null;
}

export async function loadHandyTables(supabase: SupabaseClient, storeId: string): Promise<HandyTablesView> {
  const [{ data: tables }, { data: orders }, { data: calls }, { data: floorRows }, { data: storeSettings }] =
    await Promise.all([
      supabase
        .from('restaurant_tables')
        .select('id, name, capacity_max, current_status, sort_order, floor_id')
        .eq('store_id', storeId)
        .eq('status', 'active')
        .order('sort_order')
        .order('name'),
      supabase
        .from('orders')
        .select('id, table_id, opened_at, guest_count, total')
        .eq('store_id', storeId)
        .eq('status', 'open')
        .not('table_id', 'is', null)
        .order('opened_at'),
      supabase
        .from('service_calls')
        .select('id, table_id, kind, note, created_at')
        .eq('store_id', storeId)
        .eq('status', 'open')
        .order('created_at'),
      // フロア（ハンディのテーブル一覧のタブ。2026-10-16 SHUNKA 新宿）
      supabase.from('floors').select('id, name, sort_order').eq('store_id', storeId).order('sort_order').order('name'),
      supabase.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle(),
    ]);

  const tableRows = tables ?? [];
  const tableNameById = new Map(tableRows.map((t) => [t.id, t.name]));

  // 卓ごとに未会計注文を集計（相席・伝票分割で複数ある場合は合算し、経過は最初の伝票から数える）
  const byTable = new Map<string, { orderCount: number; openedAtMs: number; guestCount: number; total: number }>();
  for (const o of orders ?? []) {
    if (!o.table_id) continue;
    const openedAtMs = new Date(o.opened_at).getTime();
    const prev = byTable.get(o.table_id);
    byTable.set(o.table_id, {
      orderCount: (prev?.orderCount ?? 0) + 1,
      openedAtMs: prev ? Math.min(prev.openedAtMs, openedAtMs) : openedAtMs,
      guestCount: (prev?.guestCount ?? 0) + (o.guest_count ?? 0),
      total: (prev?.total ?? 0) + Number(o.total ?? 0),
    });
  }

  const serviceCalls: HandyServiceCall[] = (calls ?? []).map((c) => ({
    id: c.id,
    tableId: c.table_id,
    tableName: tableNameById.get(c.table_id) ?? null,
    kind: c.kind === 'checkout' ? 'checkout' : 'staff',
    createdAtMs: new Date(c.created_at).getTime(),
    note: c.note,
  }));

  // テーブルグループ（まとめた卓。2026-10-18 Ronnie「Table merge」）。レジと同じく、まとめた卓のどれかに伝票があれば
  // 伝票の無い卓も同じ伝票の卓として出し、タップでその伝票を開く
  const settings = (storeSettings as { settings?: unknown } | null)?.settings;
  const tableGroups = tableGroupsFrom(settings);
  const openOrderRefs = (orders ?? [])
    .filter((o) => !!o.table_id)
    .map((o) => ({ tableId: o.table_id as string, openedAtMs: new Date(o.opened_at).getTime() }));

  const cards: HandyTableCard[] = tableRows.map((t) => {
    const group = handyGroupView(tableGroups, t.id, openOrderRefs);
    const summary = byTable.get(t.id) ?? (group.orderTableId ? byTable.get(group.orderTableId) : null) ?? null;
    return {
      id: t.id,
      name: t.name,
      floorId: (t as { floor_id?: string | null }).floor_id ?? null,
      capacityMax: t.capacity_max,
      currentStatus: t.current_status,
      orderCount: summary?.orderCount ?? 0,
      openedAtMs: summary?.openedAtMs ?? null,
      guestCount: summary?.guestCount ?? 0,
      total: summary?.total ?? 0,
      groupTableIds: group.groupTableIds,
      orderTableId: group.orderTableId,
    };
  });

  return {
    tables: cards,
    calls: serviceCalls,
    floors: (floorRows ?? []).map((f) => ({ id: f.id, name: f.name })),
    defaultFloorId: floorBoardFrom(settings).defaultFloorId,
  };
}
