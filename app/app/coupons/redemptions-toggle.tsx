'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Spinner } from '@/components/ui/state';
import { yen, formatDateTime } from '@/lib/format';
import { getCouponRedemptions, type CouponRedemptionRow } from './actions';

/** クーポンの利用履歴を展開表示する（コード横のトグル） */
export function RedemptionsToggle({ couponId, count }: { couponId: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CouponRedemptionRow[] | null>(null);
  const [pending, startTransition] = useTransition();

  const handleToggle = () => {
    if (!open && rows === null) {
      startTransition(async () => {
        const data = await getCouponRedemptions(couponId);
        setRows(data);
      });
    }
    setOpen((v) => !v);
  };

  if (count === 0) {
    return <span className="text-xs text-gray-400">利用0件</span>;
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleToggle}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        利用{count.toLocaleString('ja-JP')}件
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="mt-2 max-w-md">
          {pending && rows === null ? (
            <Spinner className="h-4 w-4" />
          ) : !rows || rows.length === 0 ? (
            <p className="text-xs text-gray-400">利用履歴はありません</p>
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <Tr>
                    <Th>日時</Th>
                    <Th>顧客</Th>
                    <Th>注文</Th>
                    <Th className="text-right">値引額</Th>
                  </Tr>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <Tr key={r.id}>
                      <Td className="whitespace-nowrap">{formatDateTime(r.createdAt)}</Td>
                      <Td>{r.customerName ?? '—'}</Td>
                      <Td>
                        <Link href={`/app/orders/${r.orderId}`} className="text-primary hover:underline">
                          明細
                        </Link>
                      </Td>
                      <Td className="text-right tabular-nums">{yen(r.discountAmount)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </div>
      )}
    </div>
  );
}
