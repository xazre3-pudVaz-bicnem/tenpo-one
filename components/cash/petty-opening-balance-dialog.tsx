'use client';

import { useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { updatePettyOpeningBalance } from '@/app/app/cash/actions';

/** 小口現金の開始残高を編集するダイアログ（cash.approve権限者のみ表示） */
export function PettyOpeningBalanceDialog({ storeId, currentAmount }: { storeId: string; currentAmount: number }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(currentAmount));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const close = () => {
    if (pending) return;
    setOpen(false);
    setAmount(String(currentAmount));
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isInteger(value) || value < 0) {
      setError('開始残高は0以上の整数で入力してください');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await updatePettyOpeningBalance(storeId, value);
        toast('開始残高を更新しました');
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : '更新に失敗しました');
      }
    });
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" />
        開始残高を編集
      </Button>
      <Dialog open={open} onClose={close} title="小口現金の開始残高を編集">
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-gray-600">
            理論残高の起点となる金額です。運用開始時の手元現金や、実査で確定した金額に合わせて調整してください。
          </p>
          <div>
            <Label htmlFor="opening-balance">開始残高（円）</Label>
            <Input
              id="opening-balance"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              キャンセル
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? '保存中…' : '保存する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
