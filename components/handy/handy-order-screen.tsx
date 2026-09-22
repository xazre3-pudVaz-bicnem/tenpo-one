'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { OptionDialog, type PosOptionGroup } from '@/components/pos/option-dialog';
import {
  HandyBackButton,
  HandyMain,
  HandyOperatorBar,
  HandyTopBar,
} from './handy-chrome';
import {
  addCartLine,
  cartCount,
  cartLineKey,
  cartTotal,
  changeCartQuantity,
  MAX_LINE_QUANTITY,
  TILE_ACCENTS,
  type HandyCartLine,
  type HandyMenuItemView,
  type HandyPageView,
  type HandyTabView,
} from './logic';
import type { HandyOrderLineInput, HandySubmitResult } from '@/app/app/handy/actions';

/**
 * 注文画面（承認済みレイアウトの menu / review）。
 *
 * 上のタブ（1 単品／2 コース・飲み放題／3 サービス）→ ページのタイル（メニューブックのページ。
 * SOUP・APPETIZER・SALAD のようにカテゴリをまとめたもの）→ 商品のタイル（カテゴリごとに見出し）、と
 * 画面を切り替えながらカートへ入れ、「注文確認へ」で独立した注文確認画面に移る。注文確認はお客様の横で
 * 読み上げて確かめるための画面なので、下部バーに畳まず1画面まるごと使う。
 */
