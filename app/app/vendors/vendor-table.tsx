'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { deleteVendor } from './actions';
import { VendorForm, type VendorFormData } from './vendor-form';
import { VendorHistoryDialog } from './vendor-history-dialog';

export interface VendorRow extends VendorFormData {
  status: 'active' | 'inactive' | 'deleted';
  monthlyInvoiceTotal: number;
  monthlyPurchaseTotal: number;
  activePoCount: number;
}

const STATUS_LABELS: Record<VendorRow['status'], string> = { active: '取引中', inactive: '休止', deleted: '削除済み' };
const STATUS_TONES: Record<VendorRow['status'], BadgeTone> = { active: 'success', inactive: 'gray', deleted: 'danger' };

export function VendorTable({ rows }: { rows: VendorRow[] }) {
  const [target, setTarget] = useState<VendorRow | null>(null);
  const [historyVendor, setHistoryVendor] = useState<VendorRow | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  if (rows.length === 0) {
    return <EmptyState title="仕入先が登録されていません" description="「仕入先を登録」から取引先を追加してください" />;
  }

  return (
    <>
      <TableWrap>
        <Table>
          <THead>
            <Tr>
              <Th>名前</Th>
              <Th>担当者</Th>
              <Th>電話番号</Th>
              <Th>状態</Th>
              <Th className="text-right">当月請求額</Th>
              <Th className="text-right">今月仕入額</Th>
              <Th className="text-right">進行中発注</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {rows.map((v) => (
              <Tr key={v.id}>
                <Td className="font-medium text-navy">
                  {v.name}
                  {v.nameKana && <span className="ml-1 text-xs font-normal text-gray-400">（{v.nameKana}）</span>}
                </Td>
                <Td>{v.contactName ?? '—'}</Td>
                <Td>{v.phone ?? '—'}</Td>
                <Td>
                  <Badge tone={STATUS_TONES[v.status]}>{STATUS_LABELS[v.status]}</Badge>
                </Td>
                <Td className="text-right tabular-nums">{yen(v.monthlyInvoiceTotal)}</Td>
                <Td className="text-right tabular-nums">{yen(v.monthlyPurchaseTotal)}</Td>
                <Td className="text-right tabular-nums">{v.activePoCount}件</Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setHistoryVendor(v)}>
                      発注履歴
                    </Button>
                    <VendorForm vendor={v} />
                    {v.status !== 'deleted' && (
                      <Button size="sm" variant="danger" onClick={() => setTarget(v)}>
                        削除
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title="仕入先を削除"
        message={`「${target?.name}」を削除します。`}
        requireReason
        confirmLabel="削除する"
        onConfirm={async (reason) => {
          if (!target) return;
          await deleteVendor(target.id, reason);
          toast('仕入先を削除しました');
          router.refresh();
        }}
      />
      <VendorHistoryDialog vendor={historyVendor} onClose={() => setHistoryVendor(null)} />
    </>
  );
}
