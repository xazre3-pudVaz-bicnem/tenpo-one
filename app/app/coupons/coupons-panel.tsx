'use client';

import { useState, useTransition } from 'react';
import { Plus, Pencil, Pause, Play, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { yen, formatDate } from '@/lib/format';
import { CouponDialog, type CouponFormRow, type StoreOption, type CategoryOption, type MenuItemOption } from './coupon-dialog';
import { RedemptionsToggle } from './redemptions-toggle';
import { setCouponStatus } from './actions';

export interface CouponRow extends CouponFormRow {
  storeName: string | null;
  targetLabel: string;
  status: 'active' | 'paused' | 'deleted';
  redemptionCount: number;
}

const STATUS_LABELS: Record<CouponRow['status'], string> = { active: '有効', paused: '停止中', deleted: '削除済み' };
const STATUS_TONES: Record<CouponRow['status'], BadgeTone> = { active: 'success', paused: 'warning', deleted: 'gray' };

export function CouponsPanel({
  initial,
  stores,
  categories,
  items,
}: {
  initial: CouponRow[];
  stores: StoreOption[];
  categories: CategoryOption[];
  items: MenuItemOption[];
}) {
  const rows = initial;
  const [showDeleted, setShowDeleted] = useState(false);
  const [dialogState, setDialogState] = useState<{ open: boolean; editing: CouponRow | null }>({ open: false, editing: null });
  const [deleting, setDeleting] = useState<CouponRow | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const visibleRows = showDeleted ? rows : rows.filter((r) => r.status !== 'deleted');

  const handleStatusChange = (row: CouponRow, status: 'active' | 'paused' | 'deleted') => {
    startTransition(async () => {
      const result = await setCouponStatus(row.id, status);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast(
        status === 'paused' ? 'クーポンを停止しました' : status === 'active' ? 'クーポンを再開しました' : 'クーポンを削除しました'
      );
      setDeleting(null);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(e) => setShowDeleted(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          削除済みを含めて表示
        </label>
        <Button size="sm" onClick={() => setDialogState({ open: true, editing: null })}>
          <Plus className="h-4 w-4" />
          クーポンを作成
        </Button>
      </div>

      {visibleRows.length === 0 ? (
        <EmptyState title="クーポンが登録されていません" description="「クーポンを作成」から登録してください" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>コード</Th>
                <Th>名称</Th>
                <Th>種別・値</Th>
                <Th>期間</Th>
                <Th>利用状況</Th>
                <Th>状態</Th>
                <Th className="text-right">操作</Th>
              </Tr>
            </THead>
            <TBody>
              {visibleRows.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-mono text-xs font-semibold text-navy">{r.code}</Td>
                  <Td>
                    <p className="font-medium text-navy">{r.name}</p>
                    <p className="text-xs text-gray-500">
                      {r.storeName ?? '全店'}｜{r.targetLabel}
                      {r.firstVisitOnly && '｜新規限定'}
                    </p>
                  </Td>
                  <Td className="tabular-nums">{r.kind === 'percent' ? `${r.value}%OFF` : `${yen(r.value)}引き`}</Td>
                  <Td className="text-xs text-gray-600">
                    {r.startsAt ? formatDate(r.startsAt) : '—'} 〜 {r.endsAt ? formatDate(r.endsAt) : '無期限'}
                  </Td>
                  <Td>
                    <RedemptionsToggle couponId={r.id} count={r.redemptionCount} />
                    {r.maxUses != null && (
                      <p className="mt-0.5 text-xs text-gray-400">
                        上限{r.maxUses}件{r.perCustomerLimit != null ? `（1人${r.perCustomerLimit}件まで）` : ''}
                      </p>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      {r.status !== 'deleted' && (
                        <button
                          type="button"
                          onClick={() => setDialogState({ open: true, editing: r })}
                          aria-label="編集"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {r.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => handleStatusChange(r, 'paused')}
                          disabled={pending}
                          aria-label="停止"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-warning-soft hover:text-warning"
                        >
                          <Pause className="h-4 w-4" />
                        </button>
                      )}
                      {r.status === 'paused' && (
                        <button
                          type="button"
                          onClick={() => handleStatusChange(r, 'active')}
                          disabled={pending}
                          aria-label="再開"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-success-soft hover:text-success"
                        >
                          <Play className="h-4 w-4" />
                        </button>
                      )}
                      {r.status !== 'deleted' && (
                        <button
                          type="button"
                          onClick={() => setDeleting(r)}
                          aria-label="削除"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}

      {dialogState.open && (
        <CouponDialog
          key={dialogState.editing?.id ?? 'new'}
          editing={dialogState.editing}
          stores={stores}
          categories={categories}
          items={items}
          onClose={() => setDialogState({ open: false, editing: null })}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title="クーポンを削除"
          message={`「${deleting.name}」（${deleting.code}）を削除します。過去の利用履歴は保持されます。`}
          confirmLabel="削除する"
          onConfirm={async () => handleStatusChange(deleting, 'deleted')}
        />
      )}
    </div>
  );
}
