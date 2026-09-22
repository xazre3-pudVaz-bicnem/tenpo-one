import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { MenuItemsPanel } from '@/components/settings/menu-items-panel';
import { loadMenuSettingsData } from '../menu/data';

export const metadata: Metadata = { title: 'プラン | 設定' };

/**
 * 設定 > プラン（コース・飲み放題・食べ放題）。
 * 商品の種別「コース」をこの画面にまとめる。所要時間はフロア・ハンディの残り時間と L.O. に使い、
 * プランのときに出すカテゴリはメニューブックの「プランで出すカテゴリ」で決める。
 */
export default async function PlanSettingsPage() {
  const ctx = await requirePermission('menu.manage');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="プラン" en="Plans" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const data = await loadMenuSettingsData(ctx, targetStore.id);

  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="プラン"
        en="Plans"
        description={`${targetStore.name}・コース／飲み放題／食べ放題`}
        actions={
          <Link
            href="/app/settings/menu-book?tab=plans"
            className="inline-flex h-9 items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-navy hover:bg-gray-50"
          >
            プランで出すカテゴリ（メニューブック）
          </Link>
        }
      />
      <MenuItemsPanel
        mode="plan"
        storeId={targetStore.id}
        categories={data.categoryRows}
        taxRates={data.taxRates}
        initial={data.itemRows}
      />
    </div>
  );
}
