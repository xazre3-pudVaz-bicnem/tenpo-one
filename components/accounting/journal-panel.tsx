'use client';

import { Fragment, useState } from 'react';
import { Plus, ChevronDown, ChevronRight, Pencil, Trash2, CheckCircle2, Undo2, FileEdit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { yen, formatDate } from '@/lib/format';
import { TAX_TREATMENT_LABELS } from '@/lib/accounting';
import {
  JOURNAL_STATUS_LABELS, JOURNAL_STATUS_TONES, SOURCE_TYPE_LABELS, type JournalStatus, type SourceType,
} from '@/components/accounting/labels';
import { canWriteAccounting } from '@/components/accounting/roles';
import type { Role } from '@/lib/permissions';
import { deleteDraftEntry, postEntry, voidEntry, createCorrectionEntry } from '@/app/app/accounting/actions';
import { JournalEntryDialog, type AccountOption, type StoreOption, type EditingEntry } from './journal-entry-dialog';

export interface JournalLineRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  side: 'debit' | 'credit';
  amount: number;
  taxTreatment: keyof typeof TAX_TREATMENT_LABELS;
  memo: string | null;
}

export interface JournalEntryRow {
  id: string;
  entryNo: number;
  entryDate: string;
  description: string;
  status: JournalStatus;
  sourceType: SourceType;
  storeId: string | null;
  storeName: string | null;
  voidReason: string | null;
  debitTotal: number;
}

