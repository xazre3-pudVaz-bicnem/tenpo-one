'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { createPayrollRun, createBonusRun } from '@/app/app/payroll/actions';

function lastMonthRange(): { start: string; end: string; label: string } {
  const now = new Date();
  const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const y = jstNow.getFullYear();
  const m = jstNow.getMonth(); // 0-indexed: 現在月の1つ前 = 先月
  const firstOfLastMonth = new Date(y, m - 1, 1);
  const lastOfLastMonth = new Date(y, m, 0);
  const fmt = (d: Date) => d.toLocaleDateString('sv-SE');
  return {
    start: fmt(firstOfLastMonth),
    end: fmt(lastOfLastMonth),
    label: `${firstOfLastMonth.getFullYear()}年${firstOfLastMonth.getMonth() + 1}月分`,
  };
}

function todayStr(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

interface BonusItemRow {
  profileId: string;
  amount: string;
}

export function RunDialog({
  storeOptions,
  staffOptions,
}: {
  storeOptions: { id: string; name: string }[];
  staffOptions: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [runType, setRunType] = useState<'salary' | 'bonus'>('salary');
  const defaults = lastMonthRange();
  const [title, setTitle] = useState(defaults.label);
  const [periodStart, setPeriodStart] = useState(defaults.start);
  const [periodEnd, setPeriodEnd] = useState(defaults.end);
  const [paymentDate, setPaymentDate] = useState(todayStr());
  const [storeId, setStoreId] = useState('');
  const [bonusItems, setBonusItems] = useState<BonusItemRow[]>([{ profileId: '', amount: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const changeRunType = (type: 'salary' | 'bonus') => {
    setRunType(type);
    setError(null);
    setTitle(type === 'bonus' ? `${new Date().getFullYear()}年 賞与` : defaults.label);
  };

  const addBonusRow = () => setBonusItems((rows) => [...rows, { profileId: '', amount: '' }]);
  const removeBonusRow = (index: number) => setBonusItems((rows) => rows.filter((_, i) => i !== index));
  const updateBonusRow = (index: number, patch: Partial<BonusItemRow>) =>
    setBonusItems((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const bonusTotal = bonusItems.reduce((a, r) => a + (Number(r.amount) || 0), 0);

  const submit = () => {
    if (!title.trim()) {
      setError('タイトルを入力してください');
      return;
    }
    setError(null);

    if (runType === 'salary') {
      if (periodStart > periodEnd) {
        setError('期間の指定が正しくありません');
        return;
      }
      startTransition(async () => {
        const result = await createPayrollRun({ title: title.trim(), periodStart, periodEnd, storeId: storeId || null });
        toast(result.message, result.ok ? 'success' : 'error');
        if (result.ok && result.runId) {
          close();
          router.push(`/app/payroll/${result.runId}`);
        } else if (!result.ok) {
          setError(result.message);
        }
      });
      return;
    }

    const items = bonusItems
      .filter((r) => r.profileId && r.amount)
      .map((r) => ({ profileId: r.profileId, amount: Number(r.amount) }));
    if (items.length === 0) {
      setError('対象スタッフと支給額を1件以上入力してください');
      return;
    }
    startTransition(async () => {
      const result = await createBonusRun({ title: title.trim(), paymentDate, storeId: storeId || null, items });
      toast(result.message, result.ok ? 'success' : 'error');
      if (result.ok && result.runId) {
        close();
        router.push(`/app/payroll/${result.runId}`);
      } else if (!result.ok) {
        setError(result.message);
      }
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        新規作成
      </Button>
      <Dialog open={open} onClose={close} title="給与計算を新規作成" wide={runType === 'bonus'}>
        <div className="space-y-4">
          <div>
            <Label htmlFor="run-type">種別</Label>
            <Select id="run-type" value={runType} onChange={(e) => changeRunType(e.target.value as 'salary' | 'bonus')}>
              <option value="salary">給与（期間集計）</option>
              <option value="bonus">賞与（金額を手入力）</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="run-title">タイトル</Label>
            <Input id="run-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          {runType === 'salary' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="run-start">期間開始</Label>
                <Input id="run-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="run-end">期間終了</Label>
                <Input id="run-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
            </div>
          ) : (
            <div>
              <Label htmlFor="run-payment-date">支給日</Label>
              <Input id="run-payment-date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
          )}

          <div>
            <Label htmlFor="run-store">対象店舗</Label>
            <Select id="run-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">全社（全店舗）</option>
              {storeOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>

          {runType === 'bonus' && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="mb-0">対象スタッフ・支給額</Label>
                <span className="text-xs text-gray-500">
                  勤怠集計・手当・歩合は含みません。支給額は税・社会保険控除前の総支給額を入力してください
                </span>
              </div>
              <div className="space-y-2">
                {bonusItems.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select
                      value={row.profileId}
                      onChange={(e) => updateBonusRow(i, { profileId: e.target.value })}
                      className="flex-1"
                    >
                      <option value="">スタッフを選択</option>
                      {staffOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="支給額"
                      value={row.amount}
                      onChange={(e) => updateBonusRow(i, { amount: e.target.value })}
                      className="w-36"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeBonusRow(i)}
                      disabled={bonusItems.length === 1}
                      aria-label="この行を削除"
                    >
                      <Trash2 className="h-4 w-4 text-danger" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="secondary" size="sm" className="mt-2" onClick={addBonusRow}>
                <Plus className="h-3.5 w-3.5" />
                行を追加
              </Button>
              <p className="mt-2 text-right text-sm font-medium text-navy">合計 {yen(bonusTotal)}</p>
            </div>
          )}

          <FieldError message={error ?? undefined} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? '作成中…' : '作成する'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
