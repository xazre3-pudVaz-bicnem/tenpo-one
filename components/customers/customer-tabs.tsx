import Link from 'next/link';
import { cn } from '@/lib/utils';

export type CustomerView = 'list' | 'rfm' | 'duplicates';

const TABS: { key: CustomerView; label: string; href: string }[] = [
  { key: 'list', label: '顧客一覧', href: '/app/customers' },
  { key: 'rfm', label: 'RFM分析', href: '/app/customers?view=rfm' },
  { key: 'duplicates', label: '重複候補', href: '/app/customers?view=duplicates' },
];

/** /app/customers のタブナビゲーション（一覧 / RFM分析） */
export function CustomerTabs({ active }: { active: CustomerView }) {
  return (
    <div className="mb-5 flex gap-1 rounded-xl border border-gray-200 bg-white p-1">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cn(
            'flex-1 rounded-lg px-4 py-2 text-center text-sm font-medium transition-colors',
            active === t.key ? 'bg-navy text-white' : 'text-gray-600 hover:bg-gray-100'
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
