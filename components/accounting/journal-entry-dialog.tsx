'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { yen, todayJst } from '@/lib/format';
import { validateJournalBalance, TAX_TREATMENT_LABELS, type TaxTreatment } from '@/lib/accounting';
import { createDraftEntry, updateDraftEntry, type JournalEntryInput, type JournalLineInput } from '@/app/app/accounting/actions';

export interface AccountOption {
  id: string;
  code: string;
  name: string;
  defaultTaxTreatment: TaxTreatment;
}

export interface StoreOption {
  id: string;
  name: string;
}

export interface EditingEntry {
  id: string;
  entryDate: string;
  description: string;
  storeId: string | null;
  lines: JournalLineInput[];
}

interface LineDraft {
  key: string;
  accountId: string;
  side: 'debit' | 'credit';
  amount: string;
  taxTreatment: TaxTreatment;
  memo: string;
}

let seq = 0;
function newLine(overrides?: Partial<LineDraft>): LineDraft {
  seq += 1;
  return { key: `l${seq}`, accountId: '', side: 'debit', amount: '', taxTreatment: 'out_of_scope', memo: '', ...overrides };
}

/** 仕訳の下書き作成・編集ダイアログ。借方合計/貸方合計/差額をリアルタイム表示し、差額0のときのみ保存できる */
export function JournalEntryDialog({
  open,
  onClose,
  accounts,
  stores,
  entry,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  accounts: AccountOption[];
  stores: StoreOption[];
  /** 未指定なら新規作成 */
  entry?: EditingEntry;
  onSaved?: () => void;
}) {
  const [entryDate, setEntryDate] = useState(entry?.entryDate ?? todayJst());
  const [description, setDescription] = useState(entry?.description ?? '');
  const [storeId, setStoreId] = useState(entry?.storeId ?? '');
  const [lines, setLines] = useState<LineDraft[]>(() =>
    entry && entry.lines.length > 0
      ? entry.lines.map((l) =>
          newLine({ accountId: l.accountId, side: l.side, amount: String(l.amount), taxTreatment: l.taxTreatment, memo: l.memo ?? '' })
        )
      : [newLine({ side: 'debit' }), newLine({ side: 'credit' })]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const balance = useMemo(
    () => validateJournalBalance(lines.filter((l) => l.accountId).map((l) => ({ side: l.side, amount: Math.round(Number(l.amount) || 0) }))),
    [lines]
  );
  const validLineCount = lines.filter((l) => l.accountId && Number(l.amount) > 0).length;
  const canSave = balance.balanced && validLineCount >= 2 && description.trim().length > 0;

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const selectAccount = (key: string, accountId: string) => {
    const acc = accountById.get(accountId);
    updateLine(key, { accountId, taxTreatment: acc?.defaultTaxTreatment ?? 'out_of_scope' });
  };

  const handleSubmit = async () => {
    setError(null);
    if (!description.trim()) {
      setError('摘要を入力してください');
      return;
    }
    if (!canSave) {
      setError('借方合計と貸方合計を一致させてください（差額0で保存できます）');
      return;
    }
    const input: JournalEntryInput = {
      entryDate,
      description: description.trim(),
      storeId: storeId || null,
      lines: lines
        .filter((l) => l.accountId && Number(l.amount) > 0)
        .map<JournalLineInput>((l) => ({
          accountId: l.accountId,
          side: l.side,
          amount: Math.round(Number(l.amount)),
          taxTreatment: l.taxTreatment,
          memo: l.memo.trim() || null,
        })),
    };

    setBusy(true);
    try {
      const result = entry ? await updateDraftEntry(entry.id, input) : await createDraftEntry(input);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast(entry ? '仕訳（下書き）を更新しました' : '仕訳を下書き保存しました');
      onSaved?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={entry ? '仕訳を編集（下書き）' : '仕訳を作成（下書き）'} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="je-date">日付</Label>
            <Input id="je-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="je-store">店舗（任意）</Label>
            <Select id="je-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">全社（店舗指定なし）</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Label htmlFor="je-desc">摘要</Label>
            <Input id="je-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="例: 4月分家賃支払い" />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="mb-0">明細</Label>
            <Button type="button" size="sm" variant="secondary" onClick={() => setLines((p) => [...p, newLine()])}>
              <Plus className="h-3.5 w-3.5" />
              行を追加
            </Button>
          </div>
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.key} className="grid grid-cols-12 items-end gap-2 rounded-lg border border-gray-200 p-2">
                <div className="col-span-4">
                  <Label className="text-[11px]">勘定科目</Label>
                  <Select value={l.accountId} onChange={(e) => selectAccount(l.key, e.target.value)}>
                    <option value="">選択してください</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {a.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-[11px]">借方/貸方</Label>
                  <Select value={l.side} onChange={(e) => updateLine(l.key, { side: e.target.value as 'debit' | 'credit' })}>
                    <option value="debit">借方</option>
                    <option value="credit">貸方</option>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-[11px]">金額</Label>
                  <Input
                    type="number"
                    min={0}
                    step="1"
                    value={l.amount}
                    onChange={(e) => updateLine(l.key, { amount: e.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-[11px]">税区分</Label>
                  <Select value={l.taxTreatment} onChange={(e) => updateLine(l.key, { taxTreatment: e.target.value as TaxTreatment })}>
                    {Object.entries(TAX_TREATMENT_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="col-span-1">
                  <Label className="text-[11px]">メモ</Label>
                  <Input value={l.memo} onChange={(e) => updateLine(l.key, { memo: e.target.value })} />
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
                    disabled={lines.length <= 2}
                    aria-label="この行を削除"
                  >
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="ml-auto w-full max-w-sm space-y-1 rounded-lg bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>借方合計</span>
            <span className="tabular-nums">{yen(balance.debit)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>貸方合計</span>
            <span className="tabular-nums">{yen(balance.credit)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-gray-200 pt-1">
            <span className="text-sm font-medium text-gray-600">差額</span>
            <span className={`text-lg font-bold tabular-nums ${balance.balanced ? 'text-success' : 'text-danger'}`}>
              {yen(Math.abs(balance.debit - balance.credit))}
            </span>
          </div>
        </div>

        <FieldError message={error ?? undefined} />
        {!error && !canSave && (
          <p className="text-xs text-gray-500">明細を2行以上入力し、借方合計と貸方合計を一致させると保存できます。</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            キャンセル
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={busy || !canSave}>
            {busy ? '保存中…' : '下書き保存'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
