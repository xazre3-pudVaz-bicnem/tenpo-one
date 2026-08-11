'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { useQrStrings, useQrLocale, localizedName } from './strings-context';
import { isPublicImageUrl, type QrMenuCategory, type QrMenuItem } from './types';

/** カテゴリタブの先頭に差し込む「おすすめ」擬似カテゴリのID */
const RECOMMENDED_TAB_ID = '__recommended__';

export function MenuView({
  categories,
  onSelectItem,
}: {
  categories: QrMenuCategory[];
  onSelectItem: (item: QrMenuItem) => void;
}) {
  const qrStrings = useQrStrings();
  const locale = useQrLocale();
  const recommendedItems = useMemo(() => categories.flatMap((c) => c.items.filter((i) => i.is_recommended)), [categories]);

  const tabs: QrMenuCategory[] = useMemo(() => {
    if (recommendedItems.length === 0) return categories;
    return [
      { id: RECOMMENDED_TAB_ID, name: qrStrings.menu.recommendedCategoryName, name_en: null, color: '#CA8A04', items: recommendedItems },
      ...categories,
    ];
  }, [categories, recommendedItems, qrStrings.menu.recommendedCategoryName]);

  const [activeId, setActiveId] = useState(tabs[0]?.id ?? '');
  const active = tabs.find((c) => c.id === activeId) ?? tabs[0] ?? null;

  if (tabs.length === 0) {
    return <p className="px-4 py-16 text-center text-sm text-gray-400">{qrStrings.menu.empty}</p>;
  }

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto border-b border-gray-100 bg-white px-3 py-2">
        {tabs.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveId(c.id)}
            className={cn(
              'shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
              active?.id === c.id ? 'text-white' : 'bg-gray-100 text-gray-600'
            )}
            style={active?.id === c.id ? { backgroundColor: c.color ?? '#7B3FF2' } : undefined}
          >
            {c.id === RECOMMENDED_TAB_ID ? c.name : localizedName(locale, c.name, c.name_en)}
          </button>
        ))}
      </div>

      <ul className="divide-y divide-gray-100 bg-white">
        {(active?.items ?? []).length === 0 ? (
          <li className="px-4 py-12 text-center text-sm text-gray-400">{qrStrings.menu.categoryEmpty}</li>
        ) : (
          active!.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={item.is_sold_out}
                onClick={() => onSelectItem(item)}
                className={cn(
                  'flex w-full items-start justify-between gap-3 px-4 py-4 text-left',
                  item.is_sold_out ? 'opacity-50' : 'active:bg-gray-50'
                )}
              >
                <div className="flex min-w-0 gap-3">
                  {isPublicImageUrl(item.image_path) && (
                    // eslint-disable-next-line @next/next/no-img-element -- 匿名向け公開URLのみ許可されるため next/image の最適化対象外
                    <img src={item.image_path} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className={cn('text-sm font-bold', item.is_sold_out ? 'text-gray-400' : 'text-navy')}>
                        {localizedName(locale, item.name, item.name_en)}
                      </p>
                      {item.is_recommended && <Badge tone="warning">{qrStrings.menu.recommendedBadge}</Badge>}
                    </div>
                    {item.description && <p className="mt-0.5 text-xs text-gray-500">{item.description}</p>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {item.is_sold_out ? (
                    <Badge tone="gray">{qrStrings.menu.soldOutBadge}</Badge>
                  ) : (
                    <span className="text-sm font-bold tabular-nums text-primary-deep">{yen(item.price)}</span>
                  )}
                </div>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
