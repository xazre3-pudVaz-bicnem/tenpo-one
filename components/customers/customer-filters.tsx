'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input, Select } from '@/components/ui/input';
import { SEGMENT_LABELS, type CustomerSegment } from '@/lib/crm';

export interface CustomerTagOption {
  id: string;
  name: string;
}

export function CustomerFilters({
  basePath,
  tags,
  initial,
}: {
  basePath: string;
  tags: CustomerTagOption[];
  initial: {
    q: string;
    tag: string;
    segment: string;
    sort: string;
  };
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);
  const [, startTransition] = useTransition();

  const apply = (next: Partial<{ q: string; tag: string; segment: string; sort: string }>) => {
    const params = new URLSearchParams();
    const merged = { ...initial, q, ...next };
    if (merged.q.trim()) params.set('q', merged.q.trim());
    if (merged.tag) params.set('tag', merged.tag);
    if (merged.segment) params.set('segment', merged.segment);
    if (merged.sort && merged.sort !== 'last_visit_desc') params.set('sort', merged.sort);
    startTransition(() => {
      router.push(`${basePath}${params.toString() ? `?${params.toString()}` : ''}`);
    });
  };

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="min-w-[220px] flex-1">
        <label htmlFor="customer-search" className="mb-1 block text-sm font-medium text-gray-700">
          名前・カナ・電話で検索
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            id="customer-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply({ q });
            }}
            onBlur={() => apply({ q })}
            placeholder="山田 / ヤマダ / 090..."
            className="pl-9"
          />
        </div>
      </div>

      <div>
        <label htmlFor="customer-tag" className="mb-1 block text-sm font-medium text-gray-700">
          タグ
        </label>
        <Select
          id="customer-tag"
          value={initial.tag}
          onChange={(e) => apply({ tag: e.target.value })}
          className="min-w-[160px]"
        >
          <option value="">すべてのタグ</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label htmlFor="customer-segment" className="mb-1 block text-sm font-medium text-gray-700">
          セグメント
        </label>
        <Select
          id="customer-segment"
          value={initial.segment}
          onChange={(e) => apply({ segment: e.target.value })}
          className="min-w-[200px]"
        >
          <option value="">すべて</option>
          {(Object.entries(SEGMENT_LABELS) as [CustomerSegment, { label: string }][]).map(([key, info]) => (
            <option key={key} value={key}>
              {info.label}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label htmlFor="customer-sort" className="mb-1 block text-sm font-medium text-gray-700">
          並び替え
        </label>
        <Select
          id="customer-sort"
          value={initial.sort}
          onChange={(e) => apply({ sort: e.target.value })}
          className="min-w-[180px]"
        >
          <option value="last_visit_desc">最終来店が新しい順</option>
          <option value="last_visit_asc">最終来店が古い順</option>
          <option value="total_spent_desc">累計利用額が多い順</option>
          <option value="visit_count_desc">来店回数が多い順</option>
        </Select>
      </div>
    </div>
  );
}
