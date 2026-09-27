import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { MenuList } from '@/components/layout/menu-list';
import { menuLayout } from '@/app/app/menu/data';

export const metadata: Metadata = { title: '集計 | 設定' };

/**
 * 設定 > 集計（2026-09-28 Ronnie「集計は設定の中に」）。
 * レジ（iPad）の一覧に出していた 店舗運営・仕入・在庫・経理・労務・経営・店舗内共有・管理 の画面をここから開く。
 */
export default async function SettingsSummaryPage() {
  const ctx = await requireMember();
  const { summaryGroups } = menuLayout(ctx.role, ctx.disabledFeatures);

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="集計" en="Reports & admin" description="売上・仕入・経理・労務・経営などの画面" />
      {summaryGroups.length === 0 ? (
        <EmptyState title="表示できる項目がありません" description="権限の範囲では開ける画面がありません" />
      ) : (
        <MenuList groups={summaryGroups} />
      )}
    </div>
  );
}
