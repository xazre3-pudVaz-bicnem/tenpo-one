import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsBackLink } from '@/components/settings/back-link';
import { FloorsPanel } from '@/components/settings/floors-panel';
import { TablesPanel, type TableListRow } from '@/components/settings/tables-panel';
import { PlacementEditorPanel, type PlacementTableRow } from '@/components/settings/placement-editor-panel';

export const metadata: Metadata = { title: 'フロア・テーブル | 設定' };

export default async function TablesSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="フロア・テーブル" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: floors } = await supabase
    .from('floors')
    .select('id, name')
    .eq('store_id', targetStore.id)
    .eq('status', 'active')
    .order('sort_order');

  const { data: tables } = await supabase
    .from('restaurant_tables')
    .select(
      'id, name, floor_id, capacity_min, capacity_max, is_private_room, is_counter, smoking_allowed, sort_order, current_status, pos_x, pos_y, shape, floors(name)'
    )
    .eq('store_id', targetStore.id)
    .eq('status', 'active')
    .order('sort_order');

  const floorRows = (floors ?? []).map((f) => ({ id: f.id, name: f.name }));

  const tableRows: TableListRow[] = (tables ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    floorId: t.floor_id,
    floorName: (t.floors as unknown as { name: string } | null)?.name ?? null,
    capacityMin: t.capacity_min,
    capacityMax: t.capacity_max,
    isPrivateRoom: t.is_private_room,
    isCounter: t.is_counter,
    smokingAllowed: t.smoking_allowed,
    sortOrder: t.sort_order,
    currentStatus: t.current_status,
  }));

  const placementRows: PlacementTableRow[] = (tables ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    floorId: t.floor_id,
    capacityMin: t.capacity_min,
    capacityMax: t.capacity_max,
    posX: t.pos_x,
    posY: t.pos_y,
    shape: t.shape as 'square' | 'round' | 'counter',
  }));

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="フロア・テーブル" description={targetStore.name} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <FloorsPanel storeId={targetStore.id} initial={floorRows} />
        </div>
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>テーブル</CardTitle>
            </CardHeader>
            <CardContent>
              <TablesPanel storeId={targetStore.id} floors={floorRows} initial={tableRows} />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-5">
        <Card>
          <CardHeader>
            <CardTitle>配置エディタ</CardTitle>
          </CardHeader>
          <CardContent>
            <PlacementEditorPanel storeId={targetStore.id} floors={floorRows} tables={placementRows} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
