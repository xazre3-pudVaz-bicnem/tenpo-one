'use client';

import { useMemo, useState, useTransition } from 'react';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import {
  soldOutCount,
  soldOutSections,
  type SoldOutCategory,
  type SoldOutFilter,
  type SoldOutItem,
} from '@/lib/sold-out';
import { setItemSoldOut } from '@/app/app/pos/sold-out-actions';

/**
 * 品切れ（売切）の設定（ハンディ・レジ共通）。商品ごとに「売切にする」「販売再開」を切り替える。
 * 売切の商品はレジ・ハンディ・お客様QRで注文できなくなる（2026-09-21 店舗要望）。
 */
export function SoldOutBoard({
  categories,
  items: initialItems,
  canManageShared,
}: {
  categories: SoldOutCategory[];
  items: SoldOutItem[];
  /** 全店共通の商品も切り替えられるか（店長以上） */
  canManageShared: boolean;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState(initialItems);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SoldOutFilter>('all');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const sections = useMemo(() => soldOutSections(categories, items, { query, filter }), [categories, items, query, filter]);
  const count = soldOutCount(items);

  const toggle = (item: SoldOutItem) => {
    if (pendingId) return;
    if (item.shared && !canManageShared) {
      toast('全店共通の商品は、店長以上がメニュー編集で売切にしてください', 'warning');
      return;
    }
    const next = !item.isSoldOut;
    setPendingId(item.id);
    startTransition(async () => {
      try {
        const result = await setItemSoldOut(item.id, next);
        if (result.error) {
          toast(result.error, 'error');
          return;
        }
        setItems((list) => list.map((i) => (i.id === item.id ? { ...i, isSoldOut: next } : i)));
        toast(next ? `「${item.name}」を売切にしました` : `「${item.name}」の販売を再開しました`);
      } catch {
        toast('通信に失敗しました。もう一度押してください', 'error');
      } finally {
        setPendingId(null);
      }
    });
  };

  return (
    <div className="pb-6">
      <div className="space-y-2 px-3 pt-3 pb-2">
        <label className="relative block">
          <span className="sr-only">商品名で探す</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#a69bbb]" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="商品名で探す"
            className="h-11 w-full rounded-lg border border-[#e3dbf1] bg-white pr-3 pl-9 text-sm text-[#2a2138] outline-none focus:border-[#7b3fe4]"
          />
        </label>
        <div className="flex gap-2" role="group" aria-label="表示する商品">
          {(
            [
              ['all', `すべて（${items.length}）`],
              ['soldOut', `売切中だけ（${count}）`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                'min-h-10 rounded-full border px-4 text-sm font-bold',
                filter === value ? 'border-[#7b3fe4] bg-[#7b3fe4] text-white' : 'border-[#e3dbf1] bg-white text-[#5e5470]'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-[#7a7090]">
          売切にした商品は、レジ・ハンディ・お客様QRで注文できなくなります。入荷したら「販売再開」を押してください。
        </p>
      </div>

      {sections.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-[#7a7090]">
          {filter === 'soldOut' && !query ? '売切中の商品はありません' : '該当する商品がありません'}
        </p>
      ) : (
        sections.map((section) => (
          <section key={section.id} className="mt-2">
            <h2 className="sticky top-0 z-10 bg-[#f6f3fb]/95 px-3 py-1.5 text-xs font-bold tracking-wide text-[#5e5470] backdrop-blur">
              {section.name}
            </h2>
            <ul className="mx-3 divide-y divide-[#eee8f6] overflow-hidden rounded-xl border border-[#e3dbf1] bg-white">
              {section.items.map((item) => {
                const busy = pendingId === item.id;
                return (
                  <li
                    key={item.id}
                    className={cn('flex min-h-[56px] items-center gap-3 px-3 py-2', item.isSoldOut && 'bg-[#fdf1ef]')}
                  >
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-sm font-bold break-words text-[#2a2138]', item.isSoldOut && 'text-[#9b3a2a]')}>
                        {item.name}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[#7a7090]">
                        <span className="tabular-nums">{yen(item.price)}</span>
                        {item.isSoldOut && (
                          <span className="rounded bg-[#b3341f] px-1.5 py-0.5 text-[10px] font-bold text-white">売切中</span>
                        )}
                        {item.shared && <span className="rounded bg-[#efeaf8] px-1.5 py-0.5 text-[10px]">全店共通</span>}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle(item)}
                      disabled={!!pendingId}
                      aria-label={item.isSoldOut ? `${item.name}の販売を再開` : `${item.name}を売切にする`}
                      className={cn(
                        'inline-flex min-h-11 w-[104px] shrink-0 items-center justify-center gap-1 rounded-lg border text-sm font-bold disabled:opacity-60',
                        item.isSoldOut
                          ? 'border-[#1f7a4d] bg-white text-[#1f7a4d] active:bg-[#e8f5ee]'
                          : 'border-[#b3341f] bg-white text-[#b3341f] active:bg-[#fdf1ef]'
                      )}
                    >
                      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                      {item.isSoldOut ? '販売再開' : '売切にする'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
