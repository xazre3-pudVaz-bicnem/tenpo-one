'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpDown, Download } from 'lucide-react';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';
import { yen } from '@/lib/format';

export interface StoreRankingRow {
  id: string;
  name: string;
  sales: number;
  grossProfit: number;
  profit: number;
  guests: number;
  avgSpend: number;
  changePct: number | null;
}

type SortKey = 'sales' | 'profit' | 'guests' | 'avgSpend' | 'changePct';

const SORT_LABEL: Record<SortKey, string> = {
  sales: '売上',
  profit: '利益',
  guests: '客数',
  avgSpend: '客単価',
  changePct: '前月比',
};

const TOP_N = 20;

function SortHeader({
  label,
  sortKeyValue,
  activeKey,
  onToggle,
}: {
  label: string;
  sortKeyValue: SortKey;
  activeKey: SortKey;
  onToggle: (key: SortKey) => void;
}) {
  return (
    <button type="button" onClick={() => onToggle(sortKeyValue)} className="inline-flex items-center gap-1 font-medium hover:text-navy">
      {label}
      <ArrowUpDown className={`h-3 w-3 ${activeKey === sortKeyValue ? 'text-primary' : 'text-gray-300'}`} />
    </button>
  );
}

export function StoreRankingTable({
  rows,
  monthFrom,
  today,
  exportHref,
}: {
  rows: StoreRankingRow[];
  monthFrom: string;
  today: string;
  exportHref: string;
}) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('sales');
  const [sortDesc, setSortDesc] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim();
    return q ? rows.filter((r) => r.name.includes(q)) : rows;
  }, [rows, query]);

  const sorted = useMemo(() => {
    const list = [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return sortDesc ? bv - av : av - bv;
    });
    return list;
  }, [filtered, sortKey, sortDesc]);

  const display = showAll ? sorted : sorted.slice(0, TOP_N);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="店舗名で検索"
          className="w-56"
        />
        <a href={exportHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          <Download className="h-3.5 w-3.5" />
          CSV出力
        </a>
      </div>

      {display.length === 0 ? (
        <EmptyState title="該当する店舗がありません" className="border-0 py-8" />
      ) : (
        <TableWrap className="border-0">
          <Table>
            <THead>
              <Tr>
                <Th>店舗</Th>
                <Th className="text-right">
                  <SortHeader label="売上" sortKeyValue="sales" activeKey={sortKey} onToggle={toggleSort} />
                </Th>
                <Th className="text-right">
                  <SortHeader label="前月同期間比" sortKeyValue="changePct" activeKey={sortKey} onToggle={toggleSort} />
                </Th>
                <Th className="text-right">粗利益</Th>
                <Th className="text-right">
                  <SortHeader label="利益" sortKeyValue="profit" activeKey={sortKey} onToggle={toggleSort} />
                </Th>
                <Th className="text-right">
                  <SortHeader label="客数" sortKeyValue="guests" activeKey={sortKey} onToggle={toggleSort} />
                </Th>
                <Th className="text-right">
                  <SortHeader label="客単価" sortKeyValue="avgSpend" activeKey={sortKey} onToggle={toggleSort} />
                </Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {display.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <Link href={`/app/reports?store=${s.id}&from=${monthFrom}&to=${today}`} className="font-medium text-primary hover:underline">
                      {s.name}
                    </Link>
                  </Td>
                  <Td className="text-right tabular-nums font-semibold text-navy">{yen(s.sales)}</Td>
                  <Td className="text-right tabular-nums">
                    {s.changePct == null ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <span className={s.changePct >= 0 ? 'text-success' : 'text-danger'}>
                        {s.changePct >= 0 ? '+' : ''}
                        {s.changePct.toFixed(1)}%
                      </span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{yen(s.grossProfit)}</Td>
                  <Td className={`text-right tabular-nums font-medium ${s.profit >= 0 ? 'text-success' : 'text-danger'}`}>{yen(s.profit)}</Td>
                  <Td className="text-right tabular-nums">{s.guests}名</Td>
                  <Td className="text-right tabular-nums">{yen(s.avgSpend)}</Td>
                  <Td>
                    <Link href={`/app/reports?store=${s.id}&from=${monthFrom}&to=${today}`} className="text-xs font-medium text-primary hover:underline whitespace-nowrap">
                      レポートを見る
                    </Link>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}

      {sorted.length > TOP_N && (
        <div className="mt-2 flex justify-center">
          <Button size="sm" variant="secondary" onClick={() => setShowAll((v) => !v)}>
            {showAll ? `上位${TOP_N}件のみ表示` : `すべて表示（${sorted.length}件）`}
          </Button>
        </div>
      )}
      <p className="mt-1.5 text-xs text-gray-400">
        並び順「{SORT_LABEL[sortKey]}」{sortDesc ? '降順' : '昇順'}。利益 = 売上 − 原価 − 人件費（概算） − 経費。前月同期間比は選択期間と同じ日数の直前期間との比較です。
      </p>
    </div>
  );
}
