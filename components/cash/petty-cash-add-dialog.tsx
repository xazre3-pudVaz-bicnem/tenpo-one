'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { yen, formatDate } from '@/lib/format';
import { addPettyCash } from '@/app/app/cash/actions';
import { KIND_LABELS } from '@/components/cash/labels';

type PettyKind = 'petty_in' | 'petty_out' | 'petty_advance' | 'petty_settlement';

interface AdvanceOption {
  id: string;
  purpose: string | null;
  amount: number;
  businessDate: string;
}

export function PettyCashAddDialog({
  storeId,
  accounts,
  advances,
}: {
  storeId: string;
  accounts: { id: string; name: string }[];
  /** 承認済みの立替（petty_advance）一覧。精算時にメモへ引用する目的の参考リスト（厳密な消込は行わない） */
  advances: AdvanceOption[];
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PettyKind>('petty_out');
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [staffName, setStaffName] = useState('');
  const [advanceRef, setAdvanceRef] = useState('');
  const [accountId, setAccountId] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const close = () => {
    setOpen(false);
    setAmount('');
    setPurpose('');
    setStaffName('');
    setAdvanceRef('');
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
    if (kind === 'petty_advance' && !staffName.trim()) {
      toast('立替者名を入力してください', 'error');
      return;
    }
    if (!purpose.trim() && kind !== 'petty_advance') {
      toast('用途・メモを入力してください', 'error');
      return;
    }

    let finalPurpose = purpose.trim();
    if (kind === 'petty_advance') {
      finalPurpose = `[立替:${staffName.trim()}]${purpose.trim() ? ` ${purpose.trim()}` : ''}`;
    } else if (kind === 'petty_settlement') {
      const selected = advances.find((a) => a.id === advanceRef);
      if (selected) {
        finalPurpose = `[精算対象: ${selected.purpose ?? '立替'}（${formatDate(selected.businessDate)}・${yen(selected.amount)}）] ${finalPurpose}`;
      }
    }
    if (!finalPurpose.trim()) {
      toast('用途・メモを入力してください', 'error');
      return;
    }

    startTransition(async () => {
      try {
        await addPettyCash({ storeId, kind, amount: value, purpose: finalPurpose, expenseAccountId: accountId || null });
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
            <Select id="petty-kind" value={kind} onChange={(e) => setKind(e.target.value as PettyKind)}>
              <option value="petty_out">{KIND_LABELS.petty_out}</option>
              <option value="petty_in">{KIND_LABELS.petty_in}</option>
              <option value="petty_advance">{KIND_LABELS.petty_advance}（スタッフの立替）</option>
              <option value="petty_settlement">{KIND_LABELS.petty_settlement}（立替の払い戻し）</option>
            </Select>
          </div>

          {kind === 'petty_advance' && (
            <p className="rounded-lg bg-primary-soft px-3 py-2 text-xs text-primary-deep">
              立替はスタッフが個人で立て替えた支出の記録です。この登録では店舗の現金は動きません（残高計算には含まれません）。後日「精算」で払い戻す際に現金が減ります。
            </p>
          )}
          {kind === 'petty_settlement' && (
            <p className="rounded-lg bg-primary-soft px-3 py-2 text-xs text-primary-deep">
              精算はスタッフへの立替払い戻しです。この登録で小口現金が減ります。
            </p>
          )}

          {kind === 'petty_advance' && (
            <div>
              <Label htmlFor="petty-staff">立替者名</Label>
              <Input id="petty-staff" value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="例：山田太郎" />
            </div>
          )}

          {kind === 'petty_settlement' && advances.length > 0 && (
            <div>
              <Label htmlFor="petty-advance-ref">対象の立替（任意）</Label>
              <Select id="petty-advance-ref" value={advanceRef} onChange={(e) => setAdvanceRef(e.target.value)}>
                <option value="">選択しない</option>
                {advances.map((a) => (
                  <option key={a.id} value={a.id}>
                    {formatDate(a.businessDate)}・{yen(a.amount)}・{a.purpose ?? ''}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="petty-amount">金額</Label>
            <Input id="petty-amount" type="number" inputMode="numeric" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" />
          </div>
          <div>
            <Label htmlFor="petty-purpose">{kind === 'petty_advance' ? '内容（任意）' : '用途・メモ'}</Label>
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
