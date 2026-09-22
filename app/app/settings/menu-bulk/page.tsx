import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { MenuBulkEditor } from '@/components/settings/menu-bulk-editor';
import { loadMenuSettingsData } from '../menu/data';

export const metadata: Metadata = { title: 'メニュー一括編集 | 設定' };

/** 設定 > メニュー一括編集（全店舗共通の機能） */
export default async function MenuBulkPage() {
  const ctx = await requirePermission('menu.manage');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="メニュー一括編集" en="Bulk edit" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const data = await loadMenuSettingsData(ctx, targetStore.id);

  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="メニュー一括編集"
        en="Bulk edit"
        description={`${targetStore.name}・商品名・カテゴリ・価格・表示・売切を表でまとめて変更`}
      />
      <MenuBulkEditor
        storeId={targetStore.id}
        categories={data.categoryRows.map((c) => ({ id: c.id, name: c.name }))}
        initial={data.itemRows
          .filter((i) => i.status !== 'deleted')
          .map((i) => ({
            id: i.id,
            name: i.name,
            nameEn: i.nameEn,
            categoryId: i.categoryId,
            itemType: i.itemType,
            price: i.price,
            takeoutPrice: i.takeoutPrice,
            status: i.status === 'hidden' ? 'hidden' : 'active',
            isSoldOut: i.isSoldOut,
          }))}
      />
    </div>
  );
}
