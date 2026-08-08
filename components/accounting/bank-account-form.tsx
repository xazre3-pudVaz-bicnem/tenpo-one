'use client';

import { useState, useTransition } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createBankAccount, updateBankAccount, type BankAccountInput } from '@/app/app/accounting/banks/actions';

export interface BankAccountOption {
  id: string;
  code: string;
  name: string;
}

const ACCOUNT_TYPE_LABELS: Record<BankAccountInput['accountType'], string> = {
  ordinary: '普通',
  checking: '当座',
  savings: '貯蓄',
};

export function BankAccountForm({
  mode,
  bankAccountId,
  initial,
  stores,
  accountOptions,
}: {
  mode: 'create' | 'edit';
  bankAccountId?: string;
  initial?: BankAccountInput;
  stores: { id: string; name: string }[];
  accountOptions: BankAccountOption[];
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<BankAccountInput>(
    initial ?? {
      storeId: null,
      bankName: '',
      branchName: null,
      accountType: 'ordinary',
      accountLast4: null,
      holderName: null,
      accountId: accountOptions[0]?.id ?? null,
    }
  );

  function close() {
    setOpen(false);
    if (mode === 'create') {
      setForm({ storeId: null, bankName: '', branchName: null, accountType: 'ordinary', accountLast4: null, holderName: null, accountId: accountOptions[0]?.id ?? null });
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (mode === 'create') {
          await createBankAccount(form);
          toast('銀行口座を登録しました');
        } else if (bankAccountId) {
          await updateBankAccount(bankAccountId, form);
          toast('更新しました');
        }
        close();
      } catch (err) {
        toast(err instanceof Error ? err.message : '保存に失敗しました', 'error');
      }
    });
  }

  return (
    <>
      <Button type="button" variant={mode === 'create' ? 'primary' : 'secondary'} size={mode === 'create' ? 'md' : 'sm'} onClick={() => setOpen(true)}>
        {mode === 'create' ? (
          <>
            <Plus className="h-4 w-4" /> 口座を追加
          </>
        ) : (
          <>
            <Pencil className="h-4 w-4" /> 編集
          </>
        )}
      </Button>
      <Dialog open={open} onClose={close} title={mode === 'create' ? '銀行口座を登録' : '銀行口座を編集'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {stores.length > 0 && (
            <div>
              <Label htmlFor="bank-store">店舗（任意・全社共通なら未選択）</Label>
              <Select
                id="bank-store"
                value={form.storeId ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, storeId: e.target.value || null }))}
              >
                <option value="">全社共通</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="bank-name">銀行名</Label>
            <Input id="bank-name" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} placeholder="例：〇〇銀行" />
          </div>
          <div>
            <Label htmlFor="bank-branch">支店名</Label>
            <Input id="bank-branch" value={form.branchName ?? ''} onChange={(e) => setForm((f) => ({ ...f, branchName: e.target.value || null }))} placeholder="例：本店" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bank-type">種別</Label>
              <Select id="bank-type" value={form.accountType} onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value as BankAccountInput['accountType'] }))}>
                {(Object.keys(ACCOUNT_TYPE_LABELS) as BankAccountInput['accountType'][]).map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="bank-last4">口座番号（末尾4桁のみ）</Label>
              <Input
                id="bank-last4"
                value={form.accountLast4 ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, accountLast4: e.target.value.replace(/\D/g, '').slice(0, 4) || null }))}
                placeholder="1234"
                inputMode="numeric"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="bank-holder">名義</Label>
            <Input id="bank-holder" value={form.holderName ?? ''} onChange={(e) => setForm((f) => ({ ...f, holderName: e.target.value || null }))} placeholder="カ）テンポワン" />
          </div>
          <div>
            <Label htmlFor="bank-account-id">対応する勘定科目</Label>
            {accountOptions.length === 0 ? (
              <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
                普通預金等（sub_type=bank）の勘定科目が見つかりません。自動仕訳ページから標準科目（普通預金 110）を導入するか、勘定科目を登録してください。
              </p>
            ) : (
              <Select id="bank-account-id" value={form.accountId ?? ''} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value || null }))}>
                <option value="">選択してください</option>
                {accountOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              キャンセル
            </Button>
            <Button type="submit" disabled={pending || !form.bankName.trim()}>
              {pending ? '保存中…' : '保存する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
