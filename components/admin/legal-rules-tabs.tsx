import Link from 'next/link';
import { cn } from '@/lib/utils';
import { RULE_CATEGORIES, RULE_CATEGORY_LABELS, type RuleCategory } from '@/app/admin/legal-rules/schema';

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

/**
 * 「法定ルール」タブ内の区分フィルタ（#15）。rule_type（DB enum）をRULE_TYPE_TO_CATEGORYで
 * まとめた7区分（所得税・健康保険・厚生年金・介護保険・雇用保険・割増率・その他）+「すべて」。
 */
export function LegalRuleCategoryFilter({ active }: { active: RuleCategory | 'all' }) {
  const items: { key: RuleCategory | 'all'; label: string }[] = [
    { key: 'all', label: 'すべて' },
    ...RULE_CATEGORIES.map((c) => ({ key: c, label: RULE_CATEGORY_LABELS[c] })),
  ];
  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.key === 'all' ? '/admin/legal-rules?tab=legal' : `/admin/legal-rules?tab=legal&category=${item.key}`}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            active === item.key
              ? 'border-navy bg-navy text-white'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
