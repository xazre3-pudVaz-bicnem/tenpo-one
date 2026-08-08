'use client';

import { useState, useTransition } from 'react';
import { Plus, Pencil, Trash2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { TAX_TREATMENT_LABELS, type AccountCategory, type TaxTreatment } from '@/lib/accounting';
import { ACCOUNT_CATEGORY_LABELS, ACCOUNT_CATEGORY_ORDER, SUB_TYPE_LABELS, type SubType } from '@/components/accounting/labels';
import { saveAccount, deleteAccount, installStandardAccounts, type AccountInput } from './actions';

export interface AccountRow {
  id: string;
  code: string;
  name: string;
  category: AccountCategory;
  subType: string | null;
  defaultTaxTreatment: TaxTreatment;
  isSystem: boolean;
  sortOrder: number;
}

const SUB_TYPE_OPTIONS: SubType[] = ['cash', 'bank', 'receivable', 'payable', 'inventory'];

const EMPTY: AccountInput = {
  code: '',
  name: '',
  category: 'expense',
  subType: null,
  defaultTaxTreatment: 'taxable_standard',
  sortOrder: 0,
};

export function AccountsPanel({ initial }: { initial: AccountRow[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [form, setForm] = useState<AccountInput>(EMPTY);
  const [deleting, setDeleting] = useState<AccountRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [installing, setInstalling] = useState(false);
  const { toast } = useToast();

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY);
    setError(null);
    setDialogOpen(true);
  };
  const openEdit = (row: AccountRow) => {
    setEditing(row);
    setForm({
      code: row.code,
      name: row.name,
      category: row.category,
      subType: row.subType,
      defaultTaxTreatment: row.defaultTaxTreatment,
      sortOrder: row.sortOrder,
    });
    setError(null);
    setDialogOpen(true);
  };

  const set = <K extends keyof AccountInput>(key: K, value: AccountInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = () => {
    setError(null);
    if (!form.code.trim()) {
      setError('コードを入力してください');
      return;
    }
    if (!form.name.trim()) {
      setError('名称を入力してください');
      return;
    }
    startTransition(async () => {
      const result = await saveAccount({ ...form, id: editing?.id });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast(editing ? '科目を更新しました' : '科目を追加しました');
      setDialogOpen(false);
    });
  };

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const result = await installStandardAccounts();
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      const count = result.count ?? 0;
      toast(count > 0 ? `標準科目を${count}件追加しました` : '追加できる標準科目はありませんでした（導入済みです）');
    } finally {
      setInstalling(false);
    }
  };

  const grouped = ACCOUNT_CATEGORY_ORDER.map((category) => ({
    category,
    rows: initial.filter((r) => r.category === category).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => void handleInstall()} disabled={installing}>
          <Sparkles className="h-4 w-4" />
          {installing ? '導入中…' : '標準科目テンプレートを導入'}
        </Button>
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4" />
          科目を追加
        </Button>
      </div>

      {initial.length === 0 ? (
        <EmptyState
          title="勘定科目が登録されていません"
          description="「標準科目テンプレートを導入」で基本的な科目一式を追加するか、「科目を追加」から個別に登録してください"
          action={
            <Button size="sm" onClick={() => void handleInstall()} disabled={installing}>
              <Sparkles className="h-4 w-4" />
              {installing ? '導入中…' : '標準科目テンプレートを導入'}
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {grouped.map((g) => (
            <div key={g.category}>
              <h2 className="mb-2 text-sm font-semibold text-navy">{ACCOUNT_CATEGORY_LABELS[g.category]}</h2>
              <TableWrap>
                <Table>
                  <THead>
                    <Tr>
                      <Th>コード</Th>
                      <Th>名称</Th>
                      <Th>補助区分</Th>
                      <Th>税区分（既定）</Th>
                      <Th>並び順</Th>
                      <Th className="text-right">操作</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {g.rows.map((r) => (
                      <Tr key={r.id}>
                        <Td className="font-mono text-xs">{r.code}</Td>
                        <Td className="font-medium text-navy">
                          {r.name}
                          {r.isSystem && (
                            <Badge tone="gray" className="ml-2">
                              標準
                            </Badge>
                          )}
                        </Td>
                        <Td>{r.subType ? SUB_TYPE_LABELS[r.subType as SubType] ?? r.subType : '—'}</Td>
                        <Td>{TAX_TREATMENT_LABELS[r.defaultTaxTreatment]}</Td>
                        <Td className="tabular-nums">{r.sortOrder}</Td>
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
                            {!r.isSystem && (
                              <button
                                type="button"
                                onClick={() => setDeleting(r)}
                                aria-label="削除"
                                className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>
          ))}
        </div>
      )}

      {dialogOpen && (
        <Dialog open onClose={() => setDialogOpen(false)} title={editing ? '勘定科目を編集' : '勘定科目を追加'}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="acc-code">コード</Label>
                <Input
                  id="acc-code"
                  value={form.code}
                  onChange={(e) => set('code', e.target.value)}
                  disabled={!!editing?.isSystem}
                  placeholder="600"
                />
              </div>
              <div>
                <Label htmlFor="acc-sort">並び順</Label>
                <Input
                  id="acc-sort"
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => set('sortOrder', Number(e.target.value))}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="acc-name">名称</Label>
              <Input id="acc-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="広告宣伝費" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="acc-category">カテゴリ</Label>
                <Select
                  id="acc-category"
                  value={form.category}
                  onChange={(e) => set('category', e.target.value as AccountCategory)}
                  disabled={!!editing?.isSystem}
                >
                  {ACCOUNT_CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {ACCOUNT_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="acc-subtype">補助区分（帳簿の対象判定）</Label>
                <Select
                  id="acc-subtype"
                  value={form.subType ?? ''}
                  onChange={(e) => set('subType', e.target.value || null)}
                >
                  <option value="">なし</option>
                  {SUB_TYPE_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {SUB_TYPE_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="acc-tax">税区分（既定）</Label>
              <Select
                id="acc-tax"
                value={form.defaultTaxTreatment}
                onChange={(e) => set('defaultTaxTreatment', e.target.value as TaxTreatment)}
              >
                {Object.entries(TAX_TREATMENT_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>

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
          title="勘定科目を削除"
          message={`「${deleting.name}」を削除します。使用済みの仕訳データは履歴として保持されます。`}
          confirmLabel="削除する"
          onConfirm={async () => {
            const result = await deleteAccount(deleting.id);
            if (result.error) {
              toast(result.error, 'error');
              return;
            }
            toast('科目を削除しました');
          }}
        />
      )}
    </div>
  );
}
