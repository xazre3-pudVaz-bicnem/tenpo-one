import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { MenuItemsPanel } from '@/components/settings/menu-items-panel';
import { loadMenuSettingsData } from './data';

export const metadata: Metadata = { title: 'メニュー | 設定' };

/**
 * 設定 > メニュー（単品の商品）。
 * プラン（コース・飲み放題）は「プラン」、カテゴリと厨房の振り分けは「カテゴリ」の画面に分けている（dinii と同じ分け方）。
 */
export default async function MenuSettingsPage() {
  const ctx = await requirePermission('menu.manage');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="メニュー" en="Menu" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const data = await loadMenuSettingsData(ctx, targetStore.id);

  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="メニュー"
        en="Menu"
        description={`${targetStore.name}・単品の商品（コース・飲み放題は「プラン」）`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/app/settings/categories"
              className="inline-flex h-9 items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-navy hover:bg-gray-50"
            >
              カテゴリ
            </Link>
            <Link
              href="/app/settings/menu-book"
              className="inline-flex h-9 items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-navy hover:bg-gray-50"
            >
              並び順・ハンディ／QRの出し方（メニューブック）
            </Link>
          </div>
        }
      />
      <MenuItemsPanel
        mode="menu"
        storeId={targetStore.id}
        categories={data.categoryRows}
        taxRates={data.taxRates}
        initial={data.itemRows}
      />
    </div>
  );
}
