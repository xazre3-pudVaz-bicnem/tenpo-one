import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { Card, CardContent } from '@/components/ui/card';
import { SettingsBackLink } from '@/components/settings/back-link';
import { CategoryPanel } from '@/components/settings/category-panel';
import { MenuItemsPanel } from '@/components/settings/menu-items-panel';
import type { MenuItemRow } from '@/components/settings/menu-item-dialog';
import { StationPanel } from './station-panel';

export const metadata: Metadata = { title: 'メニュー | 設定' };

export default async function MenuSettingsPage() {
  const ctx = await requirePermission('menu.manage');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="メニュー" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();

  const { data: categories } = await supabase
    .from('menu_categories')
    .select('id, name, color, sort_order, station')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .or(`store_id.is.null,store_id.eq.${targetStore.id}`)
    .order('sort_order');

  const { data: items } = await supabase
    .from('menu_items')
    .select(
      `id, category_id, name, name_kana, description, item_type, price, takeout_price, cost, tax_rate_id,
       duration_minutes, sell_start_time, sell_end_time, sort_order, is_sold_out, status, price_pending`
    )
    .eq('organization_id', ctx.organizationId)
    .neq('status', 'deleted')
    .or(`store_id.is.null,store_id.eq.${targetStore.id}`)
    .order('sort_order');

  const { data: taxRates } = await supabase
    .from('tax_rates')
    .select('id, name')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('is_default', { ascending: false });

  const categoryRows = (categories ?? []).map((c) => ({ id: c.id, name: c.name, color: c.color ?? '#7B3FF2', sortOrder: c.sort_order }));

  const itemRows: MenuItemRow[] = (items ?? []).map((i) => ({
    id: i.id,
    categoryId: i.category_id,
    name: i.name,
    nameKana: i.name_kana ?? '',
    description: i.description ?? '',
    itemType: i.item_type,
    price: i.price,
    takeoutPrice: i.takeout_price,
    cost: i.cost,
    taxRateId: i.tax_rate_id,
    durationMinutes: i.duration_minutes,
    sellStartTime: i.sell_start_time?.slice(0, 5) ?? null,
    sellEndTime: i.sell_end_time?.slice(0, 5) ?? null,
    sortOrder: i.sort_order,
    isSoldOut: i.is_sold_out,
    status: i.status as 'active' | 'hidden' | 'deleted',
    pricePending: i.price_pending ?? false,
  }));

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="メニュー" description={targetStore.name} />

      <div className="grid gap-5 lg:grid-cols-4">
        <div className="space-y-5 lg:col-span-1">
          <Card>
            <CardContent>
              <CategoryPanel storeId={targetStore.id} initial={categoryRows} />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <StationPanel categories={(categories ?? []).map((c) => ({ id: c.id, name: c.name, station: c.station }))} />
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-3">
          <MenuItemsPanel
            storeId={targetStore.id}
            categories={categoryRows}
            taxRates={(taxRates ?? []).map((t) => ({ id: t.id, name: t.name }))}
            initial={itemRows}
          />
        </div>
      </div>
    </div>
  );
}
