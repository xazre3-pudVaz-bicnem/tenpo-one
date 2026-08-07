'use client';

import { useMemo, useState, useTransition } from 'react';
import { Calculator } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { yen, todayJst } from '@/lib/format';
import { cn } from '@/lib/utils';
import { recordPettyCashCount } from '@/app/app/cash/actions';

/** 小口現金の実査（理論残高との突合）を記録するダイアログ */
export function PettyCashCountDialog({ storeId, expectedAmount }: { storeId: string; expectedAmount: number }) {
  const [open, setOpen] = useState(false);
  const [countDate, setCountDate] = useState(todayJst());
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const difference = useMemo(() => {
    const value = Number(counted);
    return Number.isFinite(value) ? value - expectedAmount : null;
  }, [counted, expectedAmount]);

  const close = () => {
    if (pending) return;
    setOpen(false);
    setCounted('');
    setNote('');
    setError(null);
    setCountDate(todayJst());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(counted);
    if (!Number.isInteger(value) || value < 0) {
      setError('実残高は0以上の整数で入力してください');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await recordPettyCashCount({
          storeId,
          countDate,
          expectedAmount,
          countedAmount: value,
          note: note.trim() || null,
        });
        toast('実査結果を保存しました');
        setOpen(false);
        setCounted('');
        setNote('');
      } catch (err) {
        setError(err instanceof Error ? err.message : '保存に失敗しました');
      }
    });
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Calculator className="h-4 w-4" />
        実残高を数える
      </Button>
      <Dialog open={open} onClose={close} title="小口現金の実査">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="count-date">実査日</Label>
            <Input id="count-date" type="date" value={countDate} onChange={(e) => setCountDate(e.target.value)} />
          </div>

          <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
            <p className="text-xs text-gray-500">理論残高</p>
            <p className="text-lg font-bold tabular-nums text-navy">{yen(expectedAmount)}</p>
          </div>

          <div>
            <Label htmlFor="count-amount">実残高（数えた金額）</Label>
            <Input
              id="count-amount"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              placeholder="0"
            />
          </div>

          {difference !== null && counted !== '' && (
            <p className={cn('text-sm font-semibold', difference === 0 ? 'text-success' : 'text-danger')}>
              差異: {difference > 0 ? '+' : ''}
              {yen(difference)}
              {difference !== 0 && '（原因をメモに記録してください）'}
            </p>
          )}

          <div>
            <Label htmlFor="count-note">メモ（任意）</Label>
            <Textarea id="count-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="差異の原因など" />
          </div>

          <FieldError message={error ?? undefined} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              キャンセル
            </Button>
            <Button type="submit" disabled={pending || counted === ''}>
              {pending ? '保存中…' : '保存する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
