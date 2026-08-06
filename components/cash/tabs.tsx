import Link from 'next/link';
import { cn } from '@/lib/utils';

export type CashTab = 'register' | 'petty' | 'closings';

const TABS: { key: CashTab; label: string }[] = [
  { key: 'register', label: 'レジ' },
  { key: 'petty', label: '小口現金' },
  { key: 'closings', label: '締め履歴' },
];

/** /app/cash のタブナビゲーション（searchParams.tab を切り替える） */
export function CashTabs({ active }: { active: CashTab }) {
  return (
    <div className="mb-5 flex gap-1 rounded-xl border border-gray-200 bg-white p-1">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/app/cash?tab=${t.key}`}
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
