import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadRecipeDetail } from '@/lib/costing-server';
import { yen } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RecipeTable } from '@/components/costing/recipe-table';
import { costRateTone, ITEM_TYPE_LABELS, type CostableItemType } from '@/components/costing/labels';

export const metadata: Metadata = { title: 'レシピ編集 | 原価管理' };

export default async function RecipeEditPage({ params }: { params: Promise<{ menuItemId: string }> }) {
  const ctx = await requirePermission('menu.manage');
  const { menuItemId } = await params;
  const supabase = await createClient();

  // 読み込みは lib/costing-server.ts（iPad ネイティブと共用）。レシピ食材の選択肢は全店共通（同名は現在店舗の品目を優先）
  const targetStore = ctx.currentStore ?? ctx.stores[0] ?? null;
  const detail = await loadRecipeDetail(supabase, ctx.organizationId, targetStore?.id ?? null, menuItemId);
  if (!detail) notFound();
  const { menuItem, lineRows, missingCostCount, displayCost, rate, gp, ingredientOptions } = detail;
  const rateTone = costRateTone(rate);
  const rateStatCardTone = rateTone === 'danger' || rateTone === 'warning' || rateTone === 'success' ? rateTone : 'default';

  return (
    <div>
      <Link href="/app/costing" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-navy">
        <ChevronLeft className="h-4 w-4" />
        原価管理に戻る
      </Link>

      <PageHeader
        title={menuItem.name}
        description={`${ITEM_TYPE_LABELS[menuItem.item_type as CostableItemType] ?? menuItem.item_type}｜売価 ${yen(menuItem.price)}`}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="売価" value={yen(menuItem.price)} />
        <StatCard label="現在のレシピ原価" value={displayCost != null ? yen(displayCost) : '—'} tone="primary" />
        <StatCard label="原価率" value={rate != null ? `${rate}%` : '—'} tone={rateStatCardTone} />
        <StatCard label="粗利益" value={gp.profit != null ? yen(gp.profit) : '—'} sub={gp.rate != null ? `粗利率 ${gp.rate}%` : undefined} />
      </div>

      <div className="mb-4 space-y-2">
        {lineRows.length > 0 && menuItem.cost != null && (
          <div className="rounded-xl border border-primary/30 bg-primary-soft px-4 py-3 text-xs text-primary-deep">
            レシピ原価が優先して表示されています。手入力原価: {yen(menuItem.cost)}
          </div>
        )}
        {missingCostCount > 0 && (
          <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-xs text-warning">
            原価未設定の食材が{missingCostCount}件あります。該当の食材原価はレシピ原価の計算に含まれていません。
          </div>
        )}
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
          この商品を販売すると構成食材の理論在庫が自動で減算されます。
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>レシピ明細</CardTitle>
        </CardHeader>
        <CardContent>
          <RecipeTable menuItemId={menuItem.id} lines={lineRows} ingredientOptions={ingredientOptions} />
        </CardContent>
      </Card>
    </div>
  );
}
