'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createLegalRuleVersion, updateLegalRuleVersion } from '@/app/admin/legal-rules/actions';
import type { LegalRuleVersionInput } from '@/app/admin/legal-rules/actions';
import {
  RULE_TYPES,
  RULE_TYPE_LABELS,
  RULE_STATUSES,
  RULE_STATUS_LABELS,
  parseLegalRuleParameters,
  type RuleType,
  type RuleStatus,
} from '@/app/admin/legal-rules/schema';

interface LegalRuleVersionRow {
  id: string;
  rule_type: string;
  year: number;
  region: string | null;
  effective_from: string;
  effective_to: string | null;
  version: string;
  status: string;
  parameters: unknown;
  note: string | null;
}

/**
 * 法定ルールversionの追加・編集ダイアログ。parameters はJSONエディタ（textarea）で入力し、
 * zod（parseLegalRuleParameters）で「有効なJSONオブジェクトか」を検証する。値の法令適合性は
 * ここでは検証しない（推測で法定数値を埋めない方針。専門家レビューで担保）。
 */
export function LegalRuleVersionDialog({ rule }: { rule?: LegalRuleVersionRow }) {
  const isEdit = !!rule;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const [ruleType, setRuleType] = useState<RuleType>((rule?.rule_type as RuleType) ?? 'income_tax');
  const [year, setYear] = useState(String(rule?.year ?? new Date().getFullYear()));
  const [region, setRegion] = useState(rule?.region ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(rule?.effective_from?.slice(0, 10) ?? '');
  const [effectiveTo, setEffectiveTo] = useState(rule?.effective_to?.slice(0, 10) ?? '');
  const [version, setVersion] = useState(rule?.version ?? '');
  const [status, setStatus] = useState<RuleStatus>((rule?.status as RuleStatus) ?? 'draft');
  const [parametersRaw, setParametersRaw] = useState(
    rule?.parameters ? JSON.stringify(rule.parameters, null, 2) : '{}'
  );
  const [note, setNote] = useState(rule?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = parseLegalRuleParameters(parametersRaw);
    if (!parsed.ok) {
      setError(`parameters: ${parsed.error}`);
      return;
    }

    const input: LegalRuleVersionInput = {
      ruleType,
      year: Number(year) || 0,
      region,
      effectiveFrom,
      effectiveTo,
      version,
      status,
      parametersRaw,
      note,
    };
    startTransition(async () => {
      try {
        if (isEdit) {
          await updateLegalRuleVersion(rule.id, input);
          toast('法定ルールを更新しました');
        } else {
          await createLegalRuleVersion(input);
          toast('法定ルールを登録しました');
        }
        router.refresh();
        close();
      } catch (err) {
        setError(err instanceof Error ? err.message : '保存に失敗しました');
      }
    });
  };

  return (
    <>
      {isEdit ? (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Pencil className="h-3.5 w-3.5" />
          編集
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          法定ルールを追加
        </Button>
      )}

      <Dialog open={open} onClose={close} title={isEdit ? '法定ルールを編集' : '法定ルールを追加'} wide>
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
          状態が「レビュー済み」または「有効」になるまで、このルールは給与・税計算エンジンから参照
          されません（設計方針。参照するエンジン側の実装は別途）。社労士・税理士のレビューが完了する
          までは「下書き」のまま保存してください。
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="lrv-type">rule_type</Label>
              <Select id="lrv-type" value={ruleType} onChange={(e) => setRuleType(e.target.value as RuleType)}>
                {RULE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {RULE_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="lrv-status">状態</Label>
              <Select id="lrv-status" value={status} onChange={(e) => setStatus(e.target.value as RuleStatus)}>
                {RULE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {RULE_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="lrv-year">年度</Label>
              <Input id="lrv-year" type="number" required value={year} onChange={(e) => setYear(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="lrv-region">地域</Label>
              <Input
                id="lrv-region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="空欄=全国"
              />
            </div>
            <div>
              <Label htmlFor="lrv-version">version</Label>
              <Input id="lrv-version" required value={version} onChange={(e) => setVersion(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="lrv-from">適用開始日</Label>
              <Input
                id="lrv-from"
                type="date"
                required
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="lrv-to">適用終了日</Label>
              <Input
                id="lrv-to"
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                placeholder="空欄=現行"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="lrv-params">parameters（JSON）</Label>
            <Textarea
              id="lrv-params"
              rows={8}
              className="font-mono text-xs"
              value={parametersRaw}
              onChange={(e) => setParametersRaw(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-gray-400">
              税額表・保険料率等はJSONオブジェクト（{'{ "key": ... }'}）形式で入力してください。数値の
              法令適合性はここでは検証されません（専門家レビューで担保する方針）。
            </p>
          </div>
          <div>
            <Label htmlFor="lrv-note">メモ</Label>
            <Textarea
              id="lrv-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="根拠法令・レビュー担当者など"
            />
          </div>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              キャンセル
            </Button>
            <Button type="submit" disabled={pending || !version || !effectiveFrom}>
              {pending ? '保存中…' : '保存する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
