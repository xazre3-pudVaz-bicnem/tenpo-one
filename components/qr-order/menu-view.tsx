'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import type { QrMenuCategory, QrMenuItem } from './types';

export function MenuView({
  categories,
  onSelectItem,
}: {
  categories: QrMenuCategory[];
  onSelectItem: (item: QrMenuItem) => void;
}) {
  const [activeId, setActiveId] = useState(categories[0]?.id ?? '');
  const active = categories.find((c) => c.id === activeId) ?? categories[0] ?? null;

  if (categories.length === 0) {
    return (
      <p className="px-4 py-16 text-center text-sm text-gray-400">
        現在ご注文いただけるメニューがありません。店員にお声がけください。
      </p>
    );
  }

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto border-b border-gray-100 bg-white px-3 py-2">
        {categories.map((c) => (
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
            {c.name}
          </button>
        ))}
      </div>

      <ul className="divide-y divide-gray-100 bg-white">
        {(active?.items ?? []).length === 0 ? (
          <li className="px-4 py-12 text-center text-sm text-gray-400">このカテゴリに商品がありません</li>
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
                <div className="min-w-0">
                  <p className={cn('text-sm font-bold', item.is_sold_out ? 'text-gray-400' : 'text-navy')}>
                    {item.name}
                  </p>
                  {item.description && <p className="mt-0.5 text-xs text-gray-500">{item.description}</p>}
                </div>
                <div className="shrink-0 text-right">
                  {item.is_sold_out ? (
                    <Badge tone="gray">品切れ</Badge>
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