export function HandyOrderScreen({
  tableId,
  tableName,
  staffName,
  orderId,
  orderNo,
  guestCount,
  unpaidTotal,
  tabs,
  initialTabId,
  optionGroupsByItem,
  submitAction,
}: {
  tableId: string;
  tableName: string;
  staffName: string;
  orderId: string;
  orderNo: number;
  guestCount: number;
  unpaidTotal: number;
  tabs: HandyTabView[];
  /** 開いたときのタブ（飲み放題・コースの卓は 2 コース・飲み放題） */
  initialTabId?: string | null;
  optionGroupsByItem: Record<string, PosOptionGroup[]>;
  submitAction: (orderId: string, lines: HandyOrderLineInput[]) => Promise<HandySubmitResult>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState<'menu' | 'review'>('menu');
  const [tabId, setTabId] = useState<string>(initialTabId ?? tabs[0]?.id ?? 'alacarte');
  const [pageKey, setPageKey] = useState<string | null>(null);
  const [optionTarget, setOptionTarget] = useState<HandyMenuItemView | null>(null);
  const [cart, setCart] = useState<HandyCartLine[]>([]);
  const [pending, startTransition] = useTransition();
  // 二重送信の保険（連打で startTransition が2回走るのを防ぐ）
  const sendingRef = useRef(false);

  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0] ?? null;
  const page = tab?.pages.find((p) => p.key === pageKey) ?? null;

  const quantityByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of cart) map.set(line.menuItemId, (map.get(line.menuItemId) ?? 0) + line.quantity);
    return map;
  }, [cart]);

  const count = cartCount(cart);
  const total = cartTotal(cart);
  const seatLabel = `${tableName} · ${guestCount}名`;

  const pushToCart = (item: HandyMenuItemView, optionItemIds: string[], optionLabel: string) => {
    const extra = (optionGroupsByItem[item.id] ?? [])
      .flatMap((g) => g.items)
      .filter((o) => optionItemIds.includes(o.id))
      .reduce((n, o) => n + o.price, 0);
    setCart((prev) =>
      addCartLine(
        prev,
        {
          menuItemId: item.id,
          name: item.name,
          nameEn: item.nameEn,
          unitPrice: item.price + extra,
          optionItemIds,
          optionLabel,
        },
        1
      )
    );
  };

  const handleItemTap = (item: HandyMenuItemView) => {
    if (item.isSoldOut || item.offHours) return;
    const optionGroups = optionGroupsByItem[item.id];
    if (optionGroups && optionGroups.length > 0) {
      setOptionTarget(item);
      return;
    }
    pushToCart(item, [], '');
  };

  const handleOptionConfirm = (optionItemIds: string[]) => {
    const item = optionTarget;
    if (!item) return;
    const label = (optionGroupsByItem[item.id] ?? [])
      .flatMap((g) => g.items)
      .filter((o) => optionItemIds.includes(o.id))
      .map((o) => o.name)
      .join('・');
    pushToCart(item, optionItemIds, label);
    setOptionTarget(null);
  };

  const handleSubmit = () => {
    if (pending || sendingRef.current || cart.length === 0) return;
    sendingRef.current = true;
    const lines: HandyOrderLineInput[] = cart.map((l) => ({
      menuItemId: l.menuItemId,
      optionItemIds: l.optionItemIds,
      quantity: l.quantity,
      name: l.name,
    }));
    startTransition(async () => {
      try {
        const result = await submitAction(orderId, lines);
        if (result.message) {
          // 送信できた分だけ伝票に入り、残りはカートに戻す（成功したようには見せない）
          setCart((prev) => {
            const byKey = new Map(prev.map((l) => [l.key, l]));
            return result.remaining
              .map((r) => {
                const base = byKey.get(cartLineKey(r.menuItemId, r.optionItemIds));
                return base ? { ...base, quantity: r.quantity } : null;
              })
              .filter((l): l is HandyCartLine => !!l);
          });
          toast(`${result.sentQuantity}点を送信しました。${result.message}`, 'error');
          return;
        }
        setCart([]);
        // 送信できた点数を卓の伝票画面に伝え、「厨房に送信しました」を出す
        router.push(`/handy/${tableId}?sent=${result.sentQuantity}`);
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : '送信に失敗しました', 'error');
      } finally {
        sendingRef.current = false;
      }
    });
  };

  /* ----------------------------------------------------------- 注文確認 */

  if (step === 'review') {
    return (
      <>
        <HandyTopBar
          left={<HandyBackButton label="メニュー" onClick={() => setStep('menu')} />}
          title="注文確認"
        />
        <HandyOperatorBar label={seatLabel} note={staffName} showIcon={false} />

        <HandyMain>
          <div className="p-3">
            {cart.length === 0 ? (
              <p className="px-4 py-9 text-center text-[13px] leading-loose text-[#8a769d]">
                注文する商品がありません。
              </p>
            ) : (
              cart.map((line) => (
                <article
                  key={line.key}
                  className="mb-2.5 rounded-[10px] border border-[#e3dbf1] bg-white p-3.5"
                >
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <b className="min-w-0 font-bold break-words text-[#2a2138]">{line.name}</b>
                    <strong className="shrink-0 font-bold text-[#2a2138] tabular-nums">
                      {yen(line.unitPrice * line.quantity)}
                    </strong>
                  </div>
                  {line.optionLabel && (
                    <p className="my-2 text-[11px] break-words text-[#8a769d]">{line.optionLabel}</p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <small className="text-[10px] text-[#8a769d] tabular-nums">
                      {yen(line.unitPrice)} / 点
                    </small>
                    <div className="mt-2.5 flex items-center gap-[11px]">
                      <button
                        type="button"
                        aria-label={`${line.name}を減らす`}
                        onClick={() => setCart((prev) => changeCartQuantity(prev, line.key, -1))}
                        className="h-10 w-10 rounded-[4px] border border-[#7b3fe4] text-[21px] leading-none text-[#7b3fe4]"
                      >
                        −
                      </button>
                      <b className="min-w-5 text-center text-base font-bold tabular-nums">
                        {line.quantity}
                      </b>
                      <button
                        type="button"
                        aria-label={`${line.name}を増やす`}
                        disabled={line.quantity >= MAX_LINE_QUANTITY}
                        onClick={() => setCart((prev) => changeCartQuantity(prev, line.key, 1))}
                        className="h-10 w-10 rounded-[4px] border border-[#7b3fe4] text-[21px] leading-none text-[#7b3fe4] disabled:opacity-40"
                      >
                        ＋
                      </button>
                    </div>
                  </div>
                </article>
              ))
            )}

            <div className="flex items-baseline justify-between px-1 py-3 text-[15px]">
              <span>{count}点 · 合計（税込）</span>
              <b className="text-[23px] font-bold tabular-nums">{yen(total)}</b>
            </div>
            <p className="px-3 py-2 text-center text-[10px] leading-[1.7] text-[#8a769d]">
              お客様に読み上げて確認してから送信してください。
              <br />
              送信すると伝票 #{orderNo}（現在 {yen(unpaidTotal)}）に追加され、厨房へ流れます。
            </p>
          </div>
        </HandyMain>

        <div className="flex-none bg-[#f6f3fb] px-3.5 pt-3 pb-2.5">
          <button
            type="button"
            disabled={pending || count === 0}
            onClick={handleSubmit}
            className="flex min-h-[42px] w-full items-center justify-center rounded-[9px] bg-[#7b3fe4] text-base font-bold text-white shadow-[0_3px_10px_#7b3fe41a] active:bg-[#6630c7] disabled:opacity-40"
          >
            {pending ? '送信中…' : '注文を送信'}
          </button>
        </div>
      </>
    );
  }

  /* --------------------------------------------------------- メニュー */

  return (
    <>
      <header className="flex-none bg-[#241436]">
        <div className="flex h-12 items-stretch border-b-2 border-[#7b3fe4]">
          <Link
            href={`/handy/${tableId}`}
            aria-label="卓の画面へ戻る"
            className="grid w-11 flex-none place-items-center text-white"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.2} aria-hidden />
          </Link>
          <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
            {tabs.map((t, i) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={t.id === tab?.id}
                onClick={() => {
                  setTabId(t.id);
                  setPageKey(null);
                }}
                className={cn(
                  'flex min-w-[86px] flex-1 flex-col items-center justify-center gap-[3px] rounded-t-[11px] border border-b-0 px-1 text-xs leading-[1.15] font-bold whitespace-nowrap',
                  t.id === tab?.id
                    ? 'border-[#f8f6fc] bg-[#f8f6fc] text-[#7b3fe4]'
                    : 'border-[#59416f] bg-[#3a2356] text-[#c4afd8]'
                )}
              >
                <b className="block text-lg">{i + 1}</b>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex min-h-[27px] flex-none items-center justify-between gap-2 px-1.5 py-[5px] text-[10px] text-[#8a8a8a]">
        <span className="flex min-w-0 items-center gap-1.5">
          {/* 1ページ前に戻る（2026-09-22 店舗要望「全部の画面で1ページ前に戻るボタンがほしい」）:
              商品の画面 → ページのタイル、ページのタイル → 卓の画面 */}
          {page ? (
            <button
              type="button"
              onClick={() => setPageKey(null)}
              aria-label={`${tab?.label ?? 'ページ一覧'}へ戻る`}
              className="flex min-h-[34px] shrink-0 items-center gap-0.5 rounded-[8px] border border-[#d9ccef] bg-white pr-2.5 pl-1 text-[12px] font-bold text-[#7b3fe4] shadow-[0_1px_2px_#00000008] active:bg-[#efe5ff]"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2.4} aria-hidden />
              戻る
            </button>
          ) : (
            <Link
              href={`/handy/${tableId}`}
              aria-label="卓の画面へ戻る"
              className="flex min-h-[34px] shrink-0 items-center gap-0.5 rounded-[8px] border border-[#d9ccef] bg-white pr-2.5 pl-1 text-[12px] font-bold text-[#7b3fe4] shadow-[0_1px_2px_#00000008] active:bg-[#efe5ff]"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2.4} aria-hidden />
              戻る
            </Link>
          )}
          {page ? (
            <>
              <button
                type="button"
                onClick={() => setPageKey(null)}
                className="min-h-[30px] shrink-0 text-[10px] text-[#7b3fe4]"
              >
                {tab?.label}
              </button>
              <span className="shrink-0">›</span>
              <span className="truncate">{page.label}</span>
            </>
          ) : (
            <span className="truncate">{tab?.label ?? '—'}</span>
          )}
        </span>
        <Link
          href={`/handy/${tableId}`}
          className="min-h-[30px] shrink-0 py-1.5 text-[10px] whitespace-nowrap text-[#7b3fe4]"
        >
          {seatLabel} · 伝票#{orderNo}
        </Link>
      </div>

      <HandyMain>
        {tabs.length === 0 ? (
          <p className="px-6 py-9 text-center text-[13px] leading-loose text-[#8a769d]">
            注文できる商品がありません。
            <br />
            メニュー設定を確認してください。
          </p>
        ) : !page ? (
          <ul className="grid grid-cols-3 gap-x-2 gap-y-[17px] px-[5px] pt-2 pb-5 sm:grid-cols-4 lg:grid-cols-6">
            {(tab?.pages ?? []).map((p, i) => (
              <li key={p.key}>
                <button
                  type="button"
                  onClick={() => setPageKey(p.key)}
                  aria-label={`${p.label}（${p.itemCount}品）`}
                  style={{ borderBottomColor: TILE_ACCENTS[i % TILE_ACCENTS.length] }}
                  className="flex aspect-square w-full items-center justify-between gap-1 overflow-hidden rounded-[10px] border border-b-4 border-[#e3dbf1] bg-white px-3 py-2.5 text-left text-xs font-bold break-words text-[#4f3868] shadow-[0_1px_2px_#00000007] active:bg-[#efe5ff]"
                >
                  <PageTileLabel page={p} />
                  <ChevronRight className="h-[13px] w-[13px] shrink-0 text-[#d1c7de]" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-[5px] pt-2 pb-5">
            {page.categories.map((c) => (
              <section key={c.id} className="mb-4 last:mb-0">
                {page.categories.length > 1 && (
                  <h2 className="mb-2 flex items-center gap-2 px-1 text-[11px] font-bold tracking-wide text-[#5e4777]">
                    <span className="h-3 w-1 rounded bg-[#7b3fe4]" aria-hidden />
                    {c.name}
                    <span className="font-normal text-[#a393b5]">{c.items.length}</span>
                  </h2>
                )}
                <ul className="grid grid-cols-3 gap-x-2 gap-y-[17px] sm:grid-cols-4 lg:grid-cols-6">
                  {c.items.map((item, i) => {
                    const inCart = quantityByItem.get(item.id) ?? 0;
                    const disabled = item.isSoldOut || item.offHours;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => handleItemTap(item)}
                          aria-label={`${item.name} ${yen(item.price)} を追加`}
                          style={
                            disabled ? undefined : { borderBottomColor: TILE_ACCENTS[i % TILE_ACCENTS.length] }
                          }
                          className={cn(
                            'relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[10px] border border-b-4 border-[#e3dbf1] bg-white px-[7px] py-[9px] text-center text-xs font-bold break-words text-[#4f3868] shadow-[0_1px_2px_#00000007]',
                            disabled ? 'border-b-[#e3dbf1] opacity-50' : 'active:bg-[#efe5ff]',
                            inCart > 0 && !disabled && 'border-[#7b3fe4] bg-[#efe5ff]'
                          )}
                        >
                          <span className="pb-[11px]">{item.name}</span>
                          <span className="absolute inset-x-0 bottom-[9px] text-[9px] font-normal text-[#8a769d] tabular-nums">
                            {yen(item.price)}
                          </span>
                          {item.isSoldOut && (
                            <span className="absolute inset-x-1.5 top-1/2 -translate-y-1/2 rounded bg-[#b3341f] px-1 py-0.5 text-[11px] font-bold text-white">
                              売切
                            </span>
                          )}
                          {!item.isSoldOut && item.offHours && (
                            <span className="absolute inset-x-1.5 top-1/2 -translate-y-1/2 rounded bg-[#7a7090] px-1 py-0.5 text-[11px] font-bold text-white">
                              時間外
                            </span>
                          )}
                          {inCart > 0 && (
                            <span className="absolute top-[5px] right-[5px] min-w-[21px] rounded-xl bg-[#7b3fe4] px-[5px] py-0.5 text-[10px] font-bold text-white">
                              {inCart}
                            </span>
                          )}
                          {item.hasOptions && (
                            <span className="absolute top-[5px] left-[5px] text-[9px] font-normal text-[#8a769d]">
                              選択肢
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </HandyMain>

      <div className="flex-none bg-[#f6f3fb] px-3.5 pt-2 pb-2.5">
        <button
          type="button"
          disabled={count === 0}
          onClick={() => setStep('review')}
          className="flex min-h-[48px] w-full items-center justify-between gap-2 rounded-[9px] bg-[#7b3fe4] px-4 text-base font-bold text-white shadow-[0_3px_10px_#7b3fe41a] active:bg-[#6630c7] disabled:opacity-40"
        >
          <span>注文確認へ（{count}点）</span>
          <span className="tabular-nums">{yen(total)}</span>
        </button>
      </div>

      {optionTarget && (
        <OptionDialog
          itemName={optionTarget.name}
          itemNameEn={optionTarget.nameEn}
          basePrice={optionTarget.price}
          groups={optionGroupsByItem[optionTarget.id] ?? []}
          onCancel={() => setOptionTarget(null)}
          onConfirm={handleOptionConfirm}
        />
      )}
    </>
  );
}

/**
 * ページのタイルの文字。名前を付けたページは名前、1カテゴリのページはカテゴリ名、
 * 複数カテゴリのページはカテゴリ名を1行ずつ（多いときは4つ目以降を「ほかN」にまとめる）。
 */
function PageTileLabel({ page }: { page: HandyPageView }) {
  if (page.name || page.categories.length === 1) {
    return <span className="min-w-0">{page.name ?? page.categories[0]?.name}</span>;
  }
  const shown = page.categories.length > 4 ? page.categories.slice(0, 3) : page.categories;
  const rest = page.categories.length - shown.length;
  return (
    <span className="flex min-w-0 flex-col gap-1 text-[11px] leading-[1.2]">
      {shown.map((c) => (
        <span key={c.id} className="line-clamp-2 break-words">
          {c.name}
        </span>
      ))}
      {rest > 0 && <span className="text-[10px] font-normal text-[#8a769d]">ほか{rest}</span>}
    </span>
  );
}
