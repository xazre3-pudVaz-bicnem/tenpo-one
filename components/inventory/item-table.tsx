'use client';

import { useState } from 'react';
import { yen } from '@/lib/format';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import {
  ITEM_KIND_LABELS,
  STOCK_WARNING_LABELS,
  STOCK_WARNING_TONES,
  stockWarningLevel,
  type ItemKind,
} from './labels';
import { MovementForm } from './movement-form';
import { MovementHistoryDialog } from './movement-history-dialog';
import { TransferForm } from './transfer-form';
import { ItemForm } from './item-form';

export interface ItemRow {
  id: string;
  name: string;
  itemKind: ItemKind;
  category: string | null;
  unit: string;
  currentQuantity: number;
  reorderPoint: number | null;
  minQuantity: number | null;
  optimalQuantity: number | null;
  avgCost: number | null;
  lastPurchaseCost: number | null;
  purchaseUnit: string | null;
  purchaseToStockFactor: number;
}

interface StoreOption {
  id: string;
  name: string;
}

export function ItemTable({ rows, otherStores }: { rows: ItemRow[]; otherStores: StoreOption[] }) {
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
              <Th className="text-right">現在庫</Th>
              <Th>単位</Th>
              <Th>仕入単位</Th>
              <Th className="text-right">発注点</Th>
              <Th className="text-right">最低在庫</Th>
              <Th className="text-right">適正在庫</Th>
              <Th className="text-right">平均仕入単価</Th>
              <Th className="text-right">最終仕入単価</Th>
              <Th className="text-right">在庫金額</Th>
              <Th>警告</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => {
              const warning = stockWarningLevel(r);
              const stockValue = Math.round(r.currentQuantity * (r.avgCost ?? 0));
              return (
                <Tr key={r.id}>
                  <Td className="cursor-pointer font-medium text-navy" onClick={() => setHistoryItem(r)}>
                    {r.name}
                    {r.category && <span className="ml-1 text-xs font-normal text-gray-400">（{r.category}）</span>}
                  </Td>
                  <Td>{ITEM_KIND_LABELS[r.itemKind]}</Td>
                  <Td className="text-right tabular-nums">{r.currentQuantity}</Td>
                  <Td>{r.unit}</Td>
                  <Td>{r.purchaseUnit ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{r.reorderPoint ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{r.minQuantity ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{r.optimalQuantity ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{yen(r.avgCost)}</Td>
                  <Td className="text-right tabular-nums">{yen(r.lastPurchaseCost)}</Td>
                  <Td className="text-right tabular-nums">{yen(stockValue)}</Td>
                  <Td>
                    {warning && <Badge tone={STOCK_WARNING_TONES[warning]}>{STOCK_WARNING_LABELS[warning]}</Badge>}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1.5">
                      <ItemForm item={r} />
                      <MovementForm item={r} />
                      <TransferForm item={r} stores={otherStores} />
                    </div>
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
