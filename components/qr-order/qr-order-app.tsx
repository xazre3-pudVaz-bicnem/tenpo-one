'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, LayoutGrid, ReceiptText, ShoppingCart } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { MenuView } from './menu-view';
import { ItemSheet } from './item-sheet';
import { CartView } from './cart-view';
import { HistoryView } from './history-view';
import { CallView } from './call-view';
import { QR_STRINGS, type QrLocale } from './strings';
import { QrStringsProvider } from './strings-context';
import {
  addCartLine,
  cartCount,
  cartTotal,
  changeCartQuantity,
  openServiceCall,
  parseServiceCalls,
  removeCartLine,
  type QrMenuPage,
} from './logic';
import {
  qrOrderErrorMessage,
  qrServiceCallErrorMessage,
  type CartLine,
  type QrMenuData,
  type QrMenuItem,
  type QrMenuModifier,
  type QrOrderStatus,
  type QrServiceCall,
  type ServiceCallKind,
} from './types';

/**
 * お客様QR画面（承認済みレイアウト 2026-09-21）。
 * ヘッダーは店名のみ、下部固定でメニュー／カート／履歴・会計／呼び出しの4タブ、最下部に Powered by。
 * 配色は /app（.theme-regi）に依存しないよう、この画面内でプラム・藤色・アイリスを指定する。
 */

/**
 * 注文状況と呼び出し状況の自動更新間隔（ミリ秒）。
 * QRのお客様はSupabaseの認証セッションを持たない匿名アクセスで、Realtimeの postgres_changes 購読は
 * RLS評価に auth.uid() 等を要するため利用できない。KDS/フロア等と異なりこの画面はポーリングを維持する。
 */
const REFRESH_INTERVAL_MS = 10000;
/**
 * メニューの取り直しの最短間隔（ミリ秒）。スタッフが飲み放題などを伝票に入れると、
 * そのプランの中身（F）がメニューに出るようになるため、画面に戻ったとき・メニューを開き直したときに取り直す。
 */
const MENU_REFRESH_MIN_MS = 30000;
const NOTICE_MS = 3200;

type Tab = 'menu' | 'cart' | 'history' | 'call';

export interface ReservedCourse {
  name: string;
  includes_ayce: boolean | null;
  includes_drinks: boolean | null;
  duration_minutes: number | null;
  notes: string | null;
}

/** 送信済み注文（get_qr_order_status）と未対応の呼び出し（get_qr_service_calls）を同じ間隔で取得する */
/**
 * 卓の状態（送信済み注文・呼び出し）の取得。
 * 匿名セッションのためRealtimeは使えず、ポーリングで追う。
 * ただし全席のスマホが常時2本のRPCを叩くと店舗規模で負荷になるため、
 * 見ている画面で必要なものだけを取り、メニュー閲覧中は呼び出しの経過がある間だけ確認する。
 */
