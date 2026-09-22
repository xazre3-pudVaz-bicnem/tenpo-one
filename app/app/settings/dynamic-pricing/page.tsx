import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { DynamicPricingEditor } from '@/components/settings/dynamic-pricing-editor';
import { dynamicPricingFrom } from '@/lib/dynamic-pricing';
import { loadMenuSettingsData } from '../menu/data';

export const metadata: Metadata = { title: 'ダイナミックプライシング | 設定' };

/** 設定 > ダイナミックプライシング（曜日・時間帯で値段を自動で変える。全店舗共通の機能） */
export default async function DynamicPricingPage() {
  const ctx = await requirePermission('menu.manage');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="ダイナミックプライシング" en="Dynamic pricing" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();
  const [data, { data: settingsRow }] = await Promise.all([
    loadMenuSettingsData(ctx, targetStore.id),
    supabase.from('store_settings').select('settings').eq('store_id', targetStore.id).maybeSingle(),
  ]);

  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="ダイナミックプライシング"
        en="Dynamic pricing"
        description={`${targetStore.name}・曜日と時間帯で値段を自動で変える（ハッピーアワー・深夜料金など）`}
      />
      <DynamicPricingEditor
        storeId={targetStore.id}
        initial={dynamicPricingFrom(settingsRow?.settings ?? null).rules}
        categories={data.categoryRows.map((c) => ({ id: c.id, name: c.name }))}
        items={data.itemRows
          .filter((i) => i.status === 'active' && (i.itemType === 'food' || i.itemType === 'drink'))
          .map((i) => ({ id: i.id, name: i.name, categoryId: i.categoryId, itemType: i.itemType, price: i.price }))}
      />
    </div>
  );
}
