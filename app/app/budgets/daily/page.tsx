import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { dailyBudgetsFrom } from '@/lib/daily-budget';
import { DailyBudgetBoard } from '@/components/budgets/daily-budget-board';

export const metadata: Metadata = { title: '日別予算登録' };

export default async function DailyBudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const ctx = await requirePermission('reports.view');
  const canEdit = ['org_owner', 'hq_admin', 'area_manager', 'store_manager'].includes(ctx.role);
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? (sp.month as string) : todayJst().slice(0, 7);

  const store = ctx.currentStore ?? ctx.stores[0] ?? null;
  if (!store) {
    return (
      <div>
        <PageHeader title="日別予算登録" en="DAILY SALES BUDGET" />
        <p className="text-sm text-gray-500">アクセス可能な店舗がありません</p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: row } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', store.id)
    .maybeSingle();
  const initial = dailyBudgetsFrom(row?.settings, month);

  return (
    <div>
      <PageHeader title="日別予算登録" en="DAILY SALES BUDGET" />
      <Link
        href="/app/budgets"
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-bold text-plum print:hidden"
      >
        <ChevronLeft className="h-4 w-4" />
        予算管理へ戻る
      </Link>
      <DailyBudgetBoard
        storeId={store.id}
        storeName={store.name}
        month={month}
        initial={initial}
        canEdit={canEdit}
      />
    </div>
  );
}
