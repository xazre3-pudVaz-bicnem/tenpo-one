'use client';

import { useState, useTransition } from 'react';
import { Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea, FieldError } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { updateEmployeeInsurance } from '@/app/app/employees/actions';

export interface InsuranceData {
  employeeId: string;
  healthInsurance: boolean;
  pension: boolean;
  employmentInsurance: boolean;
  careInsurance: boolean;
  standardMonthlyRemuneration: string; // 空文字 or 数値文字列
  acquiredOn: string;
  lostOn: string;
  region: string;
  note: string;
}

const TOGGLES: { key: 'healthInsurance' | 'pension' | 'employmentInsurance' | 'careInsurance'; label: string }[] = [
  { key: 'healthInsurance', label: '健康保険' },
  { key: 'pension', label: '厚生年金' },
  { key: 'employmentInsurance', label: '雇用保険' },
  { key: 'careInsurance', label: '介護保険' },
];

/** 社会保険（構造のみ）。保険料の自動計算は行わない。payroll.manage のみ編集可能 */
export function InsuranceForm({ initial, canEdit }: { initial: InsuranceData; canEdit: boolean }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const toggle = (key: (typeof TOGGLES)[number]['key']) => setForm((f) => ({ ...f, [key]: !f[key] }));

  const submit = () => {
    setError(null);
    const remuneration = form.standardMonthlyRemuneration.trim();
    if (remuneration && (!/^\d+$/.test(remuneration) || Number(remuneration) < 0)) {
      setError('標準報酬月額は0以上の数値で入力してください');
      return;
    }
    startTransition(async () => {
      const result = await updateEmployeeInsurance({
        employeeId: form.employeeId,
        healthInsurance: form.healthInsurance,
        pension: form.pension,
        employmentInsurance: form.employmentInsurance,
        careInsurance: form.careInsurance,
        standardMonthlyRemuneration: remuneration ? Number(remuneration) : null,
        acquiredOn: form.acquiredOn || null,
        lostOn: form.lostOn || null,
        region: form.region,
        note: form.note,
      });
      toast(result.message, result.ok ? 'success' : 'error');
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>社会保険</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-xs text-warning">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>保険料率は法定ルール（専門家確認後に投入）を参照します。現時点で保険料の自動計算は行いません。</p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TOGGLES.map((t) => (
            <label
              key={t.key}
              className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700"
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
                checked={form[t.key]}
                disabled={!canEdit}
                onChange={() => toggle(t.key)}
              />
              {t.label}
            </label>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ins-remuneration">標準報酬月額（円）</Label>
            <Input
              id="ins-remuneration"
              inputMode="numeric"
              value={form.standardMonthlyRemuneration}
              disabled={!canEdit}
              onChange={(e) => setForm((f) => ({ ...f, standardMonthlyRemuneration: e.target.value.replace(/[^\d]/g, '') }))}
            />
          </div>
          <div>
            <Label htmlFor="ins-region">都道府県（健保料率の地域差用）</Label>
            <Input id="ins-region" value={form.region} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ins-acquired">資格取得日</Label>
            <Input id="ins-acquired" type="date" value={form.acquiredOn} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, acquiredOn: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="ins-lost">資格喪失日</Label>
            <Input id="ins-lost" type="date" value={form.lostOn} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, lostOn: e.target.value }))} />
          </div>
        </div>

        <div>
          <Label htmlFor="ins-note">メモ</Label>
          <Textarea id="ins-note" value={form.note} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </div>

        {canEdit && (
          <>
            <FieldError message={error ?? undefined} />
            <div className="flex justify-end">
              <Button onClick={submit} disabled={pending}>
                {pending ? '保存中…' : '社会保険情報を保存'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
