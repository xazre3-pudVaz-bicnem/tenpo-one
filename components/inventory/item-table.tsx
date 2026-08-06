'use client';

import { useState } from 'react';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { ITEM_KIND_LABELS, type ItemKind } from './labels';
import { MovementForm } from './movement-form';
import { MovementHistoryDialog } from './movement-history-dialog';

export interface ItemRow {
  id: string;
  name: string;
  itemKind: ItemKind;
  category: string | null;
  unit: string;
  currentQuantity: number;
  reorderPoint: number | null;
  avgCost: number | null;
}

export function ItemTable({ rows }: { rows: ItemRow[] }) {
  const [historyItem, setHistoryItem] = useState<ItemRow | null>(null);

  if (rows.length === 0) {
    return <EmptyState title="品目が登録されていません" description="「品目を追加」から在庫品目を登録してください" />;
  }

  return (
    <>
      <TableWrap>
        <Table>
          <THead>
            <Tr>
              <Th>品目</Th>
              <Th>種別</Th>
              <Th>カテゴリ</Th>
              <Th className="text-right">現在庫</Th>
              <Th className="text-right">発注点</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => {
              const low = r.reorderPoint != null && r.currentQuantity <= r.reorderPoint;
              return (
                <Tr key={r.id}>
                  <Td className="cursor-pointer font-medium text-navy" onClick={() => setHistoryItem(r)}>
                    {r.name}
                  </Td>
                  <Td>{ITEM_KIND_LABELS[r.itemKind]}</Td>
                  <Td>{r.category ?? '—'}</Td>
                  <Td className="text-right tabular-nums">
                    {r.currentQuantity}
                    {r.unit}
                    {low && (
                      <Badge tone="warning" className="ml-2">
                        要発注
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{r.reorderPoint ?? '—'}</Td>
                  <Td className="text-right">
                    <MovementForm item={r} />
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </TableWrap>
      <MovementHistoryDialog item={historyItem} onClose={() => setHistoryItem(null)} />
    </>
  );
}
