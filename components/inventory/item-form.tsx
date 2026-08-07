'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { createItem, updateItem } from '@/app/app/inventory/actions';
import { ITEM_KIND_LABELS, ITEM_KIND_OPTIONS, type ItemKind } from './labels';

export interface ItemFormData {
  id: string;
  name: string;
  itemKind: ItemKind;
  category: string | null;
  unit: string;
  reorderPoint: number | null;
  minQuantity: number | null;
  optimalQuantity: number | null;
  avgCost: number | null;
}

/** 「品目を追加」/「品目を編集」ダイアログ。itemを渡すと編集モード（数量・原価は入出庫/入荷から更新するため編集不可） */
export function ItemForm({ storeId, item }: { storeId?: string; item?: ItemFormData }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  const isEdit = !!item;

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  const handleSubmit = async (formData: FormData) => {
    setError(null);
    const name = (formData.get('name') as string) ?? '';
    if (!name.trim()) {
      setError('名前を入力してください');
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        await updateItem(item.id, {
          name: name.trim(),
          itemKind: formData.get('itemKind') as ItemKind,
          category: (formData.get('category') as string) || null,
          unit: (formData.get('unit') as string) || '個',
          reorderPoint: formData.get('reorderPoint') ? Number(formData.get('reorderPoint')) : null,
          minQuantity: formData.get('minQuantity') ? Number(formData.get('minQuantity')) : null,
          optimalQuantity: formData.get('optimalQuantity') ? Number(formData.get('optimalQuantity')) : null,
        });
        toast('品目を更新しました');
      } else {
        await createItem({
          storeId: storeId!,
          name: name.trim(),
          itemKind: formData.get('itemKind') as ItemKind,
          category: (formData.get('category') as string) || null,
          unit: (formData.get('unit') as string) || '個',
          initialQuantity: Number(formData.get('initialQuantity') ?? 0),
          reorderPoint: formData.get('reorderPoint') ? Number(formData.get('reorderPoint')) : null,
          minQuantity: formData.get('minQuantity') ? Number(formData.get('minQuantity')) : null,
          optimalQuantity: formData.get('optimalQuantity') ? Number(formData.get('optimalQuantity')) : null,
          avgCost: formData.get('avgCost') ? Number(formData.get('avgCost')) : null,
        });
        toast('品目を追加しました');
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {isEdit ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label="品目を編集">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          品目を追加
        </Button>
      )}
      <Dialog open={open} onClose={close} title={isEdit ? `品目を編集：${item.name}` : '品目を追加'}>
        <form
          action={(fd) => {
            void handleSubmit(fd);
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="it-name">名前</Label>
            <Input id="it-name" name="name" required defaultValue={item?.name} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="it-kind">種別</Label>
              <Select id="it-kind" name="itemKind" defaultValue={item?.itemKind ?? 'ingredient'}>
                {ITEM_KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {ITEM_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="it-category">カテゴリ</Label>
              <Input id="it-category" name="category" defaultValue={item?.category ?? ''} />
            </div>
            <div>
              <Label htmlFor="it-unit">単位</Label>
              <Input id="it-unit" name="unit" defaultValue={item?.unit ?? '個'} />
            </div>
            {!isEdit && (
              <div>
                <Label htmlFor="it-qty">初期数量</Label>
                <Input id="it-qty" name="initialQuantity" type="number" min={0} step="0.01" defaultValue={0} />
              </div>
            )}
            <div>
              <Label htmlFor="it-reorder">発注点</Label>
              <Input
                id="it-reorder"
                name="reorderPoint"
                type="number"
                min={0}
                step="0.01"
                defaultValue={item?.reorderPoint ?? ''}
              />
            </div>
            <div>
              <Label htmlFor="it-min">最低在庫</Label>
              <Input
                id="it-min"
                name="minQuantity"
                type="number"
                min={0}
                step="0.01"
                defaultValue={item?.minQuantity ?? ''}
              />
            </div>
            <div>
              <Label htmlFor="it-optimal">適正在庫</Label>
              <Input
                id="it-optimal"
                name="optimalQuantity"
                type="number"
                min={0}
                step="0.01"
                defaultValue={item?.optimalQuantity ?? ''}
              />
            </div>
            {!isEdit && (
              <div>
                <Label htmlFor="it-cost">平均原価（円）</Label>
                <Input id="it-cost" name="avgCost" type="number" min={0} step="1" />
              </div>
            )}
          </div>
          {isEdit && (
            <p className="text-xs text-gray-500">
              現在の平均仕入単価: {yen(item.avgCost)}（数量・単価は入出庫・入荷・移動から更新されます）
            </p>
          )}
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              キャンセル
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '保存中…' : isEdit ? '更新する' : '追加する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
