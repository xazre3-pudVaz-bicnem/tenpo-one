'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { Input, Select } from '@/components/ui/input';

interface Option {
  value: string;
  label: string;
}

/** 導入店舗一覧の検索・絞り込み（店舗名/会社名/slug + 環境 + ステージ） */
export function TenantFilters({
  environments,
  stages,
  current,
}: {
  environments: Option[];
  stages: Option[];
  current: { q: string; env: string; stage: string };
}) {
  const router = useRouter();
  const [q, setQ] = useState(current.q);

  const apply = (patch: Partial<{ q: string; env: string; stage: string }>) => {
    const next = { ...current, ...patch };
    const params = new URLSearchParams();
    if (next.q) params.set('q', next.q);
    if (next.env) params.set('env', next.env);
    if (next.stage) params.set('stage', next.stage);
    router.push(`/admin/tenants${params.toString() ? `?${params.toString()}` : ''}`);
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q });
        }}
        className="relative"
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="店舗名・会社名・slug"
          className="w-56 pl-8"
        />
      </form>
      <Select value={current.env} onChange={(e) => apply({ env: e.target.value })} className="w-32">
        <option value="">全環境</option>
        {environments.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </Select>
      <Select value={current.stage} onChange={(e) => apply({ stage: e.target.value })} className="w-36">
        <option value="">全ステージ</option>
        {stages.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </Select>
      {(current.q || current.env || current.stage) && (
        <button type="button" onClick={() => router.push('/admin/tenants')} className="text-xs text-gray-500 hover:underline">
          クリア
        </button>
      )}
    </div>
  );
}
