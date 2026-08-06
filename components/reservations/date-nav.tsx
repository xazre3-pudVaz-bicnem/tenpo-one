'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { weekdayJa } from '@/lib/format';

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

export function DateNav({ date, basePath }: { date: string; basePath: string }) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-2">
      <Link
        href={`${basePath}?date=${shiftDate(date, -1)}`}
        aria-label="前日"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-navy hover:bg-gray-50"
      >
        <ChevronLeft className="h-4 w-4" />
      </Link>
      <input
        type="date"
        aria-label="日付"
        value={date}
        onChange={(e) => e.target.value && router.push(`${basePath}?date=${e.target.value}`)}
        className="h-9 rounded-lg border border-gray-300 px-2 text-sm"
      />
      <span className="text-xs text-gray-500">（{weekdayJa(date)}）</span>
      <Link
        href={`${basePath}?date=${shiftDate(date, 1)}`}
        aria-label="翌日"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-navy hover:bg-gray-50"
      >
        <ChevronRight className="h-4 w-4" />
      </Link>
      <Link
        href={`${basePath}?date=${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })}`}
        className="ml-1 text-xs font-medium text-primary hover:underline"
      >
        今日
      </Link>
    </div>
  );
}
