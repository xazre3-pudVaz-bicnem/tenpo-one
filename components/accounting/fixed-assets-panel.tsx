'use client';

import { useState, useTransition } from 'react';
import { Plus, Pencil, Trash2, PackageMinus, PackageCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/input';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { yen, formatDate, todayJst } from '@/lib/format';
import {
  ASSET_STATUS_LABELS, ASSET_STATUS_TONES, DEPRECIATION_METHOD_LABELS, DEPRECIATION_METHOD_OPTIONS,
  type AssetStatus, type DepreciationMethod,
} from '@/components/accounting/labels';
import { saveFixedAsset, changeFixedAssetStatus, deleteFixedAsset, type FixedAssetInput } from '@/app/app/accounting/assets/actions';

export interface AssetRow {
  id: string;
  name: string;
  acquiredOn: string;
  acquisitionCost: number;
  usefulLifeYears: number | null;
  depreciationMethod: DepreciationMethod;
  storeId: string | null;
  storeName: string | null;
  status: AssetStatus;
  disposedOn: string | null;
  note: string | null;
}

export interface StoreOption {
  id: string;
  name: string;
}

const EMPTY: FixedAssetInput = {
  name: '',
  acquiredOn: todayJst(),
  acquisitionCost: 0,
  usefulLifeYears: null,
  depreciationMethod: 'straight_line',
  storeId: null,
  note: null,
};

export function FixedAssetsPanel({ initial, stores }: { initial: AssetRow[]; stores: StoreOption[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AssetRow | null>(null);
  const [form, setForm] = useState<FixedAssetInput>(EMPTY);
  const [deleting, setDeleting] = useState<AssetRow | null>(null);
  const [disposing, setDisposing] = useState<{ row: AssetRow; status: 'disposed' | 'sold' } | null>(null);
  const [disposedOn, setDisposedOn] = useState(todayJst());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY);
    setError(null);
    setDialogOpen(true);
  };
  const openEdit = (row: AssetRow) => {
    setEditing(row);
    setForm({
      name: row.name,
      acquiredOn: row.acquiredOn,
      acquisitionCost: row.acquisitionCost,
      usefulLifeYears: row.usefulLifeYears,
      depreciationMethod: row.depreciationMethod,
      storeId: row.storeId,
      note: row.note,
    });
    setError(null);
    setDialogOpen(true);
  };

  const set = <K extends keyof FixedAssetInput>(key: K, value: FixedAssetInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = () => {
    setError(null);
    if (!form.name.trim()) {
      setError('名称を入力してください');
      return;
    }
    startTransition(async () => {
      const result = await saveFixedAsset({ ...form, id: editing?.id });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast(editing ? '固定資産を更新しました' : '固定資産を登録しました');
      setDialogOpen(false);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4" />
          固定資産を登録
        </Button>
      </div>

      {initial.length === 0 ? (
        <EmptyState title="固定資産が登録されていません" description="「固定資産を登録」から取得した資産を登録してください" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>名称</Th>
                <Th>取得日</Th>
                <Th className="text-right">取得価額</Th>
                <Th>耐用年数</Th>
                <Th>償却方法</Th>
                <Th>店舗</Th>
                <Th>状態</Th>
                <Th className="text-right">操作</Th>
              </Tr>
            </THead>
            <TBody>
              {initial.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium text-navy">{r.name}</Td>
                  <Td className="whitespace-nowrap text-xs text-gray-500">{formatDate(r.acquiredOn)}</Td>
                  <Td className="text-right tabular-nums">{yen(r.acquisitionCost)}</Td>
                  <Td>{r.usefulLifeYears ? `${r.usefulLifeYears}年` : '—'}</Td>
                  <Td>{DEPRECIATION_METHOD_LABELS[r.depreciationMethod]}</Td>
                  <Td>{r.storeName ?? '全社'}</Td>
                  <Td>
                    <Badge tone={ASSET_STATUS_TONES[r.status]}>{ASSET_STATUS_LABELS[r.status]}</Badge>
                    {r.disposedOn && <span className="ml-1 text-[11px] text-gray-400">{formatDate(r.disposedOn)}</span>}
                  </Td>
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
                      {r.status === 'in_use' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setDisposedOn(todayJst());
                            setDisposing({ row: r, status: 'disposed' });
                          }}
                          aria-label="除却・売却"
                          title="除却・売却"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-warning-soft hover:text-warning"
                        >
                          <PackageMinus className="h-4 w-4" />
                        </button>
                      ) : (
                        r.status !== 'deleted' && (
                          <button
                            type="button"
                            onClick={async () => {
                              const result = await changeFixedAssetStatus(r.id, 'in_use', null);
                              if (result.error) toast(result.error, 'error');
                              else toast('使用中に戻しました');
                            }}
                            aria-label="使用中に戻す"
                            title="使用中に戻す"
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-success-soft hover:text-success"
                          >
                            <PackageCheck className="h-4 w-4" />
                          </button>
                        )
                      )}
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
        <Dialog open onClose={() => setDialogOpen(false)} title={editing ? '固定資産を編集' : '固定資産を登録'}>
          <div className="space-y-4">
            <div>
              <Label htmlFor="fa-name">名称</Label>
              <Input id="fa-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="厨房機器一式" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="fa-acquired">取得日</Label>
                <Input id="fa-acquired" type="date" value={form.acquiredOn} onChange={(e) => set('acquiredOn', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="fa-cost">取得価額</Label>
                <Input
                  id="fa-cost"
                  type="number"
                  min={0}
                  value={form.acquisitionCost}
                  onChange={(e) => set('acquisitionCost', Number(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="fa-life">耐用年数（任意）</Label>
                <Input
                  id="fa-life"
                  type="number"
                  min={0}
                  value={form.usefulLifeYears ?? ''}
                  onChange={(e) => set('usefulLifeYears', e.target.value ? Number(e.target.value) : null)}
                />
              </div>
              <div>
                <Label htmlFor="fa-method">償却方法</Label>
                <Select
                  id="fa-method"
                  value={form.depreciationMethod}
                  onChange={(e) => set('depreciationMethod', e.target.value as DepreciationMethod)}
                >
                  {DEPRECIATION_METHOD_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {DEPRECIATION_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-2">
                <Label htmlFor="fa-store">店舗（任意）</Label>
                <Select id="fa-store" value={form.storeId ?? ''} onChange={(e) => set('storeId', e.target.value || null)}>
                  <option value="">全社（店舗指定なし）</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="fa-note">メモ</Label>
              <Textarea id="fa-note" value={form.note ?? ''} onChange={(e) => set('note', e.target.value || null)} />
            </div>

            <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              減価償却の自動計算は償却ルールの専門家確認後に対応予定です（ルールversion方式で設計済み）。現時点では台帳としての登録・管理のみ行えます。
            </p>

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

      {disposing && (
        <Dialog open onClose={() => setDisposing(null)} title="除却・売却の登録">
          <div className="space-y-4">
            <p className="text-sm text-gray-700">「{disposing.row.name}」の状態を変更します。</p>
            <div>
              <Label htmlFor="dispose-status">区分</Label>
              <Select
                id="dispose-status"
                value={disposing.status}
                onChange={(e) => setDisposing({ row: disposing.row, status: e.target.value as 'disposed' | 'sold' })}
              >
                <option value="disposed">除却</option>
                <option value="sold">売却</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="dispose-date">{disposing.status === 'sold' ? '売却日' : '除却日'}</Label>
              <Input id="dispose-date" type="date" value={disposedOn} onChange={(e) => setDisposedOn(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setDisposing(null)}>
                キャンセル
              </Button>
              <Button
                onClick={async () => {
                  const result = await changeFixedAssetStatus(disposing.row.id, disposing.status, disposedOn);
                  if (result.error) {
                    toast(result.error, 'error');
                    return;
                  }
                  toast(disposing.status === 'sold' ? '売却を登録しました' : '除却を登録しました');
                  setDisposing(null);
                }}
              >
                登録する
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title="固定資産を削除"
          message={`「${deleting.name}」を削除します。`}
          confirmLabel="削除する"
          onConfirm={async () => {
            const result = await deleteFixedAsset(deleting.id);
            if (result.error) {
              toast(result.error, 'error');
              return;
            }
            toast('固定資産を削除しました');
          }}
        />
      )}
    </div>
  );
}
