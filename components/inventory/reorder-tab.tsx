'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';

export interface ReorderRow {
  id: string;
  name: string;
  unit: string;
  currentQuantity: number;
  avgDailySales: number;
  incomingQuantity: number;
  needed: boolean;
  suggestedQuantity: number;
  basis: string;
}

/** 発注提案タブ。needed=trueを上位に、チェックした品目を推奨数付きで発注書作成へ引き継ぐ */
export function ReorderTab({ rows }: { rows: ReorderRow[] }) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(rows.filter((r) => r.needed).map((r) => r.id)));
  const router = useRouter();

  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) => Number(b.needed) - Number(a.needed) || b.suggestedQuantity - a.suggestedQuantity || a.name.localeCompare(b.name, 'ja')
      ),
    [rows]
  );

  if (rows.length === 0) {
    return <EmptyState title="対象の品目がありません" description="在庫品目を登録すると発注提案が表示されます" />;
  }

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRows = sorted.filter((r) => checked.has(r.id) && r.suggestedQuantity > 0);

  const createOrder = () => {
    const items = selectedRows.map((r) => `${r.id}:${r.suggestedQuantity}`).join(',');
    router.push(`/app/purchases/new?${new URLSearchParams({ items }).toString()}`);
  };

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs text-gray-600">
        自動発注は行いません。内容を確認して発注へ進んでください
      </p>

      <TableWrap>
        <Table>
          <THead>
            <Tr>
              <Th />
              <Th>品目</Th>
              <Th className="text-right">現在庫</Th>
              <Th className="text-right">平均日販（過去30日）</Th>
              <Th className="text-right">入荷待ち</Th>
              <Th className="text-right">推奨発注数</Th>
              <Th>根拠</Th>
              <Th>要否</Th>
            </Tr>
          </THead>
          <TBody>
            {sorted.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    checked={checked.has(r.id)}
                    onChange={() => toggle(r.id)}
                    aria-label={`${r.name}を選択`}
                  />
                </Td>
                <Td className="font-medium text-navy">{r.name}</Td>
                <Td className="text-right tabular-nums">
                  {r.currentQuantity}
                  {r.unit}
                </Td>
                <Td className="text-right tabular-nums">
                  {r.avgDailySales}
                  {r.unit}
                </Td>
                <Td className="text-right tabular-nums">
                  {r.incomingQuantity}
                  {r.unit}
                </Td>
                <Td className="text-right font-semibold tabular-nums text-navy">
                  {r.suggestedQuantity}
                  {r.unit}
                </Td>
                <Td className="max-w-xs whitespace-normal text-xs text-gray-500">{r.basis}</Td>
                <Td>{r.needed && <Badge tone="warning">要発注</Badge>}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>

      <div className="flex justify-end">
        <Button onClick={createOrder} disabled={selectedRows.length === 0}>
          選択品目で発注書を作成（{selectedRows.length}件）
        </Button>
      </div>
    </div>
  );
}
