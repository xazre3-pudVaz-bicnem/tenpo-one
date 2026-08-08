'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const TYPE_OPTIONS = [
  { value: 'full_time', label: '正社員' },
  { value: 'contract', label: '契約社員' },
  { value: 'part_time', label: 'アルバイト・パート' },
  { value: 'outsourced', label: '業務委託' },
];

export function EmployeeFilters({ current }: { current: { q: string; type: string } }) {
  const router = useRouter();
  const [q, setQ] = useState(current.q);

  const applyQuery = () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (current.type) params.set('type', current.type);
    const qs = params.toString();
    router.push(qs ? `/app/employees?${qs}` : '/app/employees');
  };

  const updateType = (type: string) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (type) params.set('type', type);
    const qs = params.toString();
    router.push(qs ? `/app/employees?${qs}` : '/app/employees');
  };

  return (
    <div className="mt-4 flex flex-wrap gap-3">
      <div className="flex w-64 gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyQuery()}
          placeholder="氏名・社員番号で検索"
          aria-label="従業員検索"
        />
        <Button variant="secondary" size="md" onClick={applyQuery} aria-label="検索">
          <Search className="h-4 w-4" />
        </Button>
      </div>
      <div className="w-48">
        <Select value={current.type} onChange={(e) => updateType(e.target.value)} aria-label="雇用区分で絞込">
          <option value="">すべての雇用区分</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
