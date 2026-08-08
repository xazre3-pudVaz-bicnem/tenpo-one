'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createConsumptionTaxRate } from '@/app/admin/legal-rules/actions';
import type { ConsumptionTaxRateInput } from '@/app/admin/legal-rules/actions';
import { TAX_TREATMENTS, TAX_TREATMENT_LABELS, type ConsumptionTaxTreatment } from '@/app/admin/legal-rules/schema';

/** 消費税率の改正登録ダイアログ。編集はできない（過去の税率行は履歴として不変）。 */
export function ConsumptionTaxRateDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const [treatment, setTreatment] = useState<ConsumptionTaxTreatment>('taxable_standard');
  const [rate, setRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [version, setVersion] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const input: ConsumptionTaxRateInput = {
      treatment,
      rate: Number(rate),
      effectiveFrom,
      version,
      note,
    };
    startTransition(async () => {
      try {
        await createConsumptionTaxRate(input);
        toast('消費税率を登録しました');
        router.refresh();
        setRate('');
        setEffectiveFrom('');
        setVersion('');
        setNote('');
        close();
      } catch (err) {
        setError(err instanceof Error ? err.message : '登録に失敗しました');
      }
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        税率を追加（改正登録）
      </Button>

      <Dialog open={open} onClose={close} title="消費税率の改正登録">
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
          税率変更は全企業の自動仕訳・POS税計算の将来versionに影響します。登録すると、同区分で現在
          適用中（適用終了日が未設定）の行の適用終了日が、この適用開始日の前日に自動設定されます。
          過去に確定した仕訳・発行済みレシートの税率は遡って変更されません。
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="ctr-treatment">区分</Label>
            <Select
              id="ctr-treatment"
              value={treatment}
              onChange={(e) => setTreatment(e.target.value as ConsumptionTaxTreatment)}
            >
              {TAX_TREATMENTS.map((t) => (
                <option key={t} value={t}>
                  {TAX_TREATMENT_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="ctr-rate">税率（%）</Label>
              <Input
                id="ctr-rate"
                type="number"
                step="0.01"
                min={0}
                max={100}
                required
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="10.00"
              />
            </div>
            <div>
              <Label htmlFor="ctr-from">適用開始日</Label>
              <Input
                id="ctr-from"
                type="date"
                required
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="ctr-version">version</Label>
            <Input
              id="ctr-version"
              required
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="例: 2019-10"
            />
          </div>
          <div>
            <Label htmlFor="ctr-note">メモ</Label>
            <Textarea
              id="ctr-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="改正の根拠・法令名など"
            />
          </div>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              キャンセル
            </Button>
            <Button type="submit" disabled={pending || !rate || !effectiveFrom || !version}>
              {pending ? '登録中…' : '登録する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
