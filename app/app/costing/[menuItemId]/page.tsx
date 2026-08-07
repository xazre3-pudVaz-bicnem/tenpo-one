import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { calcRecipeCost, costRate, grossProfit, type RecipeLine } from '@/lib/costing';
import { yen } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RecipeTable, type RecipeLineRow } from '@/components/costing/recipe-table';
import type { IngredientOption } from '@/components/costing/recipe-line-form';
import { resolveDisplayCost, costRateTone, ITEM_TYPE_LABELS, type CostableItemType } from '@/components/costing/labels';

export const metadata: Metadata = { title: 'レシピ編集 | 原価管理' };

export default async function RecipeEditPage({ params }: { params: Promise<{ menuItemId: string }> }) {
  const ctx = await requirePermission('menu.manage');
  const { menuItemId } = await params;
  const supabase = await createClient();

  const { data: menuItem } = await supabase
    .from('menu_items')
    .select('id, name, item_type, price, cost, status')
    .eq('id', menuItemId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!menuItem) notFound();

  const { data: lineData } = await supabase
    .from('menu_item_ingredients')
    .select('id, inventory_item_id, quantity, note, inventory_items(name, unit, avg_cost)')
    .eq('menu_item_id', menuItemId)
    .order('created_at');
  const rawLines = lineData ?? [];

  const recipeLines: RecipeLine[] = rawLines.map((l) => {
    const inv = l.inventory_items as unknown as { name: string; unit: string; avg_cost: number | null } | null;
    return { ingredientName: inv?.name ?? '（不明な食材）', quantity: Number(l.quantity), avgCost: inv?.avg_cost ?? null };
  });
  const costResult = calcRecipeCost(recipeLines);

  const lineRows: RecipeLineRow[] = rawLines.map((l, idx) => {
    const inv = l.inventory_items as unknown as { name: string; unit: string; avg_cost: number | null } | null;
    return {
      id: l.id as string,
      inventoryItemId: l.inventory_item_id as string,
      ingredientName: inv?.name ?? '（不明な食材）',
      unit: inv?.unit ?? '',
      quantity: Number(l.quantity),
      avgCost: inv?.avg_cost ?? null,
      lineCost: costResult.lines[idx]?.cost ?? null,
      note: l.note as string | null,
    };
  });

  const recipeCost = lineRows.length > 0 ? costResult.totalCost : null;
  const displayCost = resolveDisplayCost(recipeCost, menuItem.cost);
  const rate = displayCost != null ? costRate(displayCost, menuItem.price) : null;
  const gp = displayCost != null ? grossProfit(menuItem.price, displayCost) : { profit: null, rate: null };
  const rateTone = costRateTone(rate);
  const rateStatCardTone = rateTone === 'danger' || rateTone === 'warning' || rateTone === 'success' ? rateTone : 'default';

  // レシピ食材の選択肢: 全店共通運用のため、重複名を除いた品目名で表示し選択は品目ID。
  // 同名品目が複数店舗にある場合は、当ユーザーの現在店舗の品目を優先する。
  const targetStore = ctx.currentStore ?? ctx.stores[0] ?? null;
  const { data: allInvItems } = await supabase
    .from('inventory_items')
    .select('id, name, unit, avg_cost, store_id')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('name');

  const sorted = [...(allInvItems ?? [])].sort((a, b) => {
    const aPref = targetStore && a.store_id === targetStore.id ? 0 : 1;
    const bPref = targetStore && b.store_id === targetStore.id ? 0 : 1;
    if (aPref !== bPref) return aPref - bPref;
    return (a.name as string).localeCompare(b.name as string, 'ja');
  });
  const seenNames = new Set<string>();
  const ingredientOptions: IngredientOption[] = [];
  for (const it of sorted) {
    const name = it.name as string;
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    ingredientOptions.push({ id: it.id as string, name, unit: it.unit as string, avgCost: it.avg_cost as number | null });
  }
  ingredientOptions.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

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
        {costResult.missingCostCount > 0 && (
          <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-xs text-warning">
            原価未設定の食材が{costResult.missingCostCount}件あります。該当の食材原価はレシピ原価の計算に含まれていません。
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
