import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { Card, CardContent } from '@/components/ui/card';
import { SettingsBackLink } from '@/components/settings/back-link';
import { CategoryPanel } from '@/components/settings/category-panel';
import { StationPanel } from '../menu/station-panel';
import { loadMenuSettingsData } from '../menu/data';

export const metadata: Metadata = { title: 'カテゴリ | 設定' };

/**
 * 設定 > カテゴリ。カテゴリの追加・名前・色と、厨房（キッチン／ドリンク／焼き場／デザート）への振り分け。
 * ハンディ・お客様QRでの出し方と順番はメニューブックで決める。
 */
export default async function CategorySettingsPage() {
  const ctx = await requirePermission('menu.manage');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="カテゴリ" en="Categories" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const data = await loadMenuSettingsData(ctx, targetStore.id);

  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="カテゴリ"
        en="Categories"
        description={targetStore.name}
        actions={
          <Link
            href="/app/settings/menu-book?tab=categories"
            className="inline-flex h-9 items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-navy hover:bg-gray-50"
          >
            順番・ハンディ／QRの出し方（メニューブック）
          </Link>
        }
      />
      <div className="grid gap-5 @4xl:grid-cols-2">
        <Card>
          <CardContent>
            <CategoryPanel storeId={targetStore.id} initial={data.categoryRows} />
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <StationPanel categories={data.stations} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
