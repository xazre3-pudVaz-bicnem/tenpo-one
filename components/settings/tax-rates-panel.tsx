'use client';

import { useState, useTransition } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { saveTaxRate, deleteTaxRate, type TaxRateInput } from '@/app/app/settings/tax/actions';

export interface TaxRateRow {
  id: string;
  name: string;
  rate: number;
  isReduced: boolean;
  isInclusive: boolean;
  isDefault: boolean;
}

const EMPTY: TaxRateInput = { name: '', rate: 10, isReduced: false, isInclusive: true, isDefault: false };

export function TaxRatesPanel({ initial }: { initial: TaxRateRow[] }) {
  const rows = initial;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [form, setForm] = useState<TaxRateInput>(EMPTY);
  const [deleting, setDeleting] = useState<TaxRateRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const openAdd = () => {
    setEditingId(undefined);
    setForm(EMPTY);
    setError(null);
    setDialogOpen(true);
  };
  const openEdit = (row: TaxRateRow) => {
    setEditingId(row.id);
    setForm({
      name: row.name,
      rate: row.rate,
      isReduced: row.isReduced,
      isInclusive: row.isInclusive,
      isDefault: row.isDefault,
    });
    setError(null);
    setDialogOpen(true);
  };

  const set = <K extends keyof TaxRateInput>(key: K, value: TaxRateInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = () => {
    setError(null);
    if (!form.name.trim()) {
      setError('税率名を入力してください');
      return;
    }
    startTransition(async () => {
      const result = await saveTaxRate({ ...form, id: editingId });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast(editingId ? '税率を更新しました' : '税率を追加しました');
      setDialogOpen(false);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4" />
          税率を追加
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="税率が登録されていません" description="「税率を追加」から登録してください" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>名前</Th>
                <Th>税率</Th>
                <Th>区分</Th>
                <Th>既定</Th>
                <Th className="text-right">操作</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium text-navy">{r.name}</Td>
                  <Td className="tabular-nums">{r.rate}%</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {r.isReduced && <Badge tone="warning">軽減税率</Badge>}
                      <Badge tone="gray">{r.isInclusive ? '内税' : '外税'}</Badge>
                    </div>
                  </Td>
                  <Td>{r.isDefault && <Badge tone="primary">既定</Badge>}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        aria-label="編集"
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(r)}
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
        <Dialog open onClose={() => setDialogOpen(false)} title={editingId ? '税率編集' : '税率追加'}>
          <div className="space-y-4">
            <div>
              <Label htmlFor="tax-name">税率名</Label>
              <Input id="tax-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="標準税率" />
            </div>
            <div>
              <Label htmlFor="tax-rate">税率（%）</Label>
              <Input
                id="tax-rate"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={form.rate}
                onChange={(e) => set('rate', Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="tax-inclusive">課税方式</Label>
              <Select
                id="tax-inclusive"
                value={form.isInclusive ? 'inclusive' : 'exclusive'}
                onChange={(e) => set('isInclusive', e.target.value === 'inclusive')}
              >
                <option value="inclusive">内税</option>
                <option value="exclusive">外税</option>
              </Select>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  checked={form.isReduced}
                  onChange={(e) => set('isReduced', e.target.checked)}
                />
                軽減税率
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  checked={form.isDefault}
                  onChange={(e) => set('isDefault', e.target.checked)}
                />
                既定の税率にする
              </label>
            </div>

            <FieldError message={error ?? undefined} />

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setDialogOpen(false)} disabled={pending}>
                キャンセル
              </Button>
              <Button onClick={handleSubmit} disabled={pending}>
                {pending ? '保存中…' : '保存する'}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title="税率を削除"
          message={`「${deleting.name}」を削除します。使用中の商品データは履歴として保持されます。`}
          confirmLabel="削除する"
          onConfirm={async () => {
            const result = await deleteTaxRate(deleting.id);
            if (result.error) {
              toast(result.error, 'error');
              return;
            }
            toast('税率を削除しました');
          }}
        />
      )}
    </div>
  );
}
