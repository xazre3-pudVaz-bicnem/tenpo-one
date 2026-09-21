'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Minus, Plus, ShoppingCart, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { OptionDialog, type PosOptionGroup } from '@/components/pos/option-dialog';
import {
  addCartLine,
  cartCount,
  cartLineKey,
  cartTotal,
  changeCartQuantity,
  MAX_LINE_QUANTITY,
  TILE_ACCENTS,
  type HandyCartLine,
  type HandyGroupView,
  type HandyMenuItemView,
} from './logic';
import type { HandyOrderLineInput, HandySubmitResult } from '@/app/app/handy/actions';

export function HandyOrderScreen({
  tableId,
  tableName,
  orderId,
  orderNo,
  guestCount,
  unpaidTotal,
  groups,
  optionGroupsByItem,
  submitAction,
}: {
  tableId: string;
  tableName: string;
  orderId: string;
  orderNo: number;
  guestCount: number;
  unpaidTotal: number;
  groups: HandyGroupView[];
  optionGroupsByItem: Record<string, PosOptionGroup[]>;
  submitAction: (orderId: string, lines: HandyOrderLineInput[]) => Promise<HandySubmitResult>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tabId, setTabId] = useState<string>(groups[0]?.id ?? 'food');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<HandyCartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [optionTarget, setOptionTarget] = useState<HandyMenuItemView | null>(null);
  const [pending, startTransition] = useTransition();
  // 二重送信の保険（連打で startTransition が2回走るのを防ぐ）
  const sendingRef = useRef(false);

  const group = groups.find((g) => g.id === tabId) ?? groups[0] ?? null;
  const category = group?.categories.find((c) => c.id === categoryId) ?? null;

  const quantityByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of cart) map.set(line.menuItemId, (map.get(line.menuItemId) ?? 0) + line.quantity);
    return map;
  }, [cart]);

  const count = cartCount(cart);
  const total = cartTotal(cart);

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
          setCartOpen(true);
          toast(`${result.sentQuantity}点を送信しました。${result.message}`, 'error');
          return;
        }
        setCart([]);
        setCartOpen(false);
        toast(`${tableName} へ ${result.sentQuantity}点を送信しました`, 'success');
        router.push(`/app/handy/${tableId}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : '送信に失敗しました', 'error');
      } finally {
        sendingRef.current = false;
      }
    });
  };

  return (
    <div className="-mt-4 pb-40 lg:-mt-[18px]">
      {/* 上位分類タブ（細い画面では横スクロール） */}
      <div className="sticky top-[58px] z-20 -mx-4 flex items-stretch gap-1 border-b border-line bg-plum px-1 lg:-mx-[22px] lg:px-2">
        <Link
          href={`/app/handy/${tableId}`}
          aria-label="卓の画面へ戻る"
          className="flex w-10 shrink-0 items-center justify-center text-white/90 hover:text-white"
        >
          <ChevronLeft className="h-6 w-6" aria-hidden />
        </Link>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-1.5">
          {groups.map((g, i) => (
            <button
              key={g.id}
              type="button"
              aria-pressed={g.id === tabId}
              onClick={() => {
                setTabId(g.id);
                setCategoryId(null);
              }}
              className={cn(
                'flex min-w-[76px] shrink-0 flex-col items-center justify-center rounded-lg px-3 py-1 leading-tight transition-colors',
                g.id === tabId ? 'bg-white text-royal' : 'bg-plum-2 text-white/80'
              )}
            >
              <b className="text-base font-bold">{i + 1}</b>
              <span className="whitespace-nowrap text-xs font-bold">{g.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* パンくず（分類 › カテゴリ）と卓の情報 */}
      <div className="flex items-center justify-between gap-2 py-2 text-xs">
        <span className="flex min-w-0 items-center gap-1 text-ink-2">
          {category ? (
            <button
              type="button"
              onClick={() => setCategoryId(null)}
              className="truncate font-medium text-primary hover:underline"
            >
              {group?.label}
            </button>
          ) : (
            <span className="truncate font-medium">{group?.label ?? '—'}</span>
          )}
          {category && (
            <>
              <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate font-bold text-navy">{category.name}</span>
            </>
          )}
        </span>
        <span className="shrink-0 font-medium text-ink-2">
          {tableName} · {guestCount}名 · 伝票#{orderNo}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-line bg-white p-6 text-center text-sm text-ink-2">
          注文できる商品がありません。メニュー設定を確認してください。
        </p>
      ) : !category ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {(group?.categories ?? []).map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setCategoryId(c.id)}
                style={{ borderBottomColor: TILE_ACCENTS[i % TILE_ACCENTS.length] }}
                className="flex aspect-square w-full flex-col justify-center rounded-xl border border-line border-b-4 bg-white p-2 text-left transition-colors hover:bg-lilac-soft"
              >
                <span className="flex items-center justify-between gap-0.5">
                  <b className="min-w-0 text-sm font-bold leading-snug text-navy">{c.name}</b>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                </span>
                {c.nameEn && <span className="en-inline mt-0.5 line-clamp-1 text-[10px]">{c.nameEn}</span>}
                <span className="mt-1 text-[11px] text-ink-3">{c.items.length}品</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
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
                    'relative flex aspect-square w-full flex-col justify-between rounded-xl border border-line border-b-4 bg-white p-2 text-left transition-colors',
                    disabled ? 'border-b-line opacity-50' : 'hover:bg-lilac-soft active:bg-iris-soft'
                  )}
                >
                  <span className="min-w-0">
                    <span className="line-clamp-3 text-sm font-bold leading-snug text-navy">{item.name}</span>
                    {item.nameEn && <span className="en-inline mt-0.5 line-clamp-1 text-[10px]">{item.nameEn}</span>}
                  </span>
                  <span className="flex items-end justify-between gap-1">
                    <span className="font-mono text-xs font-bold text-ink-2">{yen(item.price)}</span>
                    {item.hasOptions && <span className="text-[10px] text-ink-3">選択肢あり</span>}
                  </span>
                  {item.isSoldOut && (
                    <span className="absolute inset-x-2 top-1/2 -translate-y-1/2 rounded bg-danger px-1 py-0.5 text-center text-[11px] font-bold text-white">
                      売切
                    </span>
                  )}
                  {!item.isSoldOut && item.offHours && (
                    <span className="absolute inset-x-2 top-1/2 -translate-y-1/2 rounded bg-ink-3 px-1 py-0.5 text-center text-[11px] font-bold text-white">
                      時間外
                    </span>
                  )}
                  {inCart > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-iris px-1.5 text-xs font-bold text-white">
                      {inCart}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* 下部固定の操作バー（スマホ下部ナビの上に重ねる） */}
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+52px)] z-30 lg:bottom-0 lg:pl-[250px]">
        <div className="mx-auto w-full border-t border-line bg-white px-3 pb-2 pt-2 shadow-[0_-4px_16px_rgba(36,20,54,0.12)]">
          {cartOpen && (
            <div id="handy-cart" className="mb-2 max-h-[38vh] overflow-y-auto rounded-xl border border-line">
              {cart.length === 0 ? (
                <p className="p-4 text-center text-sm text-ink-3">カートは空です。</p>
              ) : (
                <ul className="divide-y divide-line">
                  {cart.map((line) => (
                    <li key={line.key} className="flex items-center gap-2 px-2.5 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-navy">{line.name}</span>
                        {line.optionLabel && (
                          <span className="block truncate text-[11px] text-ink-3">{line.optionLabel}</span>
                        )}
                        <span className="font-mono text-[11px] text-ink-2">{yen(line.unitPrice)} / 点</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          aria-label={`${line.name}を減らす`}
                          onClick={() => setCart((prev) => changeCartQuantity(prev, line.key, -1))}
                          className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-navy"
                        >
                          <Minus className="h-4 w-4" aria-hidden />
                        </button>
                        <b className="w-6 text-center text-base font-bold">{line.quantity}</b>
                        <button
                          type="button"
                          aria-label={`${line.name}を増やす`}
                          disabled={line.quantity >= MAX_LINE_QUANTITY}
                          onClick={() => setCart((prev) => changeCartQuantity(prev, line.key, 1))}
                          className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-navy disabled:opacity-40"
                        >
                          <Plus className="h-4 w-4" aria-hidden />
                        </button>
                      </span>
                      <span className="w-16 shrink-0 text-right font-mono text-sm font-bold text-navy">
                        {yen(line.unitPrice * line.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCartOpen((v) => !v)}
              aria-expanded={cartOpen}
              aria-controls="handy-cart"
              className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-lg bg-lilac px-3 text-left"
            >
              {cartOpen ? (
                <X className="h-5 w-5 shrink-0 text-royal" aria-hidden />
              ) : (
                <ShoppingCart className="h-5 w-5 shrink-0 text-royal" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] leading-tight text-ink-2">
                  未送信カート{count > 0 ? `（${count}点）` : ''}
                </span>
                <b className="block truncate font-mono text-base font-bold leading-tight text-navy">{yen(total)}</b>
              </span>
            </button>
            <Button
              className="h-12 shrink-0 px-5 text-base"
              disabled={pending || count === 0}
              onClick={handleSubmit}
            >
              {pending ? '送信中…' : '注文を送信'}
            </Button>
          </div>
          <p className="mt-1 text-center text-[10px] text-ink-3">
            この卓の未会計合計 {yen(unpaidTotal)}（送信すると伝票 #{orderNo} に追加されます）
          </p>
        </div>
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
    </div>
  );
}
