import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { MenuList } from '@/components/layout/menu-list';
import { menuLayout } from '../data';

export const metadata: Metadata = { title: '集計' };

/**
 * 集計（2026-09-23 要望）。
 * メニュー一覧の下に並んでいた 店舗運営・仕入・在庫・経理・管理・チーム を
 * 1つのボタンにまとめ、この画面に入れた。
 */
export default async function MenuSummaryPage() {
  const ctx = await requireMember();
  const { summaryGroups } = menuLayout(ctx.role, ctx.disabledFeatures);

  return (
    <div>
      <Link
        href="/app/menu"
        className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-iris hover:underline"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        メニュー
      </Link>
      <PageHeader title="集計" en="Reports & admin" />
      {summaryGroups.length === 0 ? (
        <EmptyState title="表示できる項目がありません" description="権限の範囲では開ける画面がありません" />
      ) : (
        <MenuList groups={summaryGroups} />
      )}
    </div>
  );
}
