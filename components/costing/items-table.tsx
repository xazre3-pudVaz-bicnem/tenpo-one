'use client';

import { useRouter } from 'next/navigation';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { yen } from '@/lib/format';
import { ITEM_TYPE_LABELS, costRateTone, type MenuItemCostRow } from './labels';

/** 商品原価一覧テーブル。行クリックでレシピ編集画面へ遷移する */
export function ItemsTable({ rows }: { rows: MenuItemCostRow[] }) {
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <EmptyState
        title="対象の商品がありません"
        description="「メニュー」設定でフード・ドリンク・コースの商品を登録してください"
      />
    );
  }

  return (
    <TableWrap>
      <Table>
        <THead>
          <Tr>
            <Th>商品名</Th>
            <Th>カテゴリ</Th>
            <Th>種別</Th>
            <Th className="text-right">売価</Th>
            <Th className="text-right">レシピ原価</Th>
            <Th className="text-right">原価率</Th>
            <Th className="text-right">粗利益</Th>
            <Th className="text-right">粗利率</Th>
            <Th className="text-right">食材数</Th>
            <Th>警告</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <Tr key={r.id} className="cursor-pointer" onClick={() => router.push(`/app/costing/${r.id}`)}>
              <Td className="font-medium text-navy">{r.name}</Td>
              <Td>{r.categoryName}</Td>
              <Td>{ITEM_TYPE_LABELS[r.itemType] ?? r.itemType}</Td>
              <Td className="text-right tabular-nums">{yen(r.price)}</Td>
              <Td className="text-right tabular-nums">
                {r.ingredientCount > 0 ? (
                  yen(r.recipeCost)
                ) : (
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone="gray">レシピ未設定</Badge>
                    {r.manualCost != null && (
                      <span className="text-xs font-normal text-gray-400">手入力原価: {yen(r.manualCost)}</span>
                    )}
                  </div>
                )}
              </Td>
              <Td className="text-right tabular-nums">
                {r.costRate != null ? <Badge tone={costRateTone(r.costRate)}>{r.costRate}%</Badge> : '—'}
              </Td>
              <Td className="text-right tabular-nums">{r.grossProfitYen != null ? yen(r.grossProfitYen) : '—'}</Td>
              <Td className="text-right tabular-nums">
                {r.grossProfitRate != null ? `${r.grossProfitRate}%` : '—'}
              </Td>
              <Td className="text-right tabular-nums">{r.ingredientCount}</Td>
              <Td>
                {r.ingredientCount > 0 && r.missingCostCount > 0 && (
                  <Badge tone="warning">原価未設定食材あり（{r.missingCostCount}件）</Badge>
                )}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}
