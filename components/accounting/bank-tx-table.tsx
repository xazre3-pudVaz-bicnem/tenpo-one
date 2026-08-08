'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Table, TableWrap, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { yen, formatDate } from '@/lib/format';
import { createJournalFromBankTransactions } from '@/app/app/accounting/banks/actions';

export interface BankTxRow {
  id: string;
  date: string;
  description: string;
  deposit: number;
  withdrawal: number;
  runningBalance: number;
  journalEntryId: string | null;
}

export interface AccountOption {
  id: string;
  code: string;
  name: string;
}

const DEFAULT_DEPOSIT_CODE = '130'; // 売掛金（回収）
const DEFAULT_WITHDRAWAL_CODE = '599'; // 雑費

export function BankTxTable({
  bankAccountId,
  rows,
  accountOptions,
}: {
  bankAccountId: string;
  rows: BankTxRow[];
  accountOptions: AccountOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [creating, startCreating] = useTransition();

  const codeToId = useMemo(() => new Map(accountOptions.map((a) => [a.code, a.id])), [accountOptions]);
  const defaultAccountId = (deposit: number) => {
    const code = deposit > 0 ? DEFAULT_DEPOSIT_CODE : DEFAULT_WITHDRAWAL_CODE;
    return codeToId.get(code) ?? accountOptions[0]?.id ?? '';
  };

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [accountByTx, setAccountByTx] = useState<Record<string, string>>(
    Object.fromEntries(rows.filter((r) => !r.journalEntryId).map((r) => [r.id, defaultAccountId(r.deposit)]))
  );
  const [bulkAccountId, setBulkAccountId] = useState('');

  const pendingRows = rows.filter((r) => !r.journalEntryId);

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(pendingRows.map((r) => r.id)) : new Set());
  }
  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function applyBulkAccount() {
    if (!bulkAccountId || selected.size === 0) return;
    setAccountByTx((prev) => {
      const next = { ...prev };
      for (const id of selected) next[id] = bulkAccountId;
      return next;
    });
  }

  function handleCreate(post: boolean) {
    const items = [...selected]
      .map((id) => ({ transactionId: id, accountId: accountByTx[id] }))
      .filter((i) => !!i.accountId);
    if (items.length === 0) {
      toast('勘定科目を選択した取引をチェックしてください', 'error');
      return;
    }
    startCreating(async () => {
      try {
        const result = await createJournalFromBankTransactions(bankAccountId, items, post);
        const parts = [`作成 ${result.ok}件`];
        if (result.skipped > 0) parts.push(`スキップ（作成済み） ${result.skipped}件`);
        if (result.failed.length > 0) parts.push(`失敗 ${result.failed.length}件`);
        toast(parts.join(' / '), result.failed.length > 0 ? 'warning' : 'success');
        setSelected(new Set());
        router.refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : '仕訳の作成に失敗しました', 'error');
      }
    });
  }

  if (rows.length === 0) {
    return <EmptyState title="取引がありません" description="CSV取込または手入力で取引を登録してください。" />;
  }

  return (
    <div className="space-y-3">
      {pendingRows.length > 0 && accountOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <span className="text-xs font-medium text-gray-600">選択行に一括適用:</span>
          <Select value={bulkAccountId} onChange={(e) => setBulkAccountId(e.target.value)} className="w-56">
            <option value="">勘定科目を選択</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </Select>
          <Button type="button" variant="secondary" size="sm" onClick={applyBulkAccount} disabled={!bulkAccountId || selected.size === 0}>
            適用
          </Button>
        </div>
      )}

      <TableWrap>
        <Table>
          <THead>
            <Tr>
              <Th>
                <input
                  type="checkbox"
                  checked={pendingRows.length > 0 && selected.size === pendingRows.length}
                  onChange={(e) => toggleAll(e.target.checked)}
                  aria-label="すべて選択"
                />
              </Th>
              <Th>日付</Th>
              <Th>摘要</Th>
              <Th className="text-right">入金</Th>
              <Th className="text-right">出金</Th>
              <Th className="text-right">残高</Th>
              <Th>仕訳</Th>
              <Th>対応科目</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td>
                  {!r.journalEntryId && (
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={(e) => toggleOne(r.id, e.target.checked)}
                      aria-label={`${r.description}を選択`}
                    />
                  )}
                </Td>
                <Td className="whitespace-nowrap">{formatDate(r.date)}</Td>
                <Td className="max-w-[240px] truncate">{r.description}</Td>
                <Td className="text-right tabular-nums">{r.deposit > 0 ? yen(r.deposit) : '—'}</Td>
                <Td className="text-right tabular-nums">{r.withdrawal > 0 ? yen(r.withdrawal) : '—'}</Td>
                <Td className="text-right tabular-nums">{yen(r.runningBalance)}</Td>
                <Td>
                  {r.journalEntryId ? (
                    <Link href={`/app/accounting?entry=${r.journalEntryId}`} className="inline-flex items-center gap-1 text-xs text-primary-deep hover:underline">
                      <Badge tone="success">作成済み</Badge>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  ) : (
                    <Badge tone="gray">未作成</Badge>
                  )}
                </Td>
                <Td>
                  {!r.journalEntryId &&
                    (accountOptions.length > 0 ? (
                      <Select
                        value={accountByTx[r.id] ?? ''}
                        onChange={(e) => setAccountByTx((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        className="w-48"
                      >
                        <option value="">選択してください</option>
                        {accountOptions.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} {a.name}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="text-xs text-gray-400">勘定科目未導入</span>
                    ))}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>

      {pendingRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-600">{selected.size}件を選択中</p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => handleCreate(false)} disabled={creating || selected.size === 0}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              下書き作成
            </Button>
            <Button type="button" onClick={() => handleCreate(true)} disabled={creating || selected.size === 0}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              作成して確定
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
