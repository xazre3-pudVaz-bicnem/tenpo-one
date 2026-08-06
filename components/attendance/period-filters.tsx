'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui/input';

/** 勤怠一覧の月選択・スタッフ絞込（URLクエリと同期） */
export function PeriodFilters({
  month,
  staffId,
  staffOptions,
}: {
  month: string;
  staffId: string;
  staffOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const pushParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.set('tab', 'list');
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="month"
        aria-label="対象月"
        value={month}
        onChange={(e) => pushParam('month', e.target.value)}
        className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-primary focus:outline-2 focus:outline-primary/30"
      />
      {staffOptions.length > 0 && (
        <Select
          aria-label="スタッフ絞込"
          className="w-40"
          value={staffId}
          onChange={(e) => pushParam('staffId', e.target.value)}
        >
          <option value="">スタッフ全員</option>
          {staffOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
