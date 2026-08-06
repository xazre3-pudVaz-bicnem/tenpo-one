'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { addPettyCash } from '@/app/app/cash/actions';
import { KIND_LABELS } from '@/components/cash/labels';

export function PettyCashAddDialog({
  storeId,
  accounts,
}: {
  storeId: string;
  accounts: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'petty_in' | 'petty_out'>('petty_out');
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [accountId, setAccountId] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const close = () => {
    setOpen(false);
    setAmount('');
    setPurpose('');
    setAccountId('');
    setKind('petty_out');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isInteger(value) || value <= 0) {
      toast('金額は1円以上の整数で入力してください', 'error');
      return;
    }
    if (!purpose.trim()) {
      toast('用途を入力してください', 'error');
      return;
    }
    startTransition(async () => {
      try {
        await addPettyCash({ storeId, kind, amount: value, purpose, expenseAccountId: accountId || null });
        toast('登録しました（承認待ち）');
        close();
      } catch (err) {
        toast(err instanceof Error ? err.message : '登録に失敗しました', 'error');
      }
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>入出金を登録</Button>
      <Dialog open={open} onClose={close} title="小口現金の入出金を登録">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="petty-kind">区分</Label>
            <Select id="petty-kind" value={kind} onChange={(e) => setKind(e.target.value as 'petty_in' | 'petty_out')}>
              <option value="petty_out">{KIND_LABELS.petty_out}</option>
              <option value="petty_in">{KIND_LABELS.petty_in}</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="petty-amount">金額</Label>
            <Input id="petty-amount" type="number" inputMode="numeric" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" />
          </div>
          <div>
            <Label htmlFor="petty-purpose">用途</Label>
            <Input id="petty-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例：文房具購入" />
          </div>
          <div>
            <Label htmlFor="petty-account">勘定科目（任意）</Label>
            <Select id="petty-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">選択しない</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end gap-2">
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
