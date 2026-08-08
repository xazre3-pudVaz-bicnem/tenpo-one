import Link from 'next/link';
import { cn } from '@/lib/utils';

export type LegalRulesTab = 'consumption-tax' | 'legal';

const TABS: { key: LegalRulesTab; label: string }[] = [
  { key: 'consumption-tax', label: '消費税率' },
  { key: 'legal', label: '法定ルール' },
];

/** /admin/legal-rules のタブナビゲーション（searchParams.tab を切り替える） */
export function LegalRulesTabs({ active }: { active: LegalRulesTab }) {
  return (
    <div className="mb-5 flex gap-1 rounded-xl border border-gray-200 bg-white p-1">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.key === 'consumption-tax' ? '/admin/legal-rules' : `/admin/legal-rules?tab=${t.key}`}
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
