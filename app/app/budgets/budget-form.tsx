'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { upsertBudget, type BudgetInput } from './actions';

export interface BudgetFormData {
  storeId: string | null;
  storeName: string;
  month: string;
  salesBudget: number;
  costRateTarget: number | null;
  laborRateTarget: number | null;
  profitTarget: number | null;
  guestsTarget: number | null;
  avgSpendTarget: number | null;
  note: string | null;
}

export function BudgetForm({ data }: { data: BudgetFormData }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  const handleSubmit = async (formData: FormData) => {
    setBusy(true);
    setError(null);
    const num = (key: string) => {
      const v = formData.get(key);
      return v === null || v === '' ? null : Number(v);
    };
    const input: BudgetInput = {
      storeId: data.storeId,
      month: data.month,
      salesBudget: num('salesBudget') ?? 0,
      costRateTarget: num('costRateTarget'),
      laborRateTarget: num('laborRateTarget'),
      profitTarget: num('profitTarget'),
      guestsTarget: num('guestsTarget'),
      avgSpendTarget: num('avgSpendTarget'),
      note: (formData.get('note') as string) || null,
    };
    try {
      await upsertBudget(input);
      toast('予算を保存しました');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" />
        編集
      </Button>
      <Dialog open={open} onClose={close} title={`予算を編集：${data.storeName}（${data.month.slice(0, 7).replaceAll('-', '/')}）`}>
        <form
          action={(fd) => {
            void handleSubmit(fd);
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label htmlFor="b-sales">売上予算（円）</Label>
              <Input id="b-sales" name="salesBudget" type="number" min={0} step={1000} required defaultValue={data.salesBudget} />
            </div>
            <div>
              <Label htmlFor="b-cost">原価率目標（%）</Label>
              <Input id="b-cost" name="costRateTarget" type="number" min={0} max={100} step={0.1} defaultValue={data.costRateTarget ?? ''} />
            </div>
            <div>
              <Label htmlFor="b-labor">人件費率目標（%）</Label>
              <Input id="b-labor" name="laborRateTarget" type="number" min={0} max={100} step={0.1} defaultValue={data.laborRateTarget ?? ''} />
            </div>
            <div>
              <Label htmlFor="b-profit">利益目標（円）</Label>
              <Input id="b-profit" name="profitTarget" type="number" step={1000} defaultValue={data.profitTarget ?? ''} />
            </div>
            <div>
              <Label htmlFor="b-guests">客数目標（名）</Label>
              <Input id="b-guests" name="guestsTarget" type="number" min={0} defaultValue={data.guestsTarget ?? ''} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="b-avg">客単価目標（円）</Label>
              <Input id="b-avg" name="avgSpendTarget" type="number" min={0} defaultValue={data.avgSpendTarget ?? ''} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="b-note">メモ</Label>
              <Textarea id="b-note" name="note" defaultValue={data.note ?? ''} />
            </div>
          </div>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              キャンセル
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '保存中…' : '保存する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
