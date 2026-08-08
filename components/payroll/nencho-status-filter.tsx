'use client';

import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui/input';

const STATUS_OPTIONS = [
  { value: 'submitted', label: '提出済み' },
  { value: 'reviewing', label: '確認中' },
  { value: 'needs_fix', label: '要修正' },
  { value: 'confirmed', label: '確認済み' },
];

export function NenchoStatusFilter({ year, current }: { year: number; current: string }) {
  const router = useRouter();

  const update = (status: string) => {
    const params = new URLSearchParams();
    params.set('year', String(year));
    if (status) params.set('status', status);
    router.push(`/app/payroll/nencho?${params.toString()}`);
  };

  return (
    <div className="w-40">
      <Select value={current} onChange={(e) => update(e.target.value)} aria-label="状態で絞込">
        <option value="">すべての状態</option>
        {STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
