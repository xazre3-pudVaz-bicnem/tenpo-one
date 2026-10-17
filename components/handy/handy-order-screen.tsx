'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, PenLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { OptionDialog, type PosOptionGroup } from '@/components/pos/option-dialog';
import { OpenPriceDialog } from '@/components/pos/open-price-dialog';
import { customItemName, customLineId, normalizeCustomMemo } from '@/lib/custom-price';
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
  repriceCart,
  TILE_ACCENTS,
  type HandyCartLine,
  type HandyMenuItemView,
  type HandyPageTab,
  type HandyPageTabCategory,
  type HandyTabView,
} from './logic';
import type { HandyOrderLineInput, HandySubmitResult } from '@/app/app/handy/actions';
import { SlideToConfirm } from './slide-to-confirm';

/**
 * 注文画面（承認済みレイアウトの menu / review）。
 *
 * 上のタブ＝レジと同じメニューブックのページ（1 ドリンク／2 飲み放題／3 フード／4 コース／5 OTHER…）。
 * その下は 左にカテゴリのタテ一覧、右にそのカテゴリの商品（名前・値段の大きいタイル）。カテゴリは1タップで
 * 切り替わり、どのカテゴリを開いているかが左でいつも分かる（2026-10-18 Ronnie「左にタテ一覧。全店舗で」。
 * それまでは 単品／コース・飲み放題／サービス のタブ → ページのタイル → カテゴリ見出し付きの小さいタイル）。
 * 「注文確認へ」で独立した注文確認画面に移る。注文確認はお客様の横で読み上げて確かめるための画面なので、
 * 下部バーに畳まず1画面まるごと使う。
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
  pages,
  initialPageKey,
  optionGroupsByItem,
  submitAction,
  onClose,
  onSubmitted,
}: {
  tableId: string;
  tableName: string;
  staffName: string;
  orderId: string;
  orderNo: number;
  guestCount: number;
  unpaidTotal: number;
  /** 商品の値段の付け直し（repriceCart）用。画面の並びは pages で出す */
  tabs: HandyTabView[];
  /** 上のタブ＝メニューブックのページ（lib/handy-menu-server の loadHandyMenu） */
  pages: HandyPageTab[];
  /** 開いたときのページ（飲み放題・コースの卓はプランの中身があるページ） */
  initialPageKey?: string | null;
  optionGroupsByItem: Record<string, PosOptionGroup[]>;
  submitAction: (orderId: string, lines: HandyOrderLineInput[]) => Promise<HandySubmitResult>;
  /** 画面の中のポップアップとして使うとき（即会計の「メニュー選択」）: 戻るで閉じる。無ければ卓の画面へ戻る */
  onClose?: () => void;
  /** 送信できたとき（ポップアップ用）。無ければ卓の画面へ移る */
  onSubmitted?: (sentQuantity: number) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState<'menu' | 'review'>('menu');
  const [pageKey, setPageKey] = useState<string | null>(initialPageKey ?? pages[0]?.key ?? null);
  /** ページごとに開いているカテゴリ（タブを行き来しても戻ってくる）。無ければ先頭のカテゴリ */
  const [catByPage, setCatByPage] = useState<Record<string, string>>({});
  const [optionTarget, setOptionTarget] = useState<HandyMenuItemView | null>(null);
  /** 「その他（価格入力）」を押したカテゴリ */
  const [customTarget, setCustomTarget] = useState<{ categoryId: string; label: string } | null>(null);
  /**
   * 金額を打つ商品（¥0 の単品＝延長・キャンセル料・時価など。レジの「金額入力」と同じ）を押したとき。
   * 2026-10-18 Ronnie「延長は open price。スタッフがそのとき金額を打つ」。飲み放題の中身（¥0 の F. …）は
   * コース・飲み放題タブにあるので出ない
   */
  const [openPriceTarget, setOpenPriceTarget] = useState<HandyMenuItemView | null>(null);
  /** 「その他」の行を入れるたびに別の行にするための番号 */
  const customSeq = useRef(0);
  const [cart, setCart] = useState<HandyCartLine[]>([]);
  const [pending, startTransition] = useTransition();
  // 二重送信の保険（連打で startTransition が2回走るのを防ぐ）
  const sendingRef = useRef(false);

  const page = pages.find((p) => p.key === pageKey) ?? pages[0] ?? null;
  const category: HandyPageTabCategory | null = page
    ? (page.categories.find((c) => c.id === catByPage[page.key]) ?? page.categories[0] ?? null)
    : null;

  const quantityByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of cart) map.set(line.menuItemId, (map.get(line.menuItemId) ?? 0) + line.quantity);
    return map;
  }, [cart]);
  /** カテゴリごとのカートの点数（左の一覧のバッジ。どこに何を入れたかが分かる） */
  const quantityByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of pages)
      for (const c of p.categories) {
        let n = 0;
        for (const i of c.items) n += quantityByItem.get(i.id) ?? 0;
        if (n > 0) map.set(c.id, n);
      }
    return map;
  }, [pages, quantityByItem]);

  // メニュー設定で値段が変わったら（Realtime で画面が読み直される）、カートの値段も新しい値段で出す
  const pricedCart = useMemo(() => repriceCart(cart, tabs, optionGroupsByItem), [cart, tabs, optionGroupsByItem]);
  const count = cartCount(pricedCart);
  const total = cartTotal(pricedCart);
  const seatLabel = `${tableName} · ${guestCount}名`;

  const pushToCart = (
    item: HandyMenuItemView,
    optionItemIds: string[],
    optionLabel: string,
    openPrice: number | null = null
  ) => {
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
          unitPrice: (openPrice ?? item.price) + extra,
          optionItemIds,
          optionLabel,
          ...(openPrice != null ? { openPrice } : {}),
        },
        1
      )
    );
  };

  /** 金額を打つ商品か（¥0 の単品。コース・飲み放題の ¥0＝プランの中身、サービスの ¥0 は打たない） */
  const isOpenPriceItem = (item: HandyMenuItemView) => category?.tabId === 'alacarte' && Number(item.price) === 0;

  const handleItemTap = (item: HandyMenuItemView) => {
    if (item.isSoldOut || item.offHours) return;
    if (isOpenPriceItem(item)) {
      setOpenPriceTarget(item);
      return;
    }
    const optionGroups = optionGroupsByItem[item.id];
    if (optionGroups && optionGroups.length > 0) {
      setOptionTarget(item);
      return;
    }
    pushToCart(item, [], '');
  };

  /** 金額を打ったとき（¥0 の商品）。金額が違えば別の行 */
  const handleOpenPriceConfirm = (amount: number) => {
    const item = openPriceTarget;
    if (!item) return;
    pushToCart(item, [], '', amount);
    setOpenPriceTarget(null);
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

  /** 「その他（価格入力）」で金額と内容を打ったとき。1回ごとに別の行（内容・金額が違えばまとめない） */
  const handleCustomConfirm = (amount: number, memo: string) => {
    const target = customTarget;
    if (!target) return;
    const text = normalizeCustomMemo(memo);
    customSeq.current += 1;
    setCart((prev) =>
      addCartLine(
        prev,
        {
          menuItemId: customLineId(target.categoryId, customSeq.current),
          name: customItemName(text),
          nameEn: text ? null : 'Other',
          unitPrice: amount,
          optionItemIds: [],
          optionLabel: target.label,
          custom: { categoryId: target.categoryId, price: amount, memo: text || null },
        },
        1
      )
    );
    setCustomTarget(null);
  };

  const handleSubmit = () => {
    if (pending || sendingRef.current || cart.length === 0) return;
    sendingRef.current = true;
    const lines: HandyOrderLineInput[] = cart.map((l) => ({
      menuItemId: l.menuItemId,
      optionItemIds: l.optionItemIds,
      quantity: l.quantity,
      name: l.name,
      ...(l.custom ? { custom: l.custom } : {}),
      ...(l.openPrice != null ? { openPrice: l.openPrice } : {}),
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
                const base = byKey.get(cartLineKey(r.menuItemId, r.optionItemIds, r.openPrice));
                return base ? { ...base, quantity: r.quantity } : null;
              })
              .filter((l): l is HandyCartLine => !!l);
          });
          toast(`${result.sentQuantity}点を送信しました。${result.message}`, 'error');
          return;
        }
        setCart([]);
        if (onSubmitted) {
          onSubmitted(result.sentQuantity);
          return;
        }
        // オーダー決定のあとはそのままテーブル一覧へ（2026-09-30 Ronnie「スライドしたら直接テーブルへ」）
        toast(`${tableName}：厨房に送信しました（${result.sentQuantity}点）`, 'success');
        router.push('/handy');
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
              <p className="px-4 py-9 text-center text-[13px] leading-loose text-[#766b62]">
                注文する商品がありません。
              </p>
            ) : (
              pricedCart.map((line) => (
                <article
                  key={line.key}
                  className="mb-2.5 rounded-[10px] border border-[#e5dfd5] bg-white p-3.5"
                >
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <b className="min-w-0 font-bold break-words text-[#292725]">{line.nameEn ?? line.name}</b>
                    <strong className="shrink-0 font-bold text-[#292725] tabular-nums">
                      {yen(line.unitPrice * line.quantity)}
                    </strong>
                  </div>
                  {line.optionLabel && (
                    <p className="my-2 text-[11px] break-words text-[#766b62]">{line.optionLabel}</p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <small className="text-[10px] text-[#766b62] tabular-nums">
                      {yen(line.unitPrice)} / 点
                    </small>
                    <div className="mt-2.5 flex items-center gap-[11px]">
                      <button
                        type="button"
                        aria-label={`${line.name}を減らす`}
                        onClick={() => setCart((prev) => changeCartQuantity(prev, line.key, -1))}
                        className="h-10 w-10 rounded-[4px] border border-[#bc5940] text-[21px] leading-none text-[#bc5940]"
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
                        className="h-10 w-10 rounded-[4px] border border-[#bc5940] text-[21px] leading-none text-[#bc5940] disabled:opacity-40"
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
            <p className="px-3 py-2 text-center text-[10px] leading-[1.7] text-[#766b62]">
              お客様に読み上げて確認してから、下をスライドしてオーダー決定してください。
              <br />
              送信すると伝票 #{orderNo}（現在 {yen(unpaidTotal)}）に追加され、厨房へ流れます。
            </p>
          </div>
        </HandyMain>

        {/* オーダー決定はスライド（うっかりタップで送らない。2026-09-30 Ronnie） */}
        <div className="flex-none bg-[#fbf9f5] px-3.5 pt-3 pb-2.5">
          <SlideToConfirm
            label="オーダー決定"
            en="Slide to order"
            disabled={count === 0}
            pending={pending}
            onConfirm={handleSubmit}
          />
        </div>
      </>
    );
  }

  /* --------------------------------------------------------- メニュー */

  return (
    <>
      <header className="flex-none bg-[#292725]">
        <div className="flex h-12 items-stretch border-b-2 border-[#bc5940]">
          <BackToTable
            tableId={tableId}
            onClose={onClose}
            aria-label="卓の画面へ戻る"
            className="grid w-11 flex-none place-items-center text-white"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.2} aria-hidden />
          </BackToTable>
          {/* 上のタブ＝メニューブックのページ（レジと同じ並び） */}
          <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
            {pages.map((p, i) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={p.key === page?.key}
                ref={(el) => {
                  if (el && p.key === page?.key) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                }}
                onClick={() => setPageKey(p.key)}
                className={cn(
                  'flex min-w-[64px] flex-1 flex-col items-center justify-center gap-[3px] rounded-t-[11px] border border-b-0 px-1 text-xs leading-[1.15] font-bold whitespace-nowrap',
                  p.key === page?.key
                    ? 'border-[#fbf9f5] bg-[#fbf9f5] text-[#bc5940]'
                    : 'border-[#4a433d] bg-[#45403b] text-[#dcc0b0]'
                )}
              >
                <b className="block text-lg">{i + 1}</b>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex min-h-[27px] flex-none items-center justify-between gap-2 px-1.5 py-[5px] text-[10px] text-[#8a8a8a]">
        <span className="flex min-w-0 items-center gap-1.5">
          {/* 卓の画面へ戻る（2026-09-22 店舗要望「全部の画面で1ページ前に戻るボタンがほしい」） */}
          <BackToTable
            tableId={tableId}
            onClose={onClose}
            aria-label="卓の画面へ戻る"
            className="flex min-h-[34px] shrink-0 items-center gap-0.5 rounded-[8px] border border-[#ead9cc] bg-white pr-2.5 pl-1 text-[12px] font-bold text-[#bc5940] shadow-[0_1px_2px_#00000008] active:bg-[#f6e4da]"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.4} aria-hidden />
            戻る
          </BackToTable>
          <span className="truncate">{page?.label ?? '—'}</span>
          {category && page && page.categories.length > 1 && (category.nameEn ?? category.name) !== page.label && (
            <>
              <span className="shrink-0">›</span>
              <span className="truncate text-[#5c5650]">{category.nameEn ?? category.name}</span>
            </>
          )}
        </span>
        <BackToTable
          tableId={tableId}
          onClose={onClose}
          className="min-h-[30px] shrink-0 py-1.5 text-[10px] whitespace-nowrap text-[#bc5940]"
        >
          {seatLabel} · 伝票#{orderNo}
        </BackToTable>
      </div>

      {pages.length === 0 || !page ? (
        <HandyMain>
          <p className="px-6 py-9 text-center text-[13px] leading-loose text-[#766b62]">
            注文できる商品がありません。
            <br />
            メニュー設定を確認してください。
          </p>
        </HandyMain>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* 左：カテゴリのタテ一覧（1タップで切り替え。カートに入れた点数をバッジで） */}
          {page.categories.length > 1 && (
            <nav
              aria-label="カテゴリ"
              className="w-[104px] flex-none overflow-y-auto overscroll-contain border-r border-[#e5dfd5] bg-[#efe9e2] sm:w-[136px]"
            >
              {page.categories.map((c) => {
                const on = c.id === category?.id;
                const n = quantityByCategory.get(c.id) ?? 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setCatByPage((cur) => ({ ...cur, [page.key]: c.id }))}
                    className={cn(
                      'relative flex min-h-[54px] w-full flex-col items-start justify-center gap-0.5 border-b border-[#e3dbd0] px-2 py-2 text-left text-[12px] leading-[1.2] font-bold break-words',
                      on
                        ? 'border-l-4 border-l-[#bc5940] bg-[#fbf9f5] pl-[6px] text-[#bc5940]'
                        : 'text-[#5c5650] active:bg-[#f6e4da]'
                    )}
                  >
                    <span>{c.nameEn ?? c.name}</span>
                    {c.nameEn && <span className="text-[9px] font-normal text-[#8a8178]">{c.name}</span>}
                    {n > 0 && (
                      <span className="absolute top-1 right-1 min-w-[18px] rounded-full bg-[#bc5940] px-1 py-px text-center text-[10px] font-bold text-white">
                        {n}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          )}

          {/* 右：開いているカテゴリの商品 */}
          <HandyMain className="bg-[#f6f3ef]">
            {category && (
              <div className="px-2 pt-2 pb-5">
                <h2 className="mb-2 flex items-baseline gap-1.5 px-0.5 text-[13px] font-bold text-[#45403b]">
                  <span className="truncate">{category.nameEn ?? category.name}</span>
                  {category.nameEn && <span className="truncate text-[10px] font-normal text-[#8a8178]">{category.name}</span>}
                  <span className="ml-auto shrink-0 text-[11px] font-normal text-[#a89e92]">{category.items.length}品</span>
                </h2>
                <ul
                  className={cn(
                    'grid gap-2',
                    page.categories.length > 1 ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5' : 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6'
                  )}
                >
                  {category.items.map((item, i) => {
                    const inCart = quantityByItem.get(item.id) ?? 0;
                    const disabled = item.isSoldOut || item.offHours;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => handleItemTap(item)}
                          aria-label={`${item.name} ${yen(item.price)} を追加`}
                          style={disabled ? undefined : { borderBottomColor: TILE_ACCENTS[i % TILE_ACCENTS.length] }}
                          className={cn(
                            'tap3d relative flex min-h-[92px] w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-[10px] border border-[#e5dfd5] bg-white px-2 pt-3 pb-2.5 text-center text-[15px] leading-[1.25] font-bold break-words text-[#45403b]',
                            disabled ? 'border-b-[#e5dfd5] opacity-50' : 'active:bg-[#f6e4da]',
                            inCart > 0 && !disabled && 'border-[#bc5940] bg-[#f6e4da]'
                          )}
                        >
                          {/* ハンディは英語を主にする（日本語を読まないスタッフが打つため。2026-09-24 店舗要望）。
                              日本語名は下に小さく残す */}
                          <span>{item.nameEn ?? item.name}</span>
                          {item.nameEn && <span className="text-[10px] font-normal text-[#766b62]">{item.name}</span>}
                          <span className="text-[13px] font-bold text-[#bc5940] tabular-nums">{yen(item.price)}</span>
                          {item.isSoldOut && (
                            <span className="absolute inset-x-1.5 top-1/2 -translate-y-1/2 rounded bg-[#c62828] px-1 py-0.5 text-[11px] font-bold text-white">
                              売切
                            </span>
                          )}
                          {!item.isSoldOut && item.offHours && (
                            <span className="absolute inset-x-1.5 top-1/2 -translate-y-1/2 rounded bg-[#766b62] px-1 py-0.5 text-[11px] font-bold text-white">
                              時間外
                            </span>
                          )}
                          {inCart > 0 && (
                            <span className="absolute top-[5px] right-[5px] min-w-[22px] rounded-xl bg-[#bc5940] px-[6px] py-0.5 text-[11px] font-bold text-white">
                              {inCart}
                            </span>
                          )}
                          {item.hasOptions && (
                            <span className="absolute top-[5px] left-[6px] text-[9px] font-normal text-[#766b62]">選択肢</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                  {/* 単品のカテゴリの最後に「その他（価格入力）」。お客様が何か追加したとき金額を打って入れる（2026-10-07 Ronnie） */}
                  {category.tabId === 'alacarte' && (
                    <li>
                      <button
                        type="button"
                        onClick={() => setCustomTarget({ categoryId: category.id, label: category.nameEn ?? category.name })}
                        aria-label={`${category.name}：その他（金額を入力）`}
                        className="tap3d relative flex min-h-[92px] w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-[10px] border border-dashed border-[#d4b3a3] bg-[#fbf9f5] px-2 py-2 text-center text-[13px] font-bold text-[#bc5940] active:bg-[#f6e4da]"
                      >
                        <PenLine className="h-5 w-5" aria-hidden />
                        <span>Other</span>
                        <span className="text-[9px] font-normal text-[#766b62]">その他・金額入力</span>
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </HandyMain>
        </div>
      )}

      <div className="flex-none bg-[#fbf9f5] px-3.5 pt-2 pb-2.5">
        <button
          type="button"
          disabled={count === 0}
          onClick={() => setStep('review')}
          className="flex min-h-[48px] w-full items-center justify-between gap-2 rounded-[9px] bg-[#bc5940] px-4 text-base font-bold text-white shadow-[0_3px_10px_#bc59401a] active:bg-[#9f4630] disabled:opacity-40"
        >
          <span>注文確認へ（{count}点）</span>
          <span className="tabular-nums">{yen(total)}</span>
        </button>
      </div>

      {openPriceTarget && (
        <OpenPriceDialog
          itemName={openPriceTarget.nameEn ?? openPriceTarget.name}
          initial={null}
          onClose={() => setOpenPriceTarget(null)}
          onConfirm={(amount) => handleOpenPriceConfirm(amount)}
        />
      )}

      {customTarget && (
        <OpenPriceDialog
          itemName={`その他 / Other（${customTarget.label}）`}
          initial={null}
          withMemo
          onClose={() => setCustomTarget(null)}
          onConfirm={handleCustomConfirm}
        />
      )}

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

/** 卓の画面へ戻るリンク。ポップアップ（onClose あり）のときは閉じるボタンになる */
function BackToTable({
  tableId,
  onClose,
  className,
  children,
  'aria-label': ariaLabel,
}: {
  tableId: string;
  onClose?: () => void;
  className: string;
  children: React.ReactNode;
  'aria-label'?: string;
}) {
  if (onClose) {
    return (
      <button type="button" onClick={onClose} aria-label={ariaLabel ? '閉じる' : undefined} className={className}>
        {children}
      </button>
    );
  }
  return (
    <Link href={`/handy/${tableId}`} aria-label={ariaLabel} className={className}>
      {children}
    </Link>
  );
}
