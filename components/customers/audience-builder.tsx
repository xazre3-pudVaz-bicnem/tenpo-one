'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus, Trash2, ListFilter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, Input } from '@/components/ui/input';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { yen, formatDate } from '@/lib/format';
import {
  AUDIENCE_FIELD_LABELS,
  matchesAudience,
  type AudienceCondition,
  type AudienceField,
  type AudienceOp,
  type CustomerMetrics,
} from '@/lib/crm';

export interface AudienceCustomerRow {
  id: string;
  name: string;
  phone: string | null;
  visitCount: number;
  totalSpent: number;
  cancelCount: number;
  noShowCount: number;
  lastVisitAt: string | null;
  pointBalance: number;
}

const OP_LABELS: Record<AudienceOp, string> = { gte: '以上', lte: '以下', eq: '等しい' };
const OPS: AudienceOp[] = ['gte', 'lte', 'eq'];
const FIELDS = Object.keys(AUDIENCE_FIELD_LABELS) as AudienceField[];

function encodeConditions(conditions: AudienceCondition[]): string {
  return btoa(encodeURIComponent(JSON.stringify(conditions)));
}

function decodeConditions(raw: string | null): AudienceCondition[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(atob(raw)));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is AudienceCondition =>
        !!c &&
        typeof c === 'object' &&
        FIELDS.includes(c.field) &&
        OPS.includes(c.op) &&
        typeof c.value === 'number' &&
        Number.isFinite(c.value)
    );
  } catch {
    return [];
  }
}

/**
 * 条件ビルダー（campaignAudience）: 顧客一覧に読み込まれている顧客（取得済み分）に対し
 * lib/crm.ts の matchesAudience をクライアントで適用する。条件はURLの ?aud= に保存し、
 * 再読み込み・共有時にも再現できるようにする。
 */
export function AudienceBuilder({ customers }: { customers: AudienceCustomerRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const audParam = searchParams.get('aud');

  // 初回マウント時にURLの ?aud= から条件を復元する（以降のURL変更はこのコンポーネント自身の操作からのみ発生するため再同期は不要）
  const [conditions, setConditions] = useState<AudienceCondition[]>(() => decodeConditions(audParam));
  const [open, setOpen] = useState<boolean>(() => decodeConditions(audParam).length > 0);

  const syncUrl = (next: AudienceCondition[]) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.length > 0) params.set('aud', encodeConditions(next));
    else params.delete('aud');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const updateConditions = (next: AudienceCondition[]) => {
    setConditions(next);
    syncUrl(next);
  };

  const addRow = () => updateConditions([...conditions, { field: 'visit_count', op: 'gte', value: 1 }]);
  const removeRow = (idx: number) => updateConditions(conditions.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<AudienceCondition>) =>
    updateConditions(conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const now = useMemo(() => new Date(), []);
  const matched = useMemo(() => {
    if (conditions.length === 0) return [];
    return customers.filter((c) => {
      const metrics: CustomerMetrics & { pointBalance?: number } = {
        visitCount: c.visitCount,
        totalSpent: c.totalSpent,
        cancelCount: c.cancelCount,
        noShowCount: c.noShowCount,
        firstVisitAt: null,
        lastVisitAt: c.lastVisitAt ? new Date(c.lastVisitAt) : null,
        pointBalance: c.pointBalance,
      };
      return matchesAudience(metrics, conditions, now);
    });
  }, [customers, conditions, now]);

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-navy"
      >
        <span className="inline-flex items-center gap-2">
          <ListFilter className="h-4 w-4 text-gray-400" />
          条件で絞り込む
          {conditions.length > 0 && (
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary-deep">
              {conditions.length}件の条件・{matched.length}人が一致
            </span>
          )}
        </span>
        <span className="text-xs text-gray-400">{open ? '閉じる' : '開く'}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-4">
          <div className="space-y-2">
            {conditions.map((c, idx) => (
              <div key={idx} className="flex flex-wrap items-center gap-2">
                <Select
                  aria-label="絞込項目"
                  value={c.field}
                  onChange={(e) => updateRow(idx, { field: e.target.value as AudienceField })}
                  className="w-auto min-w-[160px]"
                >
                  {FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {AUDIENCE_FIELD_LABELS[f]}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="比較条件"
                  value={c.op}
                  onChange={(e) => updateRow(idx, { op: e.target.value as AudienceOp })}
                  className="w-auto min-w-[100px]"
                >
                  {OPS.map((op) => (
                    <option key={op} value={op}>
                      {OP_LABELS[op]}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label="値"
                  type="number"
                  value={c.value}
                  onChange={(e) => updateRow(idx, { value: Number(e.target.value) })}
                  className="w-28"
                />
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  aria-label="この条件を削除"
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {conditions.length === 0 && <p className="text-xs text-gray-400">条件がありません。「条件を追加」から始めてください。</p>}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={addRow}>
              <Plus className="h-3.5 w-3.5" />
              条件を追加（AND）
            </Button>
            {conditions.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => updateConditions([])}>
                条件をクリア
              </Button>
            )}
          </div>

          <p className="mt-3 text-xs text-gray-500">
            この条件は将来のLINE/メール配信の抽出条件（campaignAudience）としてそのまま利用されます。条件はURLに保存され、共有・再現できます。
            現在この画面に読み込まれている顧客（最大{customers.length.toLocaleString('ja-JP')}件）に対して適用されます。
          </p>

          {conditions.length > 0 && (
            <div className="mt-4">
              {matched.length === 0 ? (
                <EmptyState title="条件に一致する顧客がいません" className="border-0 py-8" />
              ) : (
                <TableWrap>
                  <Table>
                    <THead>
                      <Tr>
                        <Th>名前</Th>
                        <Th>電話</Th>
                        <Th className="text-right">来店回数</Th>
                        <Th className="text-right">累計利用額</Th>
                        <Th className="text-right">ポイント残高</Th>
                        <Th>最終来店</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {matched.map((c) => (
                        <Tr key={c.id}>
                          <Td>
                            <Link href={`/app/customers/${c.id}`} className="font-medium text-navy hover:text-primary hover:underline">
                              {c.name}
                            </Link>
                          </Td>
                          <Td className="text-gray-600">{c.phone || '—'}</Td>
                          <Td className="text-right tabular-nums">{c.visitCount}回</Td>
                          <Td className="text-right tabular-nums">{yen(c.totalSpent)}</Td>
                          <Td className="text-right tabular-nums">{c.pointBalance.toLocaleString('ja-JP')}pt</Td>
                          <Td className="text-gray-600">{c.lastVisitAt ? formatDate(c.lastVisitAt) : '—'}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
