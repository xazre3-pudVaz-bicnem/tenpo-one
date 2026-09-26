'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { useQrStrings, useQrLocale, localizedName } from './strings-context';
import { itemQuantityInCart, menuTabs, type QrMenuPage, type QrMenuTab } from './logic';
import { isPublicImageUrl, type CartLine, type QrMenuCategory, type QrMenuItem } from './types';
import { DishArt, QrEmpty, QrNote } from './ui';

/**
 * メニュータブ。承認済みレイアウトに合わせて
 *   卓のカード → ページの横スクロールタブ（濃いプラムの帯） → 写真つき商品カード2列
 * の並びにする。タブはメニューブックのページ（SOUP・APPETIZER・SALAD など、複数カテゴリは見出しを付けて並べる）。
 * 商品が0件のカテゴリ・タブは出さない。
 */
export function MenuView({
  tableName,
  categories,
  pages,
  cart,
  onSelectItem,
  onQuickAdd,
  planOver = false,
}: {
  tableName: string;
  categories: QrMenuCategory[];
  /** メニューブックのページ（飲み放題・コースの卓は飲み放題のページが先頭）。無ければ1カテゴリ1タブ */
  pages?: QrMenuPage[] | null;
  cart: CartLine[];
  onSelectItem: (item: QrMenuItem) => void;
  onQuickAdd: (item: QrMenuItem) => void;
  /** プラン（飲み放題等）の時間が終わっているか */
  planOver?: boolean;
}) {
  const qrStrings = useQrStrings();
  const locale = useQrLocale();

  const tabs = useMemo(
    () => menuTabs(categories, pages, qrStrings.menu.recommendedCategoryName),
    [categories, pages, qrStrings.menu.recommendedCategoryName]
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0] ?? null;
  // ページの中のカテゴリ（SOUP・SALAD…）を小さなタブで絞る（2026-09-25 店舗要望「タブがあるとオーダーしやすい」）。
  // null＝全部。ページを切り替えたら「すべて」に戻す
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [sectionPage, setSectionPage] = useState<string | null>(active?.id ?? null);
  if (active && sectionPage !== active.id) {
    setSectionPage(active.id);
    setSectionId(null);
  }
  const visibleSections =
    active && sectionId ? active.sections.filter((c) => c.id === sectionId) : (active?.sections ?? []);
  /** タブの名前（ページの名前・おすすめ、無ければカテゴリ名を言語に合わせてつなぐ） */
  const tabLabel = (t: QrMenuTab) =>
    t.name ?? t.sections.map((c) => localizedName(locale, c.name, c.name_en)).join('・');

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
        {tabs.map((t, index) => {
          const selected = active.id === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setActiveId(t.id)}
              className={cn(
                'flex min-h-[62px] w-auto min-w-[88px] max-w-[136px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-t-xl border px-2.5 py-1.5 text-[11px] font-bold leading-tight',
                selected
                  ? 'border-line bg-lilac-soft text-iris'
                  : 'border-[#59416f] bg-plum-2 text-[#c4afd8]'
              )}
            >
              <b className="font-num text-lg leading-none">{index + 1}</b>
              {t.name || t.sections.length === 1 ? (
                <span className="line-clamp-2 text-center [overflow-wrap:anywhere]">{tabLabel(t)}</span>
              ) : (
                // 複数カテゴリのページはカテゴリ名を1行ずつ（4つ以上は3つ＋「+N」）
                <span className="flex max-w-full flex-col items-center text-[10px] leading-[1.25]">
                  {(t.sections.length > 3 ? t.sections.slice(0, 2) : t.sections).map((c) => (
                    <span key={c.id} className="max-w-full truncate">
                      {localizedName(locale, c.name, c.name_en)}
                    </span>
                  ))}
                  {t.sections.length > 3 && <span className="font-normal">+{t.sections.length - 2}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="bg-white">
        <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-3.5">
          <h2 className="min-w-0 text-sm font-bold text-ink [overflow-wrap:anywhere]">{tabLabel(active)}</h2>
          <span className="shrink-0 font-num text-[10px] text-ink-3">{qrStrings.menu.countSuffix(active.itemCount)}</span>
        </div>

        {/* カテゴリのタブ（ページに2つ以上あるときだけ）。押すとそのカテゴリだけに絞る */}
        {active.sections.length > 1 && (
          <div className="sticky top-0 z-10 flex gap-1.5 overflow-x-auto border-b border-line bg-white px-2.5 py-2 [scrollbar-width:none]">
            <button
              type="button"
              aria-pressed={sectionId === null}
              onClick={() => setSectionId(null)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold',
                sectionId === null ? 'border-iris bg-iris text-white' : 'border-line bg-white text-ink-2'
              )}
            >
              {qrStrings.menu.allSections}
            </button>
            {active.sections.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={sectionId === c.id}
                onClick={() => setSectionId(c.id)}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold',
                  sectionId === c.id ? 'border-iris bg-iris text-white' : 'border-line bg-white text-ink-2'
                )}
              >
                {localizedName(locale, c.name, c.name_en)}
              </button>
            ))}
          </div>
        )}

        {active.itemCount === 0 ? (
          <QrEmpty>{qrStrings.menu.categoryEmpty}</QrEmpty>
        ) : (
          visibleSections.map((section) => (
            <section key={section.id}>
              {active.sections.length > 1 && (
                <h3 className="flex items-center gap-2 px-3 pb-2 pt-1 text-[12px] font-bold text-[#5e5470]">
                  <span className="h-3 w-1 rounded bg-iris" aria-hidden />
                  {localizedName(locale, section.name, section.name_en)}
                </h3>
              )}
              <ul className="grid grid-cols-2 gap-2 px-2.5 pb-4">
                {section.items.map((item) => (
                  <MenuCard
                    key={item.id}
                    item={item}
                    quantity={itemQuantityInCart(cart, item.id)}
                    onOpen={() => onSelectItem(item)}
                    onAdd={() => (item.modifiers.length > 0 ? onSelectItem(item) : onQuickAdd(item))}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {planOver && (
        <p className="mx-3 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {qrStrings.menu.planOver}
        </p>
      )}
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
            <strong className="mt-1.5 block font-num text-[13px] font-bold text-[#5e5470]">
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
