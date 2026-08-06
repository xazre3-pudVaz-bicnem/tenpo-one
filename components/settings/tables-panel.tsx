'use client';

import { useState, useTransition } from 'react';
import { Plus, Pencil, Trash2, Ban, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { toggleTableAvailability, deleteTable } from '@/app/app/settings/tables/actions';
import { TableDialog, type TableRow } from './table-dialog';
import type { FloorRow } from './floors-panel';

export interface TableListRow extends TableRow {
  floorName: string | null;
  currentStatus: string;
}

export function TablesPanel({
  storeId,
  floors,
  initial,
}: {
  storeId: string;
  floors: FloorRow[];
  initial: TableListRow[];
}) {
  const tables = initial;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TableListRow | null>(null);
  const [deleting, setDeleting] = useState<TableListRow | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleToggle = (t: TableListRow) => {
    const nextAvailable = t.currentStatus === 'unavailable';
    startTransition(async () => {
      const result = await toggleTableAvailability(t.id, storeId, nextAvailable);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast(nextAvailable ? 'テーブルを再開しました' : 'テーブルを利用停止にしました');
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          テーブル追加
        </Button>
      </div>

      {tables.length === 0 ? (
        <EmptyState title="テーブルが登録されていません" description="「テーブル追加」から登録してください" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>名前</Th>
                <Th>フロア</Th>
                <Th>席数</Th>
                <Th>種別</Th>
                <Th>状態</Th>
                <Th className="text-right">操作</Th>
              </Tr>
            </THead>
            <TBody>
              {tables.map((t) => (
                <Tr key={t.id}>
                  <Td className="font-medium text-navy">{t.name}</Td>
                  <Td>{t.floorName ?? '未割当'}</Td>
                  <Td>
                    {t.capacityMin}〜{t.capacityMax}名
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {t.isPrivateRoom && <Badge tone="primary">個室</Badge>}
                      {t.isCounter && <Badge tone="gray">カウンター</Badge>}
                      {t.smokingAllowed && <Badge tone="warning">喫煙可</Badge>}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={t.currentStatus === 'unavailable' ? 'gray' : 'success'}>
                      {t.currentStatus === 'unavailable' ? '利用停止中' : '利用可能'}
                    </Badge>
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => handleToggle(t)}
                        disabled={pending}
                        aria-label={t.currentStatus === 'unavailable' ? '利用再開' : '利用停止'}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                      >
                        {t.currentStatus === 'unavailable' ? (
                          <RotateCcw className="h-4 w-4" />
                        ) : (
                          <Ban className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(t);
                          setDialogOpen(true);
                        }}
                        aria-label="編集"
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(t)}
                        aria-label="削除"
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}

      {dialogOpen && (
        <TableDialog storeId={storeId} floors={floors} editing={editing} onClose={() => setDialogOpen(false)} />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title="テーブルを削除"
          message={`「${deleting.name}」を削除します。予約履歴保全のため削除後も履歴には表示されます。`}
          confirmLabel="削除する"
          onConfirm={async () => {
            const result = await deleteTable(deleting.id, storeId);
            if (result.error) {
              toast(result.error, 'error');
              return;
            }
            toast('テーブルを削除しました');
          }}
        />
      )}
    </div>
  );
}
