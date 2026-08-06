'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { getMovementHistory } from '@/app/app/inventory/actions';
import { MOVEMENT_TYPE_LABELS, type MovementType } from './labels';

interface HistoryRow {
  id: string;
  movementType: MovementType;
  quantity: number;
  reason: string | null;
  occurredAt: string;
}

/** 品目行クリックで開く、直近50件の入出庫履歴 */
export function MovementHistoryDialog({
  item,
  onClose,
}: {
  item: { id: string; name: string; unit: string } | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!item) return;
    (async () => {
      setLoading(true);
      try {
        const data = await getMovementHistory(item.id);
        setRows(data);
      } finally {
        setLoading(false);
      }
    })();
  }, [item]);

  if (!item) return null;

  return (
    <Dialog open={!!item} onClose={onClose} title={`入出庫履歴：${item.name}`} wide>
      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">履歴はありません</p>
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>日時</Th>
                <Th>種別</Th>
                <Th className="text-right">数量</Th>
                <Th>理由</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>{formatDateTime(r.occurredAt)}</Td>
                  <Td>{MOVEMENT_TYPE_LABELS[r.movementType]}</Td>
                  <Td className={`text-right tabular-nums ${r.quantity < 0 ? 'text-danger' : 'text-success'}`}>
                    {r.quantity > 0 ? '+' : ''}
                    {r.quantity}
                    {item.unit}
                  </Td>
                  <Td>{r.reason ?? '—'}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </Dialog>
  );
}
