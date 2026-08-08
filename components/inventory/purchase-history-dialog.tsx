'use client';

/**
 * 品目の仕入価格履歴ダイアログ（v0.4.3）。
 * 現在平均単価（加重平均） / 前回単価 / 前々回単価を比較し、isPriceIncreaseSignificant
 * （既定10%以上）を満たす場合は「前回比+X%値上がり」バッジを表示する。
 * 明細（日付・仕入先・単価・数量）は stock_movements(movement_type='in') 直近30件。
 */
import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/state';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { yen, formatDate } from '@/lib/format';
import { getPurchaseHistory, type PurchaseHistoryResult } from '@/app/app/inventory/actions';

export function PurchaseHistoryDialog({
  item,
  onClose,
}: {
  item: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<PurchaseHistoryResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!item) return;
    (async () => {
      setLoading(true);
      try {
        const result = await getPurchaseHistory(item.id);
        setData(result);
      } finally {
        setLoading(false);
      }
    })();
  }, [item]);

  if (!item) return null;

  return (
    <Dialog open={!!item} onClose={onClose} title={`仕入価格履歴：${item.name}`} wide>
      {loading || !data ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="現在平均単価" value={yen(data.currentAvgCost)} tone="primary" sub="加重平均（入荷のたび自動更新）" />
            <StatCard label="前回仕入単価" value={yen(data.previousUnitCost)} />
            <StatCard label="前々回仕入単価" value={yen(data.priorUnitCost)} />
          </div>

          {data.changeRatePct != null && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">前回比（前々回→前回）:</span>
              <span
                className={`font-semibold tabular-nums ${data.changeRatePct > 0 ? 'text-danger' : data.changeRatePct < 0 ? 'text-success' : 'text-navy'}`}
              >
                {data.changeRatePct > 0 ? '+' : ''}
                {data.changeRatePct.toFixed(1)}%
              </span>
              {data.isSignificantIncrease && <Badge tone="danger">前回比+{data.changeRatePct.toFixed(0)}%値上がり</Badge>}
            </div>
          )}

          {data.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">入荷履歴はありません</p>
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <Tr>
                    <Th>日付</Th>
                    <Th>仕入先</Th>
                    <Th className="text-right">単価</Th>
                    <Th className="text-right">数量</Th>
                  </Tr>
                </THead>
                <TBody>
                  {data.rows.map((r) => (
                    <Tr key={r.id}>
                      <Td>{formatDate(r.businessDate)}</Td>
                      <Td>{r.vendorName ?? '—'}</Td>
                      <Td className="text-right tabular-nums">{yen(r.unitCost)}</Td>
                      <Td className="text-right tabular-nums">
                        {r.quantity}
                        {data.unit}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
          <p className="text-xs text-gray-400">
            仕入先は発注書（purchase_orders）経由の入荷のみ判明します。手動登録した入荷は「—」表示です。
          </p>
        </div>
      )}
    </Dialog>
  );
}
