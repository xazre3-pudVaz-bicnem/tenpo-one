'use client';

import { useMemo, useState, useTransition } from 'react';
import { Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { ROLE_LABELS } from '@/lib/permissions';
import { findOverlappingRules, type ApprovalRuleLike } from '@/lib/approvals';
import { saveApprovalRule, deleteApprovalRule, type ApprovalRuleInput } from './actions';

export interface ApprovalRuleRow {
  id: string;
  target: ApprovalRuleLike['target'];
  minAmount: number;
  maxAmount: number | null;
  approverRole: ApprovalRuleLike['approverRole'];
  allowSelfApprove: boolean;
}

const TARGET_LABELS: Record<ApprovalRuleRow['target'], string> = {
  invoice: '請求書',
  expense: '経費',
  petty_cash: '小口現金',
  purchase_order: '発注',
};

const TARGET_OPTIONS: ApprovalRuleRow['target'][] = ['invoice', 'expense', 'petty_cash', 'purchase_order'];

const APPROVER_ROLE_OPTIONS: ApprovalRuleRow['approverRole'][] = [
  'store_manager',
  'area_manager',
  'hq_accounting',
  'hq_admin',
  'org_owner',
];

const EMPTY: ApprovalRuleInput = {
  target: 'invoice',
  minAmount: 0,
  maxAmount: null,
  approverRole: 'store_manager',
  allowSelfApprove: false,
};

function rangeLabel(minAmount: number, maxAmount: number | null): string {
  if (minAmount <= 0 && maxAmount != null) return `${yen(maxAmount)}未満`;
  if (maxAmount == null) return `${yen(minAmount)}以上`;
  return `${yen(minAmount)}〜${yen(maxAmount)}未満`;
}

export function ApprovalRulesPanel({ initial }: { initial: ApprovalRuleRow[] }) {
  const rows = initial;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [form, setForm] = useState<ApprovalRuleInput>(EMPTY);
  const [deleting, setDeleting] = useState<ApprovalRuleRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const overlaps = useMemo(() => findOverlappingRules(rows), [rows]);

  const openAdd = () => {
    setEditingId(undefined);
    setForm(EMPTY);
    setError(null);
    setDialogOpen(true);
  };
  const openEdit = (row: ApprovalRuleRow) => {
    setEditingId(row.id);
    setForm({
      target: row.target,
      minAmount: row.minAmount,
      maxAmount: row.maxAmount,
      approverRole: row.approverRole,
      allowSelfApprove: row.allowSelfApprove,
    });
    setError(null);
    setDialogOpen(true);
  };

  const set = <K extends keyof ApprovalRuleInput>(key: K, value: ApprovalRuleInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = () => {
    setError(null);
    if (form.maxAmount != null && form.maxAmount <= form.minAmount) {
      setError('上限金額は下限金額より大きい値で入力してください（空欄=上限なし）');
      return;
    }
    startTransition(async () => {
      const result = await saveApprovalRule({ ...form, id: editingId });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast(editingId ? '承認ルールを更新しました' : '承認ルールを追加しました');
      setDialogOpen(false);
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
        例：3万円未満＝店長 ／ 3〜10万円＝エリアマネージャー ／ 10万円以上＝本社経理。ルールが未設定の対象・金額帯は、従来どおり権限のみで承認できます。
      </div>

      {overlaps.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          {overlaps.map(([a, b], i) => (
            <div key={i} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                「{TARGET_LABELS[a.target]}」で金額帯が重なっています：{rangeLabel(a.minAmount, a.maxAmount)}（
                {ROLE_LABELS[a.approverRole]}）と {rangeLabel(b.minAmount, b.maxAmount)}（{ROLE_LABELS[b.approverRole]}）
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4" />
          ルールを追加
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="承認ルールが登録されていません" description="「ルールを追加」から金額帯ごとの承認ルールを登録してください" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>対象</Th>
                <Th>金額帯</Th>
                <Th>必要承認ロール</Th>
                <Th>自己承認</Th>
                <Th className="text-right">操作</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Badge tone="gray">{TARGET_LABELS[r.target]}</Badge>
                  </Td>
                  <Td className="tabular-nums">{rangeLabel(r.minAmount, r.maxAmount)}</Td>
                  <Td className="font-medium text-navy">{ROLE_LABELS[r.approverRole]}</Td>
                  <Td>{r.allowSelfApprove ? <Badge tone="warning">許可</Badge> : <Badge tone="gray">不可</Badge>}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        aria-label="編集"
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(r)}
                        aria-label="削除"
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}

      {dialogOpen && (
        <Dialog open onClose={() => setDialogOpen(false)} title={editingId ? '承認ルール編集' : '承認ルール追加'}>
          <div className="space-y-4">
            <div>
              <Label htmlFor="rule-target">対象</Label>
              <Select
                id="rule-target"
                value={form.target}
                onChange={(e) => set('target', e.target.value as ApprovalRuleInput['target'])}
              >
                {TARGET_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {TARGET_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="rule-min">下限金額（円・以上）</Label>
                <Input
                  id="rule-min"
                  type="number"
                  min={0}
                  step={1}
                  value={form.minAmount}
                  onChange={(e) => set('minAmount', Math.max(0, Math.round(Number(e.target.value) || 0)))}
                />
              </div>
              <div>
                <Label htmlFor="rule-max">上限金額（円・未満／空欄=上限なし）</Label>
                <Input
                  id="rule-max"
                  type="number"
                  min={0}
                  step={1}
                  value={form.maxAmount ?? ''}
                  onChange={(e) => set('maxAmount', e.target.value === '' ? null : Math.round(Number(e.target.value)))}
                  placeholder="上限なし"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="rule-role">必要承認ロール</Label>
              <Select
                id="rule-role"
                value={form.approverRole}
                onChange={(e) => set('approverRole', e.target.value as ApprovalRuleInput['approverRole'])}
              >
                {APPROVER_ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                checked={form.allowSelfApprove}
                onChange={(e) => set('allowSelfApprove', e.target.checked)}
              />
              自分が登録した申請でも自己承認を許可する
            </label>

            <FieldError message={error ?? undefined} />

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setDialogOpen(false)} disabled={pending}>
                キャンセル
              </Button>
              <Button onClick={handleSubmit} disabled={pending}>
                {pending ? '保存中…' : '保存する'}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title="承認ルールを削除"
          message={`「${TARGET_LABELS[deleting.target]}／${rangeLabel(deleting.minAmount, deleting.maxAmount)}」のルールを削除します。`}
          confirmLabel="削除する"
          onConfirm={async () => {
            const result = await deleteApprovalRule(deleting.id);
            if (result.error) {
              toast(result.error, 'error');
              return;
            }
            toast('承認ルールを削除しました');
          }}
        />
      )}
    </div>
  );
}
