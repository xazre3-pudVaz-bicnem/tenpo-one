'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea, FieldError } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { saveNenchoDraft, submitNencho } from '@/app/app/payroll/nencho/actions';
import type { NenchoData, Dependent } from '@/app/app/payroll/nencho/schema';

export type NenchoStatus = 'new' | 'draft' | 'submitted' | 'reviewing' | 'needs_fix' | 'confirmed';

const STATUS_LABEL: Record<NenchoStatus, string> = {
  new: '未作成',
  draft: '下書き',
  submitted: '提出済み',
  reviewing: '確認中',
  needs_fix: '要修正',
  confirmed: '確認済み',
};
const STATUS_TONE: Record<NenchoStatus, 'gray' | 'warning' | 'success' | 'danger'> = {
  new: 'gray',
  draft: 'gray',
  submitted: 'warning',
  reviewing: 'warning',
  needs_fix: 'danger',
  confirmed: 'success',
};

function emptyDependent(): Dependent {
  return { name: '', relation: '', birthDate: '' };
}

export function NenchoForm({
  year,
  initial,
  status,
  reviewNote,
}: {
  year: number;
  initial: NenchoData;
  status: NenchoStatus;
  reviewNote: string | null;
}) {
  const [data, setData] = useState<NenchoData>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const editable = status === 'new' || status === 'draft' || status === 'needs_fix';

  const set = <K extends keyof NenchoData>(key: K, value: NenchoData[K]) => setData((d) => ({ ...d, [key]: value }));

  const addDependent = () => set('dependents', [...data.dependents, emptyDependent()]);
  const removeDependent = (i: number) => set('dependents', data.dependents.filter((_, idx) => idx !== i));
  const updateDependent = (i: number, patch: Partial<Dependent>) =>
    set(
      'dependents',
      data.dependents.map((d, idx) => (idx === i ? { ...d, ...patch } : d))
    );

  const saveDraft = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveNenchoDraft({ year, data });
      toast(result.message, result.ok ? 'success' : 'error');
      if (!result.ok) setError(result.message);
    });
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const saveResult = await saveNenchoDraft({ year, data });
      if (!saveResult.ok) {
        setError(saveResult.message);
        toast(saveResult.message, 'error');
        return;
      }
      const result = await submitNencho(year);
      toast(result.message, result.ok ? 'success' : 'error');
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <span className="text-xs font-medium text-gray-500">{year}年分の申告状況</span>
        <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
        {status === 'needs_fix' && reviewNote && (
          <span className="text-xs text-danger">差戻し理由: {reviewNote}</span>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-xs text-warning">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>年末調整の計算は税理士等の専門家レビュー完了後に対応予定です。現在は申告情報の収集・確認ワークフローのみ提供しています。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>扶養家族</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.dependents.length === 0 && <p className="text-xs text-gray-400">扶養家族がいる場合は「行を追加」してください</p>}
          {data.dependents.map((dep, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
              <div>
                <Label htmlFor={`dep-name-${i}`}>氏名</Label>
                <Input id={`dep-name-${i}`} value={dep.name} disabled={!editable} onChange={(e) => updateDependent(i, { name: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`dep-relation-${i}`}>続柄</Label>
                <Input id={`dep-relation-${i}`} value={dep.relation} disabled={!editable} onChange={(e) => updateDependent(i, { relation: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`dep-birth-${i}`}>生年月日</Label>
                <Input id={`dep-birth-${i}`} type="date" value={dep.birthDate} disabled={!editable} onChange={(e) => updateDependent(i, { birthDate: e.target.value })} />
              </div>
              {editable && (
                <Button variant="ghost" size="icon" onClick={() => removeDependent(i)} aria-label="この行を削除">
                  <Trash2 className="h-4 w-4 text-danger" />
                </Button>
              )}
            </div>
          ))}
          {editable && (
            <Button variant="secondary" size="sm" onClick={addDependent}>
              <Plus className="h-3.5 w-3.5" />
              行を追加
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>配偶者</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
              checked={data.hasSpouse}
              disabled={!editable}
              onChange={(e) => set('hasSpouse', e.target.checked)}
            />
            配偶者がいる
          </label>
          {data.hasSpouse && (
            <div className="max-w-xs">
              <Label htmlFor="spouse-income">配偶者の年間所得（概算・円）</Label>
              <Input
                id="spouse-income"
                inputMode="numeric"
                value={data.spouseIncome != null ? String(data.spouseIncome) : ''}
                disabled={!editable}
                onChange={(e) => set('spouseIncome', e.target.value ? Number(e.target.value.replace(/[^\d]/g, '')) : null)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>保険料控除</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="life-insurance">生命保険料（年間合計・円）</Label>
            <Input
              id="life-insurance"
              inputMode="numeric"
              value={String(data.lifeInsurancePremium)}
              disabled={!editable}
              onChange={(e) => set('lifeInsurancePremium', Number(e.target.value.replace(/[^\d]/g, '') || 0))}
            />
          </div>
          <div>
            <Label htmlFor="earthquake-insurance">地震保険料（年間合計・円）</Label>
            <Input
              id="earthquake-insurance"
              inputMode="numeric"
              value={String(data.earthquakeInsurancePremium)}
              disabled={!editable}
              onChange={(e) => set('earthquakeInsurancePremium', Number(e.target.value.replace(/[^\d]/g, '') || 0))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>その他の申告事項</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
              checked={data.hasHousingLoanDeduction}
              disabled={!editable}
              onChange={(e) => set('hasHousingLoanDeduction', e.target.checked)}
            />
            住宅ローン控除の適用がある
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
              checked={data.hasPreviousEmploymentIncome}
              disabled={!editable}
              onChange={(e) => set('hasPreviousEmploymentIncome', e.target.checked)}
            />
            今年、前職からの給与収入がある（前職源泉徴収票の提出が必要です）
          </label>
          <div>
            <Label htmlFor="basic-deduction-note">基礎控除申告メモ</Label>
            <Textarea
              id="basic-deduction-note"
              value={data.basicDeductionNote}
              disabled={!editable}
              onChange={(e) => set('basicDeductionNote', e.target.value)}
              placeholder="所得の見積額や特記事項があれば入力してください"
            />
          </div>
        </CardContent>
      </Card>

      {editable && (
        <>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={saveDraft} disabled={pending}>
              {pending ? '保存中…' : '下書き保存'}
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? '処理中…' : '提出する'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
