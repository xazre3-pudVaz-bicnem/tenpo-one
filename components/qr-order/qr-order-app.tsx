'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { MenuView } from './menu-view';
import { ItemSheet } from './item-sheet';
import { CartBar } from './cart-bar';
import { ConfirmView } from './confirm-view';
import { SuccessView } from './success-view';
import { OrderStatusView } from './order-status-view';
import { QR_STRINGS, type QrLocale } from './strings';
import { QrStringsProvider } from './strings-context';
import {
  cartLineUnitPrice,
  qrOrderErrorMessage,
  sameModifiers,
  type CartLine,
  type QrMenuData,
  type QrMenuItem,
  type QrMenuModifier,
} from './types';

type Screen = 'menu' | 'confirm' | 'success';
type Tab = 'order' | 'status';

export interface ReservedCourse {
  name: string;
  includes_ayce: boolean | null;
  includes_drinks: boolean | null;
  duration_minutes: number | null;
  notes: string | null;
}

export function QrOrderApp({
  storeSlug,
  tableToken,
  menu,
  reservedCourse,
}: {
  storeSlug: string;
  tableToken: string;
  menu: QrMenuData;
  reservedCourse?: ReservedCourse | null;
}) {
  const [screen, setScreen] = useState<Screen>('menu');
  const [tab, setTab] = useState<Tab>('order');
  const [locale, setLocale] = useState<QrLocale>('ja');
  const qrStrings = QR_STRINGS[locale];
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedItem, setSelectedItem] = useState<QrMenuItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const addToCart = (item: QrMenuItem, quantity: number, memo: string, modifiers: QrMenuModifier[]) => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.menuItemId === item.id && l.memo === memo && sameModifiers(l.modifiers, modifiers));
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + quantity };
        return next;
      }
      return [
        ...prev,
        {
          key: `${item.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          menuItemId: item.id,
          name: item.name,
          price: item.price,
          quantity,
          memo,
          modifiers,
        },
      ];
    });
  };

  // カートが空になった状態で確認画面に留まらないようにする（削除操作の一環として画面遷移する）
  const removeFromCart = (key: string) => {
    setCart((prev) => {
      const next = prev.filter((l) => l.key !== key);
      if (next.length === 0) setScreen('menu');
      return next;
    });
  };

  const cartCount = cart.reduce((sum, l) => sum + l.quantity, 0);
  const cartTotal = cart.reduce((sum, l) => sum + cartLineUnitPrice(l) * l.quantity, 0);

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('create_qr_order', {
        p_slug: storeSlug,
        p_token: tableToken,
        p_items: cart.map((l) => ({
          menu_item_id: l.menuItemId,
          quantity: l.quantity,
          memo: l.memo || null,
          modifier_ids: l.modifiers.map((m) => m.id),
        })),
      });
      if (error) {
        setSubmitError(qrOrderErrorMessage(error.message));
        setSubmitting(false);
        return;
      }
      setCart([]);
      setSubmitting(false);
      setScreen('success');
    } catch {
      setSubmitError(qrOrderErrorMessage(null));
      setSubmitting(false);
    }
  };

  return (
    <QrStringsProvider value={qrStrings}>
    <div className="flex min-h-screen flex-col bg-surface">
      <div className="sticky top-0 z-30 bg-white shadow-sm">
        <div className="relative px-4 py-3 text-center">
          <p className="text-sm font-bold text-navy">{menu.store_name}</p>
          <p className="text-xs text-gray-500">{menu.table_name}</p>
          {/* 言語切替（JA/EN）。商品名・価格は実データのため翻訳せず、UI文言のみ切替 */}
          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 overflow-hidden rounded-full border border-gray-200 text-[11px]">
            {(['ja', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                className={locale === l ? 'bg-primary px-2 py-0.5 font-semibold text-white' : 'px-2 py-0.5 text-gray-500'}
              >
                {l === 'ja' ? '日本語' : 'EN'}
              </button>
            ))}
          </div>
        </div>
        {reservedCourse && (
          <div className="border-t border-primary/20 bg-primary-soft/60 px-4 py-2 text-center">
            <p className="text-xs font-semibold text-primary-deep">
              ご予約コース：{reservedCourse.name}
            </p>
            <p className="text-[11px] text-primary-deep/80">
              {[
                reservedCourse.includes_ayce && '食べ放題',
                reservedCourse.includes_drinks && '飲み放題',
                reservedCourse.duration_minutes && `${reservedCourse.duration_minutes}分`,
              ].filter(Boolean).join('・')}
              {' '}※コースは注文不要です。追加のご注文のみお選びください
            </p>
          </div>
        )}
        {screen === 'menu' && (
          <div className="flex border-t border-gray-100">
            {(['order', 'status'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'flex-1 py-2.5 text-sm font-semibold transition-colors',
                  tab === t ? 'border-b-2 border-primary text-primary-deep' : 'text-gray-400'
                )}
              >
                {t === 'order' ? qrStrings.header.orderTab : qrStrings.header.statusTab}
              </button>
            ))}
          </div>
        )}
      </div>

      <main className={cn('flex-1', screen === 'menu' && tab === 'order' && cart.length > 0 && 'pb-24')}>
        {screen === 'menu' && tab === 'order' && <MenuView categories={menu.categories} onSelectItem={setSelectedItem} />}
        {screen === 'menu' && tab === 'status' && <OrderStatusView storeSlug={storeSlug} tableToken={tableToken} />}
        {screen === 'confirm' && (
          <ConfirmView
            cart={cart}
            total={cartTotal}
            submitting={submitting}
            error={submitError}
            onRemove={removeFromCart}
            onBack={() => setScreen('menu')}
            onSubmit={handleSubmit}
          />
        )}
        {screen === 'success' && (
          <SuccessView
            onViewStatus={() => {
              setTab('status');
              setScreen('menu');
            }}
            onBackToMenu={() => {
              setTab('order');
              setScreen('menu');
            }}
          />
        )}
      </main>

      {screen === 'menu' && tab === 'order' && cart.length > 0 && (
        <CartBar count={cartCount} total={cartTotal} onOrder={() => setScreen('confirm')} />
      )}

      {selectedItem && (
        <ItemSheet
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onAdd={(quantity, memo, modifiers) => {
            addToCart(selectedItem, quantity, memo, modifiers);
            setSelectedItem(null);
          }}
        />
      )}
    </div>
    </QrStringsProvider>
  );
}
