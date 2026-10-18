'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { categoryEnglishName } from '@/lib/romaji';
import { groupMenuItems, type MenuGroupSection } from '@/lib/menu-groups';
import { useQrStrings, useQrLocale, localizedName } from './strings-context';
import { itemQuantityInCart, menuTabs, type QrMenuPage, type QrMenuTab } from './logic';
import { isPublicImageUrl, type CartLine, type QrMenuCategory, type QrMenuItem, hasOptions } from './types';
import { DishArt, QrEmpty, QrNote } from './ui';

/**
 * メニュータブ。承認済みレイアウトに合わせて
 *   卓のカード → ページの横スクロールタブ（濃いプラムの帯） → 写真つき商品カード2列
 * の並びにする。タブはメニューブックのページ（SOUP・APPETIZER・SALAD など、複数カテゴリは見出しを付けて並べる）。
 * 商品が0件のカテゴリ・タブは出さない。
 * カテゴリの中に同じ銘柄が2つ以上あれば「ホワイトホース ——」の見出しの下に種類（ロック・ハイボール…）を
 * 小さいカードで3列に並べる（2026-10-18 Ronnie「QR でもハンディでも見やすく」。lib/menu-groups）。
 * 写真のある商品は写真つきのカードのまま。
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
  /** カテゴリごとの銘柄のまとまり（まとまらなければ null＝今までどおりの写真つきカード2列） */
  const groupsBySection = useMemo(() => {
    const map = new Map<string, MenuGroupSection<QrMenuItem>[] | null>();
    for (const section of active?.sections ?? []) {
      map.set(
        section.id,
        groupMenuItems(section.items, (i) => ({ name: i.name, nameEn: i.name_en }), {
          groupable: (i) => !isPublicImageUrl(i.image_path),
        })
      );
    }
    return map;
  }, [active]);
  /** ＋ボタン：選択肢のある商品はシートを開く。無ければそのままカートへ */
  const addItem = (item: QrMenuItem) => (hasOptions(item) ? onSelectItem(item) : onQuickAdd(item));
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
    t.name ?? t.sections.map((c) => localizedName(locale, c.name, categoryEnglishName(c.name, c.name_en))).join('・');

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
                  : 'border-[#4a433d] bg-plum-2 text-[#dcc0b0]'
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
                      {localizedName(locale, c.name, categoryEnglishName(c.name, c.name_en))}
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
                {localizedName(locale, c.name, categoryEnglishName(c.name, c.name_en))}
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
                <h3 className="flex items-center gap-2 px-3 pb-2 pt-1 text-[12px] font-bold text-[#5c5650]">
                  <span className="h-3 w-1 rounded bg-iris" aria-hidden />
                  {localizedName(locale, section.name, section.name_en)}
                </h3>
              )}
              {(groupsBySection.get(section.id) ?? [{ kind: 'items' as const, key: 'all', items: section.items }]).map((part) =>
                part.kind === 'group' ? (
                  <div key={part.key}>
                    <h4 className="flex items-center gap-2 px-3 pb-1.5 pt-1 text-[13px] font-bold text-ink">
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {locale === 'en' ? (part.labelEn ?? part.label) : part.label}
                      </span>
                      <span aria-hidden className="h-0.5 min-w-4 flex-1 rounded bg-iris/25" />
                    </h4>
                    <ul className="grid grid-cols-3 gap-1.5 px-2.5 pb-3.5">
                      {part.members.map((m) => (
                        <VariantCard
                          key={m.item.id}
                          item={m.item}
                          label={locale === 'en' ? (m.labelEn ?? m.label) : m.label}
                          quantity={itemQuantityInCart(cart, m.item.id)}
                          onOpen={() => onSelectItem(m.item)}
                          onAdd={() => addItem(m.item)}
                        />
                      ))}
                    </ul>
                  </div>
                ) : (
                  <ul key={part.key} className="grid grid-cols-2 gap-2 px-2.5 pb-4">
                    {part.items.map((item) => (
                      <MenuCard
                        key={item.id}
                        item={item}
                        quantity={itemQuantityInCart(cart, item.id)}
                        onOpen={() => onSelectItem(item)}
                        onAdd={() => addItem(item)}
                      />
                    ))}
                  </ul>
                )
              )}
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
          <b className="line-clamp-2 text-[11px] font-bold leading-snug text-ink [overflow-wrap:anywhere]">{displayName}</b>
          {item.is_sold_out ? (
            <span className="mt-1.5 inline-block rounded bg-lilac px-1.5 py-0.5 text-[9px] font-semibold text-ink-3">
              {qrStrings.menu.soldOutBadge}
            </span>
          ) : (
            <strong className="mt-1.5 block font-num text-[13px] font-bold text-[#5c5650]">
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

/** 銘柄の見出しの下に並べる小さいカード（種類の名前・値段・＋）。押すと商品のシート、＋でカートへ */
function VariantCard({
  item,
  label,
  quantity,
  onOpen,
  onAdd,
}: {
  item: QrMenuItem;
  /** 種類の名前（例：ロック）。シート・カートには商品名そのものが出る */
  label: string;
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
        'relative rounded-[10px] border bg-white',
        quantity > 0 && !item.is_sold_out ? 'border-iris bg-iris-soft' : 'border-line',
        item.is_sold_out && 'opacity-55'
      )}
    >
      <button
        type="button"
        disabled={item.is_sold_out}
        onClick={onOpen}
        aria-label={displayName}
        className="flex h-[78px] w-full flex-col items-start justify-between gap-1 px-2 pb-2 pt-2 text-left"
      >
        <b className="line-clamp-2 text-[12px] font-bold leading-snug text-ink [overflow-wrap:anywhere]">{label}</b>
        {item.is_sold_out ? (
          <span className="inline-block rounded bg-lilac px-1.5 py-0.5 text-[9px] font-semibold text-ink-3">
            {qrStrings.menu.soldOutBadge}
          </span>
        ) : (
          <strong className="block pr-8 font-num text-[12px] font-bold leading-8 text-[#5c5650]">{yen(item.price)}</strong>
        )}
      </button>
      {!item.is_sold_out && (
        <button
          type="button"
          aria-label={qrStrings.menu.addAria(displayName)}
          onClick={onAdd}
          className="absolute bottom-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-lilac font-num text-sm font-bold leading-none text-iris active:scale-95"
        >
          {quantity > 0 ? quantity : '＋'}
        </button>
      )}
    </li>
  );
}