export function JournalPanel({
  entries,
  linesByEntry,
  accounts,
  stores,
  role,
}: {
  entries: JournalEntryRow[];
  linesByEntry: Record<string, JournalLineRow[]>;
  accounts: AccountOption[];
  stores: StoreOption[];
  role: Role | null;
}) {
  const canWrite = canWriteAccounting(role);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<JournalEntryRow | null>(null);
  const [deleting, setDeleting] = useState<JournalEntryRow | null>(null);
  const [voiding, setVoiding] = useState<JournalEntryRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { toast } = useToast();

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openEdit = (row: JournalEntryRow) => {
    setEditing(row);
    setDialogOpen(true);
  };
  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const handlePost = async (row: JournalEntryRow) => {
    setBusyId(row.id);
    try {
      const result = await postEntry(row.id);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast('仕訳を確定しました');
    } finally {
      setBusyId(null);
    }
  };

  const handleCorrection = async (row: JournalEntryRow) => {
    setBusyId(row.id);
    try {
      const result = await createCorrectionEntry(row.id);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast('修正仕訳（下書き）を作成しました。一覧から編集・確定してください');
    } finally {
      setBusyId(null);
    }
  };

  const editingEntry: EditingEntry | undefined = editing
    ? {
        id: editing.id,
        entryDate: editing.entryDate,
        description: editing.description,
        storeId: editing.storeId,
        lines: (linesByEntry[editing.id] ?? []).map((l) => ({
          accountId: l.accountId,
          side: l.side,
          amount: l.amount,
          taxTreatment: l.taxTreatment,
          memo: l.memo,
        })),
      }
    : undefined;

  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="flex justify-end">
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            仕訳を作成
          </Button>
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState title="該当する仕訳がありません" description="条件を変更するか、「仕訳を作成」から新しい仕訳を登録してください" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th />
                <Th>仕訳番号</Th>
                <Th>日付</Th>
                <Th>摘要</Th>
                <Th>店舗</Th>
                <Th>区分</Th>
                <Th className="text-right">借方合計</Th>
                <Th>状態</Th>
                {canWrite && <Th className="text-right">操作</Th>}
              </Tr>
            </THead>
            <TBody>
              {entries.map((row) => {
                const isOpen = expanded.has(row.id);
                const lines = linesByEntry[row.id] ?? [];
                return (
                  <Fragment key={row.id}>
                    <Tr className="cursor-pointer" onClick={() => toggle(row.id)}>
                      <Td className="w-8 text-gray-400">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Td>
                      <Td className="font-mono text-xs">#{row.entryNo}</Td>
                      <Td className="whitespace-nowrap text-xs text-gray-500">{formatDate(row.entryDate)}</Td>
                      <Td className="max-w-xs truncate font-medium text-navy">{row.description}</Td>
                      <Td>{row.storeName ?? '全社'}</Td>
                      <Td>
                        <Badge tone="gray">{SOURCE_TYPE_LABELS[row.sourceType]}</Badge>
                      </Td>
                      <Td className="text-right tabular-nums">{yen(row.debitTotal)}</Td>
                      <Td>
                        <Badge tone={JOURNAL_STATUS_TONES[row.status]}>{JOURNAL_STATUS_LABELS[row.status]}</Badge>
                      </Td>
                      {canWrite && (
                        <Td className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            {row.status === 'draft' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEdit(row)}
                                  aria-label="編集"
                                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handlePost(row)}
                                  disabled={busyId === row.id}
                                  aria-label="確定"
                                  className="rounded-lg p-1.5 text-gray-400 hover:bg-success-soft hover:text-success"
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleting(row)}
                                  aria-label="削除"
                                  className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </>
                            )}
                            {row.status === 'posted' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleCorrection(row)}
                                  disabled={busyId === row.id}
                                  aria-label="修正仕訳を作成"
                                  className="rounded-lg p-1.5 text-gray-400 hover:bg-primary-soft hover:text-primary-deep"
                                  title="修正仕訳を作成"
                                >
                                  <FileEdit className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setVoiding(row)}
                                  aria-label="取消"
                                  className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
                                  title="取消"
                                >
                                  <Undo2 className="h-4 w-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </Td>
                      )}
                    </Tr>
                    {isOpen && (
                      <Tr className="bg-gray-50 hover:bg-gray-50">
                        <Td />
                        <Td colSpan={canWrite ? 8 : 7} className="py-3">
                          {row.status === 'voided' && row.voidReason && (
                            <p className="mb-2 text-xs text-danger">取消理由: {row.voidReason}</p>
                          )}
                          {lines.length === 0 ? (
                            <p className="text-xs text-gray-500">明細がありません</p>
                          ) : (
                            <table className="w-full text-xs">
                              <thead className="text-gray-500">
                                <tr>
                                  <th className="px-2 py-1 text-left font-medium">勘定科目</th>
                                  <th className="px-2 py-1 text-right font-medium">借方</th>
                                  <th className="px-2 py-1 text-right font-medium">貸方</th>
                                  <th className="px-2 py-1 text-left font-medium">税区分</th>
                                  <th className="px-2 py-1 text-left font-medium">メモ</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {lines.map((l, idx) => (
                                  <tr key={idx}>
                                    <td className="px-2 py-1">
                                      {l.accountCode} {l.accountName}
                                    </td>
                                    <td className="px-2 py-1 text-right tabular-nums">{l.side === 'debit' ? yen(l.amount) : ''}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">{l.side === 'credit' ? yen(l.amount) : ''}</td>
                                    <td className="px-2 py-1">{TAX_TREATMENT_LABELS[l.taxTreatment]}</td>
                                    <td className="px-2 py-1 text-gray-500">{l.memo ?? ''}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </Td>
                      </Tr>
                    )}
                  </Fragment>
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
      )}

      {dialogOpen && (
        <JournalEntryDialog
          open
          onClose={() => setDialogOpen(false)}
          accounts={accounts}
          stores={stores}
          entry={editingEntry}
          onSaved={() => setDialogOpen(false)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title="仕訳を削除"
          message={`「${deleting.description}」（下書き）を削除します。この操作は取り消せません。`}
          confirmLabel="削除する"
          onConfirm={async () => {
            const result = await deleteDraftEntry(deleting.id);
            if (result.error) {
              toast(result.error, 'error');
              return;
            }
            toast('仕訳を削除しました');
          }}
        />
      )}

      {voiding && (
        <ConfirmDialog
          open
          onClose={() => setVoiding(null)}
          title="仕訳を取消"
          message={`「${voiding.description}」を取消します。取消履歴は保持され、必要に応じて修正仕訳を作成できます。`}
          confirmLabel="取消する"
          requireReason
          onConfirm={async (reason) => {
            const result = await voidEntry(voiding.id, reason);
            if (result.error) {
              toast(result.error, 'error');
              return;
            }
            toast('仕訳を取消しました');
          }}
        />
      )}
    </div>
  );
}
