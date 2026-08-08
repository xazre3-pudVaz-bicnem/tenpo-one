'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { todayJst } from '@/lib/format';
import { addManualBankTransaction } from '@/app/app/accounting/banks/actions';

type Direction = 'deposit' | 'withdrawal';

export function BankManualTxForm({ bankAccountId }: { bankAccountId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayJst());
  const [description, setDescription] = useState('');
  const [direction, setDirection] = useState<Direction>('deposit');
  const [amount, setAmount] = useState('');
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setDate(todayJst());
    setDescription('');
    setDirection('deposit');
    setAmount('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isInteger(value) || value <= 0) {
      toast('金額は1円以上の整数で入力してください', 'error');
      return;
    }
    if (!description.trim()) {
      toast('摘要を入力してください', 'error');
      return;
    }
    startTransition(async () => {
      try {
        await addManualBankTransaction(bankAccountId, {
          date,
          description: description.trim(),
          deposit: direction === 'deposit' ? value : 0,
          withdrawal: direction === 'withdrawal' ? value : 0,
        });
        toast('取引を登録しました');
        close();
        router.refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : '登録に失敗しました', 'error');
      }
    });
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> 手入力で追加
      </Button>
      <Dialog open={open} onClose={close} title="取引を手入力">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="tx-date">日付</Label>
            <Input id="tx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="tx-desc">摘要</Label>
            <Input id="tx-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="例：家賃振込" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tx-direction">区分</Label>
              <Select id="tx-direction" value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
                <option value="deposit">入金</option>
                <option value="withdrawal">出金</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="tx-amount">金額</Label>
              <Input id="tx-amount" type="number" inputMode="numeric" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              キャンセル
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? '登録中…' : '登録する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
