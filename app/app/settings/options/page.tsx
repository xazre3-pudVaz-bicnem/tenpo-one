import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { OptionGroupsPanel, type OptionGroupRow } from '@/components/settings/option-groups-panel';

export const metadata: Metadata = { title: 'メニュー選択肢 | 設定' };

export default async function OptionsSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="メニュー選択肢" en="Menu options" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: groups }, { data: links }, { data: menuItems }] = await Promise.all([
    supabase
      .from('menu_option_groups')
      .select('id, name, is_required, min_select, max_select, sort_order, menu_option_items(id, name, price, sort_order, status)')
      .eq('store_id', targetStore.id)
      .eq('status', 'active')
      .order('sort_order'),
    supabase.from('menu_item_option_groups').select('group_id, menu_item_id').eq('store_id', targetStore.id),
    supabase
      .from('menu_items')
      .select('id, name')
      .eq('store_id', targetStore.id)
      .eq('status', 'active')
      .neq('item_type', 'option')
      .order('name'),
  ]);

  const itemsByGroup = new Map<string, string[]>();
  for (const l of links ?? []) {
    const arr = itemsByGroup.get(l.group_id) ?? [];
    arr.push(l.menu_item_id);
    itemsByGroup.set(l.group_id, arr);
  }

  const rows: OptionGroupRow[] = (groups ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    isRequired: g.is_required,
    minSelect: g.min_select,
    maxSelect: g.max_select,
    items: ((g.menu_option_items ?? []) as { id: string; name: string; price: number; sort_order: number; status: string }[])
      .filter((o) => o.status === 'active')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((o) => ({ id: o.id, name: o.name, price: o.price })),
    menuItemIds: itemsByGroup.get(g.id) ?? [],
  }));

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="メニュー選択肢" en="Menu options" description={targetStore.name} />
      <OptionGroupsPanel
        storeId={targetStore.id}
        groups={rows}
        menuItems={(menuItems ?? []).map((m) => ({ id: m.id, name: m.name }))}
      />
    </div>
  );
}
