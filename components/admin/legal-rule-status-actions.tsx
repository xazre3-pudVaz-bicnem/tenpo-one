'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, PlayCircle, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Textarea, FieldError } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { LegalRuleVersionDialog } from './legal-rule-version-dialog';
import {
  markLegalRuleReviewed,
  activateLegalRuleVersion,
  revertLegalRuleToDraft,
} from '@/app/admin/legal-rules/actions';
import { reviewInfoSchema } from '@/app/admin/legal-rules/schema';

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

/**
 * legal_rule_versions の状態遷移UI。DBトリガー（00022_backoffice_hardening.sql）が強制する
 * draft→reviewed→active→superseded の流れをボタンとして提示する。一覧テーブルの「操作」列に
 * rule.statusごとに出し分けて配置する。
 */
export function LegalRuleStatusActions({ rule }: { rule: LegalRuleVersionRow }) {
  if (rule.status === 'draft') return <MarkReviewedButton rule={rule} />;
  if (rule.status === 'reviewed') return <ReviewedActions rule={rule} />;
  if (rule.status === 'active') return <LegalRuleVersionDialog supersedeSource={rule} />;
  return <span className="text-xs text-gray-400">履歴として保持</span>;
}

/** draft → reviewed。根拠・確認者・確認日が未入力だと送信できない（zod + DBトリガーで二重に検証）。 */
function MarkReviewedButton({ rule }: { rule: LegalRuleVersionRow }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const [basis, setBasis] = useState(rule.basis ?? '');
  const [reviewedByName, setReviewedByName] = useState(rule.reviewed_by_name ?? '');
  const [reviewedAt, setReviewedAt] = useState(rule.reviewed_at?.slice(0, 10) ?? '');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = reviewInfoSchema.safeParse({ basis, reviewedByName, reviewedAt });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '入力内容を確認してください');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await markLegalRuleReviewed(rule.id, parsed.data);
        toast('レビュー完了にしました');
        router.refresh();
        close();
      } catch (err) {
        setError(err instanceof Error ? err.message : '更新に失敗しました');
      }
    });
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <CheckCircle2 className="h-3.5 w-3.5" />
        レビュー完了にする
      </Button>
      <Dialog open={open} onClose={close} title="レビュー完了にする">
        <p className="mb-4 text-xs text-gray-500">
          社労士・税理士等による確認が完了した根拠・確認者・確認日を入力してください。3項目とも
          必須です（未入力の場合はDBに保存できません）。
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="mr-basis">根拠（法令名・通達・公的資料URL等）</Label>
            <Textarea id="mr-basis" required value={basis} onChange={(e) => setBasis(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="mr-reviewer">確認者</Label>
              <Input id="mr-reviewer" required value={reviewedByName} onChange={(e) => setReviewedByName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="mr-reviewed-at">確認日</Label>
              <Input
                id="mr-reviewed-at"
                type="date"
                required
                value={reviewedAt}
                onChange={(e) => setReviewedAt(e.target.value)}
              />
            </div>
          </div>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              キャンセル
            </Button>
            <Button type="submit" disabled={pending || !basis.trim() || !reviewedByName.trim() || !reviewedAt}>
              {pending ? '保存中…' : 'レビュー完了にする'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** reviewed → active（有効化）/ reviewed → draft（差戻す） */
function ReviewedActions({ rule }: { rule: LegalRuleVersionRow }) {
  const [activateOpen, setActivateOpen] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" size="sm" onClick={() => setRevertOpen(true)}>
        <Undo2 className="h-3.5 w-3.5" />
        差戻す
      </Button>
      <Button size="sm" onClick={() => setActivateOpen(true)}>
        <PlayCircle className="h-3.5 w-3.5" />
        有効化
      </Button>

      <ConfirmDialog
        open={activateOpen}
        onClose={() => setActivateOpen(false)}
        title="有効化"
        message="有効化すると給与・税計算エンジンから参照可能になります。実行者が記録されます。"
        confirmLabel="有効化する"
        destructive={false}
        onConfirm={async () => {
          try {
            await activateLegalRuleVersion(rule.id);
            toast('有効化しました');
            router.refresh();
          } catch (err) {
            toast(err instanceof Error ? err.message : '有効化に失敗しました', 'error');
          }
        }}
      />
      <ConfirmDialog
        open={revertOpen}
        onClose={() => setRevertOpen(false)}
        title="差戻す"
        message="下書きに戻します。根拠・確認者・確認日は保持されたまま、状態のみ「下書き」に戻ります。"
        confirmLabel="差戻す"
        destructive={false}
        onConfirm={async () => {
          try {
            await revertLegalRuleToDraft(rule.id);
            toast('下書きに差戻しました');
            router.refresh();
          } catch (err) {
            toast(err instanceof Error ? err.message : '差戻しに失敗しました', 'error');
          }
        }}
      />
    </div>
  );
}
