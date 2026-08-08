'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableWrap, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { yen, formatDate } from '@/lib/format';
import {
  previewSalesJournal,
  createSalesJournalEntriesBySourceIds,
  previewRefundJournal,
  createRefundJournalEntriesBySourceIds,
  previewPurchaseJournal,
  createPurchaseJournalEntries,
  previewExpenseJournal,
  createExpenseJournalEntries,
  previewPettyCashJournal,
  createPettyCashJournalEntries,
  previewPayrollJournal,
  createPayrollJournalEntries,
} from '@/app/app/accounting/auto/actions';
import type { AutoSourceType, CreateResult, JournalCandidateView } from '@/app/app/accounting/auto/engine';
import { SOURCE_TYPE_TONES } from '@/components/accounting/labels';

async function loadCandidates(sourceType: AutoSourceType, range: { from: string; to: string }): Promise<JournalCandidateView[]> {
  switch (sourceType) {
    case 'pos_sales':
      return previewSalesJournal(range.from, range.to);
    case 'pos_refund':
      return previewRefundJournal(range.from, range.to);
    case 'purchase':
      return previewPurchaseJournal();
    case 'expense':
      return previewExpenseJournal();
    case 'petty_cash':
      return previewPettyCashJournal();
    case 'payroll':
      return previewPayrollJournal();
  }
}

async function createSelected(sourceType: AutoSourceType, keys: string[], post: boolean): Promise<CreateResult> {
  switch (sourceType) {
    case 'pos_sales':
      return createSalesJournalEntriesBySourceIds(keys, post);
    case 'pos_refund':
      return createRefundJournalEntriesBySourceIds(keys, post);
    case 'purchase':
      return createPurchaseJournalEntries(keys, post);
    case 'expense':
      return createExpenseJournalEntries(keys, post);
    case 'petty_cash':
      return createPettyCashJournalEntries(keys, post);
    case 'payroll':
      return createPayrollJournalEntries(keys, post);
  }
}

export function AutoSourceCard({
  sourceType,
  title,
  hint,
  pendingCount,
  pendingTotal,
  range,
}: {
  sourceType: AutoSourceType;
  title: string;
  hint: string;
  pendingCount: number;
  pendingTotal: number;
  range: { from: string; to: string };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [candidates, setCandidates] = useState<JournalCandidateView[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, startLoading] = useTransition();
  const [creating, startCreating] = useTransition();

  const creatable = (candidates ?? []).filter((c) => !c.alreadyPosted && c.balanced);

  function generate() {
    setExpanded(true);
    startLoading(async () => {
      try {
        const rows = await loadCandidates(sourceType, range);
        setCandidates(rows);
        setSelected(new Set(rows.filter((r) => !r.alreadyPosted && r.balanced).map((r) => r.sourceId)));
      } catch (err) {
        toast(err instanceof Error ? err.message : '候補の生成に失敗しました', 'error');
      }
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(creatable.map((c) => c.sourceId)) : new Set());
  }

  function toggleOne(sourceId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(sourceId);
      else next.delete(sourceId);
      return next;
    });
  }

  function handleCreate(post: boolean) {
    const keys = [...selected];
    if (keys.length === 0) {
      toast('作成する仕訳を選択してください', 'error');
      return;
    }
    startCreating(async () => {
      try {
        const result = await createSelected(sourceType, keys, post);
        const parts = [`作成 ${result.ok}件`];
        if (result.skipped > 0) parts.push(`スキップ（作成済み） ${result.skipped}件`);
        if (result.failed.length > 0) parts.push(`失敗 ${result.failed.length}件`);
        toast(parts.join(' / '), result.failed.length > 0 ? 'warning' : 'success');
        const rows = await loadCandidates(sourceType, range);
        setCandidates(rows);
        setSelected(new Set(rows.filter((r) => !r.alreadyPosted && r.balanced).map((r) => r.sourceId)));
        router.refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : '仕訳の作成に失敗しました', 'error');
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle>{title}</CardTitle>
            {SOURCE_TYPE_TONES[sourceType] && <Badge tone={SOURCE_TYPE_TONES[sourceType]}>マイナス計上</Badge>}
          </div>
          <p className="mt-1 text-xs text-gray-500">{hint}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-gray-500">対象</p>
            <p className="text-sm font-semibold text-navy">
              {pendingCount}件 ・ {yen(pendingTotal)}
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={generate} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            候補を生成
          </Button>
          <button
            type="button"
            aria-label={expanded ? '閉じる' : '開く'}
            onClick={() => setExpanded((v) => !v)}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent>
          {loading && !candidates ? (
            <div className="flex items-center justify-center py-10 text-sm text-gray-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 候補を集計しています…
            </div>
          ) : candidates === null ? (
            <p className="text-sm text-gray-500">「候補を生成」を押すと、選択中の期間・対象データから仕訳候補を計算します。</p>
          ) : candidates.length === 0 ? (
            <EmptyState title="対象データはありません" description="この区分で仕訳が必要な未処理データはありませんでした。" />
          ) : (
            <div className="space-y-3">
              <TableWrap>
                <Table>
                  <THead>
                    <Tr>
                      <Th>
                        <input
                          type="checkbox"
                          checked={creatable.length > 0 && selected.size === creatable.length}
                          onChange={(e) => toggleAll(e.target.checked)}
                          aria-label="すべて選択"
                        />
                      </Th>
                      <Th>日付</Th>
                      <Th>摘要</Th>
                      <Th>店舗</Th>
                      <Th>仕訳明細</Th>
                      <Th className="text-right">金額</Th>
                      <Th>状態</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {candidates.map((c) => (
                      <Tr key={c.key}>
                        <Td>
                          <input
                            type="checkbox"
                            checked={selected.has(c.sourceId)}
                            disabled={c.alreadyPosted || !c.balanced}
                            onChange={(e) => toggleOne(c.sourceId, e.target.checked)}
                            aria-label={`${c.description}を選択`}
                          />
                        </Td>
                        <Td className="whitespace-nowrap">{c.date !== '—' ? formatDate(c.date) : '—'}</Td>
                        <Td className="max-w-[220px] truncate">{c.description}</Td>
                        <Td className="whitespace-nowrap">{c.storeName ?? '全社'}</Td>
                        <Td>
                          <ul className="space-y-0.5 text-xs">
                            {c.lines.map((l, i) => (
                              <li key={i} className="whitespace-nowrap">
                                <span className={l.side === 'debit' ? 'text-primary-deep' : 'text-gray-600'}>
                                  {l.side === 'debit' ? '借方' : '貸方'} {l.accountName}
                                </span>{' '}
                                <span className="tabular-nums font-medium">{yen(l.amount)}</span>
                              </li>
                            ))}
                          </ul>
                        </Td>
                        <Td className="text-right tabular-nums">{yen(c.debit)}</Td>
                        <Td>
                          <div className="flex flex-col items-start gap-1">
                            {c.alreadyPosted && <Badge tone="gray">作成済み</Badge>}
                            {!c.balanced && <Badge tone="danger">貸借不一致</Badge>}
                            {c.warning && <span className="text-xs text-warning">{c.warning}</span>}
                          </div>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>

              <div className="rounded-xl border border-primary/20 bg-primary-soft px-4 py-3 text-xs text-primary-deep">
                自動仕訳はプレビューで確認してから確定してください。確定後の修正は修正仕訳で行います。
              </div>

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
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
