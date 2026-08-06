'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createItem } from '@/app/app/inventory/actions';
import { ITEM_KIND_LABELS, ITEM_KIND_OPTIONS, type ItemKind } from './labels';

/** 「品目を追加」ダイアログ */
export function ItemForm({ storeId }: { storeId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

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
      await createItem({
        storeId,
        name: name.trim(),
        itemKind: formData.get('itemKind') as ItemKind,
        category: (formData.get('category') as string) || null,
        unit: (formData.get('unit') as string) || '個',
        initialQuantity: Number(formData.get('initialQuantity') ?? 0),
        reorderPoint: formData.get('reorderPoint') ? Number(formData.get('reorderPoint')) : null,
        avgCost: formData.get('avgCost') ? Number(formData.get('avgCost')) : null,
      });
      toast('品目を追加しました');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        品目を追加
      </Button>
      <Dialog open={open} onClose={close} title="品目を追加">
        <form
          action={(fd) => {
            void handleSubmit(fd);
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="it-name">名前</Label>
            <Input id="it-name" name="name" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="it-kind">種別</Label>
              <Select id="it-kind" name="itemKind" defaultValue="ingredient">
                {ITEM_KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {ITEM_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="it-category">カテゴリ</Label>
              <Input id="it-category" name="category" />
            </div>
            <div>
              <Label htmlFor="it-unit">単位</Label>
              <Input id="it-unit" name="unit" defaultValue="個" />
            </div>
            <div>
              <Label htmlFor="it-qty">初期数量</Label>
              <Input id="it-qty" name="initialQuantity" type="number" min={0} step="0.01" defaultValue={0} />
            </div>
            <div>
              <Label htmlFor="it-reorder">発注点</Label>
              <Input id="it-reorder" name="reorderPoint" type="number" min={0} step="0.01" />
            </div>
            <div>
              <Label htmlFor="it-cost">平均原価（円）</Label>
              <Input id="it-cost" name="avgCost" type="number" min={0} step="1" />
            </div>
          </div>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              キャンセル
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '追加中…' : '追加する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
