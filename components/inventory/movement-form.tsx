'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { addMovement } from '@/app/app/inventory/actions';
import { MANUAL_MOVEMENT_OPTIONS, MOVEMENT_TYPE_LABELS, type ManualMovementType } from './labels';

/** 入出庫登録ダイアログ（in=入庫、out/waste/count_adjust=在庫減） */
export function MovementForm({ item }: { item: { id: string; name: string; unit: string } }) {
  const [open, setOpen] = useState(false);
  const [movementType, setMovementType] = useState<ManualMovementType>('in');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const needsReason = movementType === 'waste' || movementType === 'count_adjust';

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  const handleSubmit = async (formData: FormData) => {
    setError(null);
    const quantity = Number(formData.get('quantity'));
    const reason = (formData.get('reason') as string) || null;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('数量を正しく入力してください');
      return;
    }
    if (needsReason && !reason?.trim()) {
      setError('理由を入力してください');
      return;
    }
    setBusy(true);
    try {
      await addMovement({ itemId: item.id, movementType, quantity, reason });
      toast('在庫を更新しました');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        入出庫
      </Button>
      <Dialog open={open} onClose={close} title={`入出庫：${item.name}`}>
        <form
          action={(fd) => {
            void handleSubmit(fd);
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="mv-type">種別</Label>
            <Select
              id="mv-type"
              value={movementType}
              onChange={(e) => setMovementType(e.target.value as ManualMovementType)}
            >
              {MANUAL_MOVEMENT_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {MOVEMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="mv-qty">数量（{item.unit}）</Label>
            <Input id="mv-qty" name="quantity" type="number" min={0} step="0.01" required />
          </div>
          <div>
            <Label htmlFor="mv-reason">理由{needsReason ? '（必須）' : '（任意）'}</Label>
            <Textarea id="mv-reason" name="reason" />
          </div>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              キャンセル
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '更新中…' : '登録する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
