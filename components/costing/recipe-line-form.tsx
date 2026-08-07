'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { addRecipeLine, updateRecipeLine } from '@/app/app/costing/actions';

export interface IngredientOption {
  id: string;
  name: string;
  unit: string;
  avgCost: number | null;
}

export interface RecipeLineFormData {
  id: string;
  inventoryItemId: string;
  quantity: number;
  note: string | null;
}

/** レシピ食材行の「追加」/「編集」ダイアログ */
export function RecipeLineForm({
  menuItemId,
  ingredientOptions,
  line,
}: {
  menuItemId: string;
  ingredientOptions: IngredientOption[];
  line?: RecipeLineFormData;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  const isEdit = !!line;

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  const handleSubmit = async (formData: FormData) => {
    setError(null);
    const inventoryItemId = (formData.get('inventoryItemId') as string) ?? '';
    const quantity = Number(formData.get('quantity'));
    const note = ((formData.get('note') as string) || '').trim() || null;
    if (!inventoryItemId) {
      setError('食材を選択してください');
      return;
    }
    if (!(quantity > 0)) {
      setError('使用量は0より大きい値で入力してください');
      return;
    }

    setBusy(true);
    try {
      const result = isEdit
        ? await updateRecipeLine(line.id, { menuItemId, inventoryItemId, quantity, note })
        : await addRecipeLine({ menuItemId, inventoryItemId, quantity, note });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast(isEdit ? 'レシピを更新しました' : '食材を追加しました');
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {isEdit ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="行を編集"
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
        >
          <Pencil className="h-4 w-4" />
        </button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          食材を追加
        </Button>
      )}
      <Dialog open={open} onClose={close} title={isEdit ? '食材を編集' : '食材を追加'}>
        <form
          action={(fd) => {
            void handleSubmit(fd);
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="rl-ingredient">食材</Label>
            <Select id="rl-ingredient" name="inventoryItemId" defaultValue={line?.inventoryItemId ?? ''} required>
              <option value="">選択してください</option>
              {ingredientOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}（{o.unit}／{o.avgCost != null ? yen(o.avgCost) : '原価未設定'}）
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="rl-quantity">使用量（1商品あたり・品目の単位で入力）</Label>
            <Input
              id="rl-quantity"
              name="quantity"
              type="number"
              min={0}
              step="0.001"
              placeholder="例：鶏肉なら 200"
              defaultValue={line?.quantity ?? ''}
              required
            />
          </div>
          <div>
            <Label htmlFor="rl-note">メモ</Label>
            <Textarea id="rl-note" name="note" defaultValue={line?.note ?? ''} placeholder="例：下味込みの使用量" />
          </div>
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
