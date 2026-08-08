'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Copy } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, Select, FieldError } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import {
  createLegalRuleVersion,
  updateLegalRuleVersion,
  supersedeLegalRuleVersion,
} from '@/app/admin/legal-rules/actions';
import type { LegalRuleVersionInput } from '@/app/admin/legal-rules/actions';
import {
  RULE_TYPES,
  RULE_TYPE_LABELS,
  RULE_STATUS_LABELS,
  parseLegalRuleParameters,
  type RuleType,
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
  basis: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
}

interface LegalRuleVersionDialogProps {
  /** 指定時は編集モード */
  rule?: LegalRuleVersionRow;
  /** 指定時は「新versionで置き換え」モード（rule指定時と併用不可） */
  supersedeSource?: LegalRuleVersionRow;
}

/**
 * 法定ルールversionの追加・編集・置換ダイアログ。parameters はJSONエディタ（textarea）で入力し、
 * zod（parseLegalRuleParameters）で「有効なJSONオブジェクトか」を検証する。値の法令適合性は
 * ここでは検証しない（推測で法定数値を埋めない方針。専門家レビューで担保）。
 * status（状態）はここでは編集しない。draft→reviewed→active→supersededの遷移は
 * legal-rule-status-actions.tsxの専用ボタン（DBトリガーで強制）で行う。
 */
export function LegalRuleVersionDialog({ rule, supersedeSource }: LegalRuleVersionDialogProps) {
  const isEdit = !!rule;
  const isSupersede = !!supersedeSource;
  const source = rule ?? supersedeSource;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const [ruleType, setRuleType] = useState<RuleType>((source?.rule_type as RuleType) ?? 'income_tax');
  const [year, setYear] = useState(String(source?.year ?? new Date().getFullYear()));
  const [region, setRegion] = useState(source?.region ?? '');
  // 置換モードでは適用期間・versionは新しい値を入力させる（コピーしない）
  const [effectiveFrom, setEffectiveFrom] = useState(isSupersede ? '' : (source?.effective_from?.slice(0, 10) ?? ''));
  const [effectiveTo, setEffectiveTo] = useState(isSupersede ? '' : (source?.effective_to?.slice(0, 10) ?? ''));
  const [version, setVersion] = useState(isSupersede ? '' : (source?.version ?? ''));
  const [parametersRaw, setParametersRaw] = useState(
    source?.parameters ? JSON.stringify(source.parameters, null, 2) : '{}'
  );
  const [note, setNote] = useState(isSupersede ? '' : (source?.note ?? ''));
  const [basis, setBasis] = useState(isSupersede ? '' : (source?.basis ?? ''));
  const [reviewedByName, setReviewedByName] = useState(isSupersede ? '' : (source?.reviewed_by_name ?? ''));
  const [reviewedAt, setReviewedAt] = useState(isSupersede ? '' : (source?.reviewed_at?.slice(0, 10) ?? ''));
  const [error, setError] = useState<string | null>(null);

  const parametersLocked = isEdit && (rule.status === 'active' || rule.status === 'superseded');

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
      parametersRaw,
      note,
      basis,
      reviewedByName,
      reviewedAt,
    };
    startTransition(async () => {
      try {
        if (isSupersede) {
          await supersedeLegalRuleVersion(supersedeSource.id, input);
          toast('新versionを登録し、元のversionを置換済みにしました');
        } else if (isEdit) {
          await updateLegalRuleVersion(rule.id, input);
          toast('法定ルールを更新しました');
        } else {
          await createLegalRuleVersion(input);
          toast('法定ルールを登録しました（下書き）');
        }
        router.refresh();
        close();
      } catch (err) {
        setError(err instanceof Error ? err.message : '保存に失敗しました');
      }
    });
  };

  const triggerLabel = isSupersede ? '新versionで置き換え' : isEdit ? '編集' : '法定ルールを追加';
  const dialogTitle = isSupersede ? '新versionで置き換え（supersede）' : isEdit ? '法定ルールを編集' : '法定ルールを追加';

  return (
    <>
      {isSupersede ? (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Copy className="h-3.5 w-3.5" />
          {triggerLabel}
        </Button>
      ) : isEdit ? (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Pencil className="h-3.5 w-3.5" />
          {triggerLabel}
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          {triggerLabel}
        </Button>
      )}

      <Dialog open={open} onClose={close} title={dialogTitle} wide>
        {isEdit && (
          <div className="mb-4 flex items-center gap-2 text-xs text-gray-500">
            現在の状態:
            <Badge tone="gray">{RULE_STATUS_LABELS[rule.status as keyof typeof RULE_STATUS_LABELS] ?? rule.status}</Badge>
            状態の変更は一覧の操作ボタン（レビュー完了にする／有効化／差戻す／置き換え）から行ってください。
          </div>
        )}
        {isSupersede && (
          <div className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
            「
            {RULE_TYPE_LABELS[supersedeSource.rule_type as RuleType] ?? supersedeSource.rule_type}
            （version: {supersedeSource.version}）」を置き換えます。登録すると新versionは「下書き」で
            作成され、元のversion（現在: 有効）は「置換済み」に変わります。新versionが計算エンジンから
            参照されるようにするには、別途レビュー完了→有効化の操作が必要です。
          </div>
        )}
        {!isEdit && !isSupersede && (
          <div className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
            新規登録は常に「下書き」状態で作成されます。状態が「レビュー済み」または「有効」になる
            まで、このルールは給与・税計算エンジンから参照されません。社労士・税理士のレビューが
            完了するまでは「下書き」のまま保存してください。
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
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
          </div>
          <div className="grid grid-cols-3 gap-4">
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
            <div>
              <Label htmlFor="lrv-version">version</Label>
              <Input id="lrv-version" required value={version} onChange={(e) => setVersion(e.target.value)} />
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
              disabled={parametersLocked}
            />
            <p className="mt-1 text-[11px] text-gray-400">
              {parametersLocked
                ? '有効化済み・置換済みのルールのparametersは変更できません（改正時は「新versionで置き換え」から新しいversionを作成してください）。'
                : '税額表・保険料率等はJSONオブジェクト（{ "key": ... }）形式で入力してください。数値の法令適合性はここでは検証されません（専門家レビューで担保する方針）。'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="lrv-reviewer">確認者</Label>
              <Input
                id="lrv-reviewer"
                value={reviewedByName}
                onChange={(e) => setReviewedByName(e.target.value)}
                placeholder="例: ○○税理士事務所 ○○"
              />
            </div>
            <div>
              <Label htmlFor="lrv-reviewed-at">確認日</Label>
              <Input
                id="lrv-reviewed-at"
                type="date"
                value={reviewedAt}
                onChange={(e) => setReviewedAt(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="lrv-basis">根拠（法令名・通達・公的資料URL等）</Label>
            <Textarea
              id="lrv-basis"
              value={basis}
              onChange={(e) => setBasis(e.target.value)}
              placeholder="例: 所得税法別表第二、国税庁タックスアンサーNo.2260、厚生労働省告示URL等"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              確認者・確認日・根拠の3項目は、一覧の「レビュー完了にする」操作で必須になります
              （DBトリガーで強制）。ここで先に入力しておくこともできます。
            </p>
          </div>
          <div>
            <Label htmlFor="lrv-note">メモ</Label>
            <Textarea id="lrv-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="補足事項など" />
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
