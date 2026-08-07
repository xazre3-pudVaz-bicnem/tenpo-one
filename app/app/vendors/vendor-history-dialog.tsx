'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Dialog } from '@/components/ui/dialog';
import { Spinner, EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { yen, formatDate } from '@/lib/format';
import { PO_STATUS_LABELS, PO_STATUS_TONES, type PoStatus } from '@/components/inventory/labels';
import { getVendorRecentOrders } from './actions';

interface HistoryRow {
  id: string;
  poNo: number;
  status: string;
  total: number;
  expectedAt: string | null;
}

/** 仕入先の直近発注履歴（最大5件）ダイアログ */
export function VendorHistoryDialog({
  vendor,
  onClose,
}: {
  vendor: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!vendor) return;
    (async () => {
      setLoading(true);
      try {
        const data = await getVendorRecentOrders(vendor.id);
        setRows(data);
      } finally {
        setLoading(false);
      }
    })();
  }, [vendor]);

  if (!vendor) return null;

  return (
    <Dialog open={!!vendor} onClose={onClose} title={`発注履歴：${vendor.name}`} wide>
      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="発注履歴はありません" className="border-0 py-6" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>発注番号</Th>
                <Th>状態</Th>
                <Th className="text-right">金額</Th>
                <Th>入荷予定</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/app/purchases/${r.id}`} className="font-medium text-primary hover:underline">
                      #{r.poNo}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={PO_STATUS_TONES[r.status as PoStatus]}>{PO_STATUS_LABELS[r.status as PoStatus]}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{yen(r.total)}</Td>
                  <Td>{formatDate(r.expectedAt)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </Dialog>
  );
}
