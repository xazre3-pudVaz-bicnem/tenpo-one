import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { calcRecipeCost, calcPriceChangeImpact, calcWasteAmount, type PriceImpactInput } from '@/lib/costing';
import { yen, todayJst, daysAgoJst } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/state';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { ItemsTable } from '@/components/costing/items-table';
import { fetchMenuItemCostRows, fetchIngredientLinesByMenuItems } from '@/components/costing/data';
import {
  COSTABLE_ITEM_TYPES,
  COST_RATE_WARNING_THRESHOLD,
  PRICE_DEVIATION_THRESHOLD,
  WASTE_DEFAULT_DAYS,
} from '@/components/costing/labels';

export const metadata: Metadata = { title: '原価管理' };

type Tab = 'items' | 'impact' | 'waste';

const TAB_LABELS: Record<Tab, string> = { items: '商品原価', impact: '仕入影響', waste: '廃棄・在庫差異' };

export default async function CostingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; category?: string; q?: string; ingredient?: string; from?: string; to?: string }>;
}) {
  await requireFeature('costing');
  const ctx = await requirePermission('menu.manage');
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'impact' ? 'impact' : sp.tab === 'waste' ? 'waste' : 'items';

  const targetStore = ctx.currentStore ?? ctx.stores[0];
  if (!targetStore) {
    return (
      <div>
        <PageHeader title="原価管理" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから原価管理を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();

  return (
    <div>
      <PageHeader title="原価管理" description={`店舗: ${targetStore.name}`} />

      <div className="mb-5 flex gap-1 border-b border-gray-200">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <Link
            key={t}
            href={`/app/costing?tab=${t}`}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t ? 'border-primary text-primary-deep' : 'border-transparent text-gray-500 hover:text-navy'
            )}
          >
            {TAB_LABELS[t]}
          </Link>
        ))}
      </div>

      {tab === 'items' && (
        <ItemsTabContent
          supabase={supabase}
          organizationId={ctx.organizationId}
          storeId={targetStore.id}
          category={sp.category}
          q={sp.q}
        />
      )}
      {tab === 'impact' && (
        <ImpactTabContent
          supabase={supabase}
          organizationId={ctx.organizationId}
          storeId={targetStore.id}
          selectedIngredientId={sp.ingredient ?? null}
        />
      )}
      {tab === 'waste' && (
        <WasteTabContent
          supabase={supabase}
          organizationId={ctx.organizationId}
          storeId={targetStore.id}
          from={sp.from}
          to={sp.to}
        />
      )}
    </div>
  );
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** [items] 商品原価一覧 */
async function ItemsTabContent({
  supabase,
  organizationId,
  storeId,
  category,
  q,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  category?: string;
  q?: string;
}) {
  const { rows, categories } = await fetchMenuItemCostRows(supabase, organizationId, storeId, {
    categoryId: category || null,
    q: q || null,
  });

  const ratedRows = rows.filter((r) => r.costRate != null);
  const avgCostRate =
    ratedRows.length > 0
      ? Math.round((ratedRows.reduce((sum, r) => sum + (r.costRate ?? 0), 0) / ratedRows.length) * 10) / 10
      : null;
  const recipeSetCount = rows.filter((r) => r.ingredientCount > 0).length;
  const warningCount = ratedRows.filter((r) => (r.costRate ?? 0) > COST_RATE_WARNING_THRESHOLD).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="平均原価率" value={avgCostRate != null ? `${avgCostRate}%` : '—'} tone="primary" />
        <StatCard label="レシピ設定済み商品数" value={`${recipeSetCount} / ${rows.length}件`} />
        <StatCard
          label="要注意商品数（原価率30%超）"
          value={`${warningCount}件`}
          tone={warningCount > 0 ? 'warning' : 'default'}
        />
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="items" />
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">カテゴリ</label>
          <Select name="category" defaultValue={category ?? ''} className="w-40">
            <option value="">すべて</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">検索</label>
          <Input name="q" defaultValue={q ?? ''} placeholder="商品名で検索" className="w-48" />
        </div>
        <Button type="submit" variant="secondary">
          絞り込む
        </Button>
        <Link
          href="/app/costing/export"
          className="ml-auto inline-flex h-10 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-navy hover:bg-gray-50"
        >
          CSV出力
        </Link>
      </form>

      <ItemsTable rows={rows} />
    </div>
  );
}

