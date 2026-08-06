'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createPayrollRun } from '@/app/app/payroll/actions';

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

export function RunDialog({ storeOptions }: { storeOptions: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const defaults = lastMonthRange();
  const [title, setTitle] = useState(defaults.label);
  const [periodStart, setPeriodStart] = useState(defaults.start);
  const [periodEnd, setPeriodEnd] = useState(defaults.end);
  const [storeId, setStoreId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const submit = () => {
    if (!title.trim()) {
      setError('タイトルを入力してください');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createPayrollRun({
        title: title.trim(),
        periodStart,
        periodEnd,
        storeId: storeId || null,
      });
      toast(result.message, result.ok ? 'success' : 'error');
      if (result.ok && result.runId) {
        setOpen(false);
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
      <Dialog open={open} onClose={() => setOpen(false)} title="給与計算を新規作成">
        <div className="space-y-4">
          <div>
            <Label htmlFor="run-title">タイトル</Label>
            <Input id="run-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
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
          <FieldError message={error ?? undefined} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
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
