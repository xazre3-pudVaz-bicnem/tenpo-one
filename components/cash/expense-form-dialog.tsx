'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { todayJst } from '@/lib/format';
import { addExpense, seedExpenseAccounts } from '@/app/app/expenses/actions';
import { PAID_VIA_LABELS, type PaidVia } from '@/components/cash/labels';

export function ExpenseFormDialog({
  storeId,
  accounts,
  canSeedAccounts,
}: {
  storeId: string;
  accounts: { id: string; name: string }[];
  canSeedAccounts: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [taxAmount, setTaxAmount] = useState('0');
  const [paidVia, setPaidVia] = useState<PaidVia>('petty_cash');
  const [vendorName, setVendorName] = useState('');
  const [memo, setMemo] = useState('');
  const [businessDate, setBusinessDate] = useState(todayJst());
  const [pending, startTransition] = useTransition();
  const [seeding, startSeeding] = useTransition();
  const { toast } = useToast();

  const close = () => {
    setOpen(false);
    setAmount('');
    setTaxAmount('0');
    setPaidVia('petty_cash');
    setVendorName('');
    setMemo('');
    setBusinessDate(todayJst());
  };

  const handleSeed = () => {
    startSeeding(async () => {
      try {
        await seedExpenseAccounts();
        toast('初期科目を作成しました');
      } catch (err) {
        toast(err instanceof Error ? err.message : '科目の作成に失敗しました', 'error');
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountValue = Number(amount);
    const taxValue = Number(taxAmount || '0');
    if (!accountId) {
      toast('勘定科目を選択してください', 'error');
      return;
    }
    if (!Number.isInteger(amountValue) || amountValue <= 0) {
      toast('金額は1円以上の整数で入力してください', 'error');
      return;
    }
    if (!Number.isInteger(taxValue) || taxValue < 0) {
      toast('税額は0以上の整数で入力してください', 'error');
      return;
    }
    if (!businessDate) {
      toast('営業日を入力してください', 'error');
      return;
    }
    startTransition(async () => {
      try {
        await addExpense({
          storeId,
          expenseAccountId: accountId,
          amount: amountValue,
          taxAmount: taxValue,
          paidVia,
          vendorName,
          memo,
          businessDate,
        });
        toast('経費を登録しました（承認待ち）');
        close();
      } catch (err) {
        toast(err instanceof Error ? err.message : '登録に失敗しました', 'error');
      }
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>経費を登録</Button>
      <Dialog open={open} onClose={close} title="経費を登録">
        {accounts.length === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              勘定科目がまだ登録されていません。経費を登録する前に科目を作成してください。
            </p>
            {canSeedAccounts ? (
              <Button onClick={handleSeed} disabled={seeding}>
                {seeding ? '作成中…' : '初期科目を作成（食材費・消耗品費・水道光熱費・修繕費・雑費）'}
              </Button>
            ) : (
              <p className="text-xs text-gray-500">科目の作成には店長以上の権限が必要です。管理者に依頼してください。</p>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="exp-account">勘定科目</Label>
              <Select id="exp-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="exp-amount">金額</Label>
                <Input id="exp-amount" type="number" inputMode="numeric" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" />
              </div>
              <div>
                <Label htmlFor="exp-tax">税額</Label>
                <Input id="exp-tax" type="number" inputMode="numeric" min={0} step={1} value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div>
              <Label htmlFor="exp-paid-via">支払元</Label>
              <Select id="exp-paid-via" value={paidVia} onChange={(e) => setPaidVia(e.target.value as PaidVia)}>
                {(Object.keys(PAID_VIA_LABELS) as PaidVia[]).map((k) => (
                  <option key={k} value={k}>
                    {PAID_VIA_LABELS[k]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="exp-vendor">支払先名</Label>
              <Input id="exp-vendor" value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="例：〇〇商店" />
            </div>
            <div>
              <Label htmlFor="exp-memo">メモ</Label>
              <Textarea id="exp-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="任意" />
            </div>
            <div>
              <Label htmlFor="exp-date">営業日</Label>
              <Input id="exp-date" type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
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
        )}
      </Dialog>
    </>
  );
}
