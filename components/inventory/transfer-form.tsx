'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { transferStock } from '@/app/app/inventory/actions';

interface StoreOption {
  id: string;
  name: string;
}

/** 店舗間移動ダイアログ。rpc apply_stock_transfer を使う（受け側の同名品目がなければ自動作成される） */
export function TransferForm({
  item,
  stores,
}: {
  item: { id: string; name: string; unit: string; currentQuantity: number };
  stores: StoreOption[];
}) {
  const [open, setOpen] = useState(false);
  const [toStoreId, setToStoreId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
    setToStoreId('');
  };

  const handleSubmit = async (formData: FormData) => {
    setError(null);
    const quantity = Number(formData.get('quantity'));
    const reason = (formData.get('reason') as string) || null;
    if (!toStoreId) {
      setError('移動先店舗を選択してください');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('数量を正しく入力してください');
      return;
    }
    if (quantity > item.currentQuantity) {
      setError('現在庫を超える数量は移動できません');
      return;
    }
    setBusy(true);
    try {
      await transferStock({ fromItemId: item.id, toStoreId, quantity, reason });
      toast('店舗間移動を登録しました');
      close();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '移動の登録に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  if (stores.length === 0) return null;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <ArrowLeftRight className="h-3.5 w-3.5" />
        移動
      </Button>
      <Dialog open={open} onClose={close} title={`店舗間移動：${item.name}`}>
        <form
          action={(fd) => {
            void handleSubmit(fd);
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="tr-store">移動先店舗</Label>
            <Select id="tr-store" value={toStoreId} onChange={(e) => setToStoreId(e.target.value)}>
              <option value="">選択してください</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="tr-qty">
              数量（{item.unit}／現在庫 {item.currentQuantity}
              {item.unit}）
            </Label>
            <Input id="tr-qty" name="quantity" type="number" min={0} max={item.currentQuantity} step="0.01" required />
          </div>
          <div>
            <Label htmlFor="tr-reason">理由（任意）</Label>
            <Textarea id="tr-reason" name="reason" />
          </div>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              キャンセル
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '登録中…' : '移動する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