/** [impact] 仕入価格変動の影響分析 */
async function ImpactTabContent({
  supabase,
  organizationId,
  storeId,
  selectedIngredientId,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  selectedIngredientId: string | null;
}) {
  const { data: invItemsData } = await supabase
    .from('inventory_items')
    .select('id, name, unit, avg_cost, last_purchase_cost')
    .eq('organization_id', organizationId)
    .eq('store_id', storeId)
    .eq('status', 'active')
    .not('avg_cost', 'is', null)
    .not('last_purchase_cost', 'is', null)
    .order('name');

  const ingredients = (invItemsData ?? []).map((i) => ({
    id: i.id as string,
    name: i.name as string,
    unit: i.unit as string,
    avgCost: i.avg_cost as number,
    lastCost: i.last_purchase_cost as number,
  }));

  const deviations = ingredients
    .map((i) => ({
      ...i,
      deviationRate: i.avgCost > 0 ? Math.round((Math.abs(i.lastCost - i.avgCost) / i.avgCost) * 1000) / 10 : null,
    }))
    .filter((i) => i.deviationRate != null && i.deviationRate >= PRICE_DEVIATION_THRESHOLD)
    .sort((a, b) => (b.deviationRate ?? 0) - (a.deviationRate ?? 0))
    .slice(0, 10);

  const selected = selectedIngredientId ? (ingredients.find((i) => i.id === selectedIngredientId) ?? null) : null;

  let impactRows: ReturnType<typeof calcPriceChangeImpact> = [];
  if (selected) {
    const { data: recipeUse } = await supabase
      .from('menu_item_ingredients')
      .select('menu_item_id, quantity, menu_items(name, price, status, item_type)')
      .eq('inventory_item_id', selected.id);

    const usedItems = (recipeUse ?? [])
      .map((r) => ({
        menuItemId: r.menu_item_id as string,
        quantity: Number(r.quantity),
        menuItem: r.menu_items as unknown as { name: string; price: number; status: string; item_type: string } | null,
      }))
      .filter(
        (r): r is { menuItemId: string; quantity: number; menuItem: { name: string; price: number; status: string; item_type: string } } =>
          !!r.menuItem && r.menuItem.status === 'active' && (COSTABLE_ITEM_TYPES as string[]).includes(r.menuItem.item_type)
      );

    const menuItemIds = [...new Set(usedItems.map((u) => u.menuItemId))];
    const linesByItem = await fetchIngredientLinesByMenuItems(supabase, menuItemIds);

    const inputs: PriceImpactInput[] = usedItems.map((u) => ({
      menuItemName: u.menuItem.name,
      quantity: u.quantity,
      currentRecipeCost: calcRecipeCost(linesByItem.get(u.menuItemId) ?? []).totalCost,
      price: u.menuItem.price,
    }));

    impactRows = calcPriceChangeImpact(inputs, selected.avgCost, selected.lastCost);
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>最終仕入単価が平均と乖離している食材（乖離率{PRICE_DEVIATION_THRESHOLD}%以上）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {deviations.length === 0 ? (
            <div className="p-5">
              <EmptyState title="乖離している食材はありません" className="border-0 py-8" />
            </div>
          ) : (
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>食材</Th>
                    <Th className="text-right">平均仕入単価</Th>
                    <Th className="text-right">最終仕入単価</Th>
                    <Th className="text-right">乖離率</Th>
                  </Tr>
                </THead>
                <TBody>
                  {deviations.map((d) => (
                    <Tr key={d.id}>
                      <Td className="font-medium text-navy">{d.name}</Td>
                      <Td className="text-right tabular-nums">{yen(d.avgCost)}</Td>
                      <Td className="text-right tabular-nums">{yen(d.lastCost)}</Td>
                      <Td className="text-right tabular-nums">
                        <Badge tone="warning">{d.deviationRate}%</Badge>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>食材を選んで影響を確認</CardTitle>
        </CardHeader>
        <CardContent>
          {ingredients.length === 0 ? (
            <EmptyState
              title="対象の食材がありません"
              description="平均仕入単価と最終仕入単価の両方が登録されている食材が対象です"
              className="border-0 py-8"
            />
          ) : (
            <form method="GET" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="tab" value="impact" />
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">食材</label>
                <Select name="ingredient" defaultValue={selectedIngredientId ?? ''} className="w-64">
                  <option value="">選択してください</option>
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}（平均{yen(i.avgCost)} / 最終{yen(i.lastCost)}）
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" variant="secondary">
                影響を見る
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {selected && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="対象食材" value={selected.name} />
            <StatCard label="現在の平均仕入単価" value={yen(selected.avgCost)} />
            <StatCard
              label="最終仕入単価"
              value={yen(selected.lastCost)}
              tone={selected.lastCost > selected.avgCost ? 'warning' : 'default'}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>「{selected.name}」を使用する商品への影響</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {impactRows.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="この食材を使用するレシピ設定商品はありません" className="border-0 py-8" />
                </div>
              ) : (
                <TableWrap className="border-0">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>商品名</Th>
                        <Th className="text-right">原価変動額</Th>
                        <Th className="text-right">新原価</Th>
                        <Th className="text-right">原価率（変化前→変化後）</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {impactRows.map((r) => {
                        const worse = (r.newCostRate ?? 0) > (r.oldCostRate ?? 0);
                        return (
                          <Tr key={r.menuItemName}>
                            <Td className="font-medium text-navy">{r.menuItemName}</Td>
                            <Td className={cn('text-right tabular-nums', r.costDelta > 0 && 'text-danger')}>
                              {r.costDelta > 0 ? '+' : ''}
                              {yen(r.costDelta)}
                            </Td>
                            <Td className="text-right tabular-nums">{yen(r.newCost)}</Td>
                            <Td className={cn('text-right tabular-nums', worse && 'font-semibold text-danger')}>
                              {r.oldCostRate != null ? `${r.oldCostRate}%` : '—'} →{' '}
                              {r.newCostRate != null ? `${r.newCostRate}%` : '—'}
                            </Td>
                          </Tr>
                        );
                      })}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/** [waste] 廃棄・在庫差異 */
async function WasteTabContent({
  supabase,
  organizationId,
  storeId,
  from,
  to,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  from?: string;
  to?: string;
}) {
  const today = todayJst();
  const rangeFrom = from || daysAgoJst(WASTE_DEFAULT_DAYS - 1);
  const rangeTo = to || today;

  const { data: wasteMovements } = await supabase
    .from('stock_movements')
    .select('inventory_item_id, quantity, unit_cost, reason, inventory_items(name, unit)')
    .eq('organization_id', organizationId)
    .eq('store_id', storeId)
    .eq('movement_type', 'waste')
    .gte('business_date', rangeFrom)
    .lte('business_date', rangeTo);

  interface WasteGroup {
    id: string;
    name: string;
    unit: string;
    quantity: number;
    movements: { quantity: number; unitCost: number | null }[];
    reasons: Map<string, number>;
  }
  const groups = new Map<string, WasteGroup>();
  for (const m of wasteMovements ?? []) {
    const inv = m.inventory_items as unknown as { name: string; unit: string } | null;
    const id = m.inventory_item_id as string;
    let g = groups.get(id);
    if (!g) {
      g = { id, name: inv?.name ?? '（不明な食材）', unit: inv?.unit ?? '', quantity: 0, movements: [], reasons: new Map() };
      groups.set(id, g);
    }
    g.quantity += Math.abs(Number(m.quantity));
    g.movements.push({ quantity: Number(m.quantity), unitCost: m.unit_cost as number | null });
    const reason = (m.reason && (m.reason as string).trim()) || '理由未記入';
    g.reasons.set(reason, (g.reasons.get(reason) ?? 0) + 1);
  }
  const wasteRows = [...groups.values()]
    .map((g) => ({
      id: g.id,
      name: g.name,
      unit: g.unit,
      quantity: g.quantity,
      amount: calcWasteAmount(g.movements),
      reasonSummary: [...g.reasons.entries()].map(([r, c]) => `${r}×${c}`).join('、'),
    }))
    .sort((a, b) => b.amount - a.amount);

  const totalWasteAmount = calcWasteAmount(
    (wasteMovements ?? []).map((m) => ({ quantity: Number(m.quantity), unitCost: m.unit_cost as number | null }))
  );

  const { data: latestCount } = await supabase
    .from('stock_counts')
    .select('id, count_date')
    .eq('organization_id', organizationId)
    .eq('store_id', storeId)
    .eq('status', 'completed')
    .order('count_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  let diffRows: { id: string; name: string; unit: string; expected: number; counted: number; diff: number; diffAmount: number | null }[] = [];
  if (latestCount) {
    const { data: countItems } = await supabase
      .from('stock_count_items')
      .select('id, expected_quantity, counted_quantity, difference, inventory_items(name, unit, avg_cost)')
      .eq('stock_count_id', latestCount.id);
    diffRows = (countItems ?? [])
      .filter((ci) => ci.difference != null && Number(ci.difference) !== 0)
      .map((ci) => {
        const inv = ci.inventory_items as unknown as { name: string; unit: string; avg_cost: number | null } | null;
        const diff = Number(ci.difference);
        return {
          id: ci.id as string,
          name: inv?.name ?? '（不明な食材）',
          unit: inv?.unit ?? '',
          expected: Number(ci.expected_quantity),
          counted: Number(ci.counted_quantity),
          diff,
          diffAmount: inv?.avg_cost != null ? Math.round(diff * inv.avg_cost) : null,
        };
      });
  }

  const periods = [
    { label: '7日', from: daysAgoJst(6), to: today },
    { label: '30日', from: daysAgoJst(29), to: today },
    { label: '90日', from: daysAgoJst(89), to: today },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="期間プリセット">
        {periods.map((p) => {
          const active = p.from === rangeFrom && p.to === rangeTo;
          return (
            <Link
              key={p.label}
              href={`/app/costing?tab=waste&from=${p.from}&to=${p.to}`}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                active ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
              aria-current={active ? 'true' : undefined}
            >
              {p.label}
            </Link>
          );
        })}
        <form method="GET" className="flex items-center gap-1.5">
          <input type="hidden" name="tab" value="waste" />
          <Input type="date" name="from" defaultValue={rangeFrom} className="h-8 w-36 text-xs" />
          <span className="text-xs text-gray-400">〜</span>
          <Input type="date" name="to" defaultValue={rangeTo} className="h-8 w-36 text-xs" />
          <Button type="submit" variant="secondary" size="sm">
            適用
          </Button>
        </form>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="合計廃棄額" value={yen(totalWasteAmount)} tone="danger" sub={`${rangeFrom} 〜 ${rangeTo}`} />
        <StatCard label="廃棄品目数" value={`${wasteRows.length}件`} />
        <StatCard label="直近の棚卸" value={latestCount ? String(latestCount.count_date) : '未実施'} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>廃棄一覧</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {wasteRows.length === 0 ? (
            <div className="p-5">
              <EmptyState title="この期間の廃棄記録はありません" className="border-0 py-8" />
            </div>
          ) : (
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>品目</Th>
                    <Th className="text-right">廃棄数量</Th>
                    <Th className="text-right">廃棄額</Th>
                    <Th>理由内訳</Th>
                  </Tr>
                </THead>
                <TBody>
                  {wasteRows.map((r) => (
                    <Tr key={r.id}>
                      <Td className="font-medium text-navy">{r.name}</Td>
                      <Td className="text-right tabular-nums">
                        {r.quantity}
                        {r.unit}
                      </Td>
                      <Td className="text-right tabular-nums">{yen(r.amount)}</Td>
                      <Td className="text-xs text-gray-500">{r.reasonSummary}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>在庫差異（直近の棚卸）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <p className="px-5 pt-4 text-xs text-gray-500">
            理論在庫はレシピ・販売・入出庫から自動計算された値です。実在庫との差異は棚卸で確定します。
          </p>
          {!latestCount ? (
            <div className="p-5">
              <EmptyState title="確定済みの棚卸がありません" description="在庫から棚卸を実施すると差異が表示されます" className="border-0 py-8" />
            </div>
          ) : diffRows.length === 0 ? (
            <div className="p-5">
              <EmptyState title="差異のあった品目はありません" className="border-0 py-8" />
            </div>
          ) : (
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>品目</Th>
                    <Th className="text-right">理論在庫</Th>
                    <Th className="text-right">実在庫</Th>
                    <Th className="text-right">差異</Th>
                    <Th className="text-right">差異金額</Th>
                  </Tr>
                </THead>
                <TBody>
                  {diffRows.map((r) => (
                    <Tr key={r.id}>
                      <Td className="font-medium text-navy">{r.name}</Td>
                      <Td className="text-right tabular-nums">
                        {r.expected}
                        {r.unit}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {r.counted}
                        {r.unit}
                      </Td>
                      <Td className={cn('text-right tabular-nums', r.diff < 0 && 'text-danger')}>
                        {r.diff > 0 ? '+' : ''}
                        {r.diff}
                        {r.unit}
                      </Td>
                      <Td className={cn('text-right tabular-nums', r.diffAmount != null && r.diffAmount < 0 && 'text-danger')}>
                        {yen(r.diffAmount)}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
