'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { useQrStrings, useQrLocale, localizedName } from './strings-context';
import { itemQuantityInCart, orderableCategories, RECOMMENDED_TAB_ID } from './logic';
import { isPublicImageUrl, type CartLine, type QrMenuCategory, type QrMenuItem } from './types';
import { DishArt, QrEmpty, QrNote } from './ui';

/**
 * メニュータブ。承認済みレイアウトに合わせて
 *   卓のカード → 分類の横スクロールタブ（濃いプラムの帯） → 写真つき商品カード2列
 * の並びにする。商品が0件の分類はタブに出さない。
 */
export function MenuView({
  tableName,
  categories,
  cart,
  onSelectItem,
  onQuickAdd,
}: {
  tableName: string;
  categories: QrMenuCategory[];
  cart: CartLine[];
  onSelectItem: (item: QrMenuItem) => void;
  onQuickAdd: (item: QrMenuItem) => void;
}) {
  const qrStrings = useQrStrings();
  const locale = useQrLocale();

  const tabs = useMemo(
    () => orderableCategories(categories, qrStrings.menu.recommendedCategoryName),
    [categories, qrStrings.menu.recommendedCategoryName]
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const active = tabs.find((c) => c.id === activeId) ?? tabs[0] ?? null;

  if (!active) {
    return <QrEmpty>{qrStrings.menu.empty}</QrEmpty>;
  }

  return (
    <div>
      <section className="px-3 pb-2.5 pt-2.5">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2.5">
          <div className="min-w-0">
            <b className="block truncate text-[11px] font-bold text-ink">{tableName}</b>
            <small className="mt-0.5 block text-[9px] text-ink-3">{qrStrings.visit.hint}</small>
          </div>
          <span className="shrink-0 rounded-md bg-lilac px-2 py-1 text-[9px] font-semibold text-iris">
            {qrStrings.visit.badge}
          </span>
        </div>
      </section>

      {/* 分類タブ：横スクロール。濃いプラムの帯の上に立つタブ */}
      <div className="flex gap-1 overflow-x-auto border-b-[3px] border-iris bg-plum px-2.5 pt-2 [scrollbar-width:none]">
        {tabs.map((category, index) => {
          const selected = active.id === category.id;
          return (
            <button
              key={category.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setActiveId(category.id)}
              className={cn(
                'flex min-h-[62px] w-[88px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-t-xl border px-2.5 py-1.5 text-[11px] font-bold leading-tight',
                selected
                  ? 'border-line bg-lilac-soft text-iris'
                  : 'border-[#59416f] bg-plum-2 text-[#c4afd8]'
              )}
            >
              <b className="font-num text-lg leading-none">{index + 1}</b>
              <span className="line-clamp-2 text-center">
                {category.id === RECOMMENDED_TAB_ID
                  ? category.name
                  : localizedName(locale, category.name, category.name_en)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="bg-white">
        <div className="flex items-center justify-between px-3 pb-2 pt-3.5">
          <h2 className="text-sm font-bold text-ink">
            {active.id === RECOMMENDED_TAB_ID ? active.name : localizedName(locale, active.name, active.name_en)}
          </h2>
          <span className="font-num text-[10px] text-ink-3">{qrStrings.menu.countSuffix(active.items.length)}</span>
        </div>

        {active.items.length === 0 ? (
          <QrEmpty>{qrStrings.menu.categoryEmpty}</QrEmpty>
        ) : (
          <ul className="grid grid-cols-2 gap-2 px-2.5 pb-4">
            {active.items.map((item) => (
              <MenuCard
                key={item.id}
                item={item}
                quantity={itemQuantityInCart(cart, item.id)}
                onOpen={() => onSelectItem(item)}
                onAdd={() => (item.modifiers.length > 0 ? onSelectItem(item) : onQuickAdd(item))}
              />
            ))}
          </ul>
        )}
      </div>

      <QrNote className="pt-3">{qrStrings.menu.note}</QrNote>
    </div>
  );
}

function MenuCard({
  item,
  quantity,
  onOpen,
  onAdd,
}: {
  item: QrMenuItem;
  quantity: number;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const qrStrings = useQrStrings();
  const locale = useQrLocale();
  const displayName = localizedName(locale, item.name, item.name_en);

  return (
    <li
      className={cn(
        'relative rounded-[10px] border border-line bg-white p-2',
        item.is_sold_out && 'opacity-55'
      )}
    >
      <button
        type="button"
        disabled={item.is_sold_out}
        onClick={onOpen}
        className="block w-full text-left"
      >
        {isPublicImageUrl(item.image_path) ? (
          // eslint-disable-next-line @next/next/no-img-element -- 匿名向け公開URLのみ許可されるため next/image の最適化対象外
          <img
            src={item.image_path}
            alt={qrStrings.itemSheet.imageAlt(displayName)}
            loading="lazy"
            decoding="async"
            className="aspect-[4/3] w-full rounded-lg object-cover"
          />
        ) : (
          <DishArt />
        )}
        <div className="pb-9 pt-2">
          <b className="block text-[11px] font-bold leading-snug text-ink [overflow-wrap:anywhere]">{displayName}</b>
          {item.is_sold_out ? (
            <span className="mt-1.5 inline-block rounded bg-lilac px-1.5 py-0.5 text-[9px] font-semibold text-ink-3">
              {qrStrings.menu.soldOutBadge}
            </span>
          ) : (
            <strong className="mt-1.5 block font-num text-[13px] font-bold text-[#5e4777]">
              {yen(item.price)} <em className="text-[8px] font-medium not-italic text-ink-3">{qrStrings.menu.taxIncluded}</em>
            </strong>
          )}
          {item.is_recommended && !item.is_sold_out && (
            <span className="mt-1 inline-block rounded bg-saffron-soft px-1.5 py-0.5 text-[9px] font-semibold text-saffron">
              {qrStrings.menu.recommendedBadge}
            </span>
          )}
        </div>
      </button>

      {!item.is_sold_out && (
        <button
          type="button"
          aria-label={qrStrings.menu.addAria(displayName)}
          onClick={onAdd}
          className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-lilac font-num text-base font-bold leading-none text-iris active:scale-95"
        >
          {quantity > 0 ? quantity : '＋'}
        </button>
      )}
    </li>
  );
}