function useQrTableState(storeSlug: string, tableToken: string, tab: Tab) {
  const [status, setStatus] = useState<QrOrderStatus | null>(null);
  const [calls, setCalls] = useState<QrServiceCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const hasOpenCalls = calls.length > 0;

  const refresh = useCallback(
    async (opts: { status?: boolean; calls?: boolean } = { status: true, calls: true }) => {
      const supabase = createClient();
      const [statusResult, callsResult] = await Promise.all([
        opts.status ? supabase.rpc('get_qr_order_status', { p_slug: storeSlug, p_token: tableToken }) : null,
        opts.calls ? supabase.rpc('get_qr_service_calls', { p_slug: storeSlug, p_token: tableToken }) : null,
      ]);
      if (statusResult) {
        if (statusResult.error || !statusResult.data) {
          // 取得できなかったことを隠さない。直前に取れた内容はそのまま残す
          setFetchError(qrOrderErrorMessage(statusResult.error?.message));
        } else {
          setStatus(statusResult.data as QrOrderStatus);
          setFetchError(null);
        }
      }
      if (callsResult && !callsResult.error) setCalls(parseServiceCalls(callsResult.data));
      setLoading(false);
    },
    [storeSlug, tableToken]
  );

  useEffect(() => {
    // 画面ごとに必要なものだけを定期取得する
    const wantStatus = tab === 'history';
    const wantCalls = tab === 'history' || tab === 'call' || hasOpenCalls;
    // 画面を切り替えたときは一度だけ両方取り直す（再読込後に呼び出し中を復元するため）。
    // 同期的な setState を避けるため、非同期関数として呼ぶ
    (async () => {
      await refresh();
    })();
    if (!wantStatus && !wantCalls) return;
    const id = setInterval(() => {
      void refresh({ status: wantStatus, calls: wantCalls });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh, tab, hasOpenCalls]);

  return { status, calls, setCalls, loading, fetchError, refresh };
}

export function QrOrderApp({
  storeSlug,
  tableToken,
  menu,
  pages,
  reservedCourse,
  planOver = false,
}: {
  storeSlug: string;
  tableToken: string;
  menu: QrMenuData;
  /** メニューブックのページ（タブのまとめ方。飲み放題・コースの卓は飲み放題のページが先頭） */
  pages?: QrMenuPage[] | null;
  reservedCourse?: ReservedCourse | null;
  /** プラン（飲み放題等）の時間が終わっているか。終わっていたらお客様にその旨を出す */
  planOver?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('menu');
  const [locale, setLocale] = useState<QrLocale>('ja');
  const qrStrings = QR_STRINGS[locale];
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedItem, setSelectedItem] = useState<QrMenuItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  // カート行のキー。描画中に値が変わらないよう、操作のたびに採番する
  const lineSeq = useRef(0);

  const { status, calls, setCalls, loading, fetchError, refresh } = useQrTableState(storeSlug, tableToken, tab);

  // メニュー（サーバーで絞った内容）を取り直す。カートなどの画面の状態はそのまま残る
  const router = useRouter();
  const menuFetchedAt = useRef(0);
  const refreshMenu = useCallback(() => {
    const now = Date.now();
    if (now - menuFetchedAt.current < MENU_REFRESH_MIN_MS) return;
    menuFetchedAt.current = now;
    router.refresh();
  }, [router]);

  useEffect(() => {
    menuFetchedAt.current = Date.now();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshMenu();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshMenu]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice]);

  const goToTab = (next: Tab) => {
    if (next === 'menu' && tab !== 'menu') refreshMenu();
    setTab(next);
    mainRef.current?.scrollTo({ top: 0 });
  };

  const addToCart = (item: QrMenuItem, quantity: number, memo: string, modifiers: QrMenuModifier[]) => {
    lineSeq.current += 1;
    const key = `${item.id}_${lineSeq.current}`;
    setCart((prev) => addCartLine(prev, item, quantity, memo, modifiers, key));
  };

  const count = cartCount(cart);
  const total = cartTotal(cart);

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
      setNotice(qrStrings.cart.sent);
      goToTab('history');
      await refresh();
    } catch {
      setSubmitError(qrOrderErrorMessage(null));
      setSubmitting(false);
    }
  };

  const handleCall = async (kind: ServiceCallKind) => {
    setCalling(true);
    setCallError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('create_qr_service_call', {
        p_slug: storeSlug,
        p_token: tableToken,
        p_kind: kind,
      });
      if (error || !data) {
        setCallError(qrServiceCallErrorMessage(error?.message));
        setCalling(false);
        return;
      }
      // 送信できたときだけ「呼び出し中」に変える。表示は次のポーリングでサーバー側と一致する
      const created = data as { kind?: string; created_at?: string };
      setCalls((prev) =>
        openServiceCall(prev, kind)
          ? prev
          : [...prev, { kind, created_at: typeof created.created_at === 'string' ? created.created_at : '' }]
      );
      setCalling(false);
      setNotice(kind === 'checkout' ? qrStrings.history.checkoutPending : qrStrings.call.pending);
      await refresh();
    } catch {
      setCallError(qrServiceCallErrorMessage(null));
      setCalling(false);
    }
  };

  const navItems: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
    { id: 'menu', label: qrStrings.nav.menu, icon: LayoutGrid },
    { id: 'cart', label: qrStrings.nav.cart, icon: ShoppingCart },
    { id: 'history', label: qrStrings.nav.history, icon: ReceiptText },
    { id: 'call', label: qrStrings.nav.call, icon: Bell },
  ];

  return (
    <QrStringsProvider locale={locale}>
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-lilac-soft text-ink">
        {/* ヘッダーは店名のみ（ロゴ・ベルは置かない）。言語は店名の下で選ぶ（2026-09-24 店舗要望：
            日本語と英語を上で選べるように。開いたときは日本語） */}
        <header className="flex-none bg-plum px-4 py-3.5 text-center">
          <p className="text-[21px] font-bold leading-snug text-white [overflow-wrap:anywhere]">{menu.store_name}</p>
          <div className="mt-2 inline-flex overflow-hidden rounded-full border border-white/30">
            {(['ja', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                aria-pressed={locale === l}
                aria-label={l === 'ja' ? '日本語に切り替える' : 'Switch to English'}
                className={cn(
                  'min-h-8 px-3.5 text-[12px] font-bold',
                  locale === l ? 'bg-white text-plum' : 'text-white/75'
                )}
              >
                {l === 'ja' ? '日本語' : 'English'}
              </button>
            ))}
          </div>
        </header>

        {reservedCourse && (
          <div className="flex-none border-b border-line bg-lilac px-4 py-2 text-center">
            <p className="text-[11px] font-bold text-[#5e4e5a]">ご予約コース：{reservedCourse.name}</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-ink-3">
              {[
                reservedCourse.includes_ayce && '食べ放題',
                reservedCourse.includes_drinks && '飲み放題',
                reservedCourse.duration_minutes && `${reservedCourse.duration_minutes}分`,
              ]
                .filter(Boolean)
                .join('・')}{' '}
              ※コースは注文不要です。追加のご注文のみお選びください
            </p>
          </div>
        )}

        <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {tab === 'menu' && (
            <MenuView
              tableName={menu.table_name}
              categories={menu.categories}
              pages={pages}
              cart={cart}
              onSelectItem={setSelectedItem}
              onQuickAdd={(item) => addToCart(item, 1, '', [])}
              planOver={planOver}
            />
          )}
          {tab === 'cart' && (
            <CartView
              cart={cart}
              submitting={submitting}
              error={submitError}
              onChangeQuantity={(key, delta) => setCart((prev) => changeCartQuantity(prev, key, delta))}
              onRemove={(key) => setCart((prev) => removeCartLine(prev, key))}
              onSubmit={handleSubmit}
              onBackToMenu={() => goToTab('menu')}
            />
          )}
          {tab === 'history' && (
            <HistoryView
              status={status}
              loading={loading}
              fetchError={fetchError}
              calls={calls}
              calling={calling}
              callError={callError}
              onRequestCheckout={() => void handleCall('checkout')}
            />
          )}
          {tab === 'call' && (
            <CallView
              tableName={menu.table_name}
              calls={calls}
              calling={calling}
              error={callError}
              onCallStaff={() => void handleCall('staff')}
              onBackToMenu={() => goToTab('menu')}
            />
          )}
        </main>

        {/* カートの控え（メニュー閲覧中のみ）。送信はカートタブで行う */}
        {tab === 'menu' && count > 0 && (
          <div className="flex-none bg-lilac-soft px-4 py-2.5">
            <button
              type="button"
              onClick={() => goToTab('cart')}
              className="flex min-h-[50px] w-full items-center justify-between rounded-xl bg-iris px-4 py-2.5 text-xs font-semibold text-white active:scale-[0.99]"
            >
              <span className="flex items-center gap-2">
                <b className="grid h-7 min-w-7 place-items-center rounded-lg bg-white/15 font-num text-sm">{count}</b>
                {qrStrings.cartDock.review}
              </span>
              <strong className="font-num text-[15px] font-bold tabular-nums">{yen(total)} ›</strong>
            </button>
          </div>
        )}

        <nav
          aria-label={qrStrings.nav.menu}
          className="grid flex-none grid-cols-4 gap-1 border-t border-line bg-white px-2.5 pb-1 pt-[7px]"
        >
          {navItems.map(({ id, label, icon: Icon }) => {
            const selected = tab === id;
            const badge = id === 'cart' && count > 0 ? ` · ${count}` : '';
            const pending =
              (id === 'call' && openServiceCall(calls, 'staff')) ||
              (id === 'history' && openServiceCall(calls, 'checkout'));
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                onClick={() => goToTab(id)}
                className={cn(
                  'relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-[9px] px-0.5 py-2 text-[10px] font-semibold',
                  selected ? 'bg-[#f7e9f0] text-iris' : 'text-[#a896a2]'
                )}
              >
                <Icon className="h-[22px] w-[22px]" strokeWidth={1.5} />
                <span className="whitespace-nowrap">
                  {label}
                  {badge}
                </span>
                {pending && <span className="absolute right-4 top-2 h-1.5 w-1.5 rounded-full bg-iris" />}
              </button>
            );
          })}
        </nav>

        <footer className="flex-none bg-white px-2.5 pb-[calc(6px+env(safe-area-inset-bottom))] pt-1 text-center text-[10px] leading-snug text-[#8f7f8b]">
          {qrStrings.poweredBy}{' '}
          <strong className="font-num text-[11px] tracking-wide text-[#5a4458]">
            <span className="text-[#b4468a]">TENPO</span> ONE
          </strong>
        </footer>

        {notice && (
          <p
            role="status"
            aria-live="polite"
            className="fixed bottom-24 left-1/2 z-40 max-w-[90%] -translate-x-1/2 rounded-xl bg-plum/95 px-4 py-3 text-xs font-medium text-white shadow-lg"
          >
            {notice}
          </p>
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
