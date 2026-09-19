'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Minus, Plus, X, ArrowLeft, Split, Combine, ArrowRightLeft, Search, Star, Flame, User, XCircle,
  FilePlus, Printer, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { englishName } from '@/lib/romaji';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useStoreRealtimeRefresh } from '@/components/realtime/use-store-refresh';
import { createMockDrawerProvider } from '@/lib/printing/providers';
import { enqueueDrawerKick, enqueueOrderSlipPrint } from '@/app/app/pos/print-actions';
import { ClerkSelector, type ClerkOption } from './clerk-selector';
import { OptionDialog, type PosOptionGroup } from './option-dialog';
import { shouldOpenDrawer, type DrawerResultStatus } from '@/lib/printing/types';
import {
  CheckoutDialog,
  type CheckoutOrder,
  type PosPaymentAvailability,
  type PosTerminalReader,
  type PointsAvailability,
} from './checkout-dialog';
import { SplitDialog } from './split-dialog';
import { MergeDialog, type MergeCandidate } from './merge-dialog';
import { TableMoveDialog, type AvailableTable } from './table-move-dialog';
import { GuestCountDialog } from './guest-count-dialog';
import { CustomerLinkDialog } from './customer-link-dialog';
import { POS_SHORTCUTS } from './shortcuts';
import type {
  CheckoutPayment, CheckoutOutcome, SplitMove, ApplyCouponResult,
  PosCustomerSearchResult, SetOrderCustomerResult,
} from '@/app/app/pos/actions';
import type { TerminalPaymentState } from '@/app/app/pos/payment-actions';

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: '店内',
  takeout: 'テイクアウト',
  delivery: 'デリバリー',
  course: 'コース',
  pre_order: '事前注文',
};

/** ドロア開放結果の表示ラベル（プリンター実機未接続のためシミュレーション結果） */
const DRAWER_STATUS_LABELS: Record<DrawerResultStatus, string> = {
  opened: 'ドロアを開きました（シミュレーション）',
  failed: 'ドロアが開きませんでした（シミュレーション）',
  offline: 'ドロアがオフラインです（シミュレーション）',
};

const FAVORITES_TAB = '__favorites__';
const BESTSELLERS_TAB = '__bestsellers__';

export interface PosOrder {
  id: string;
  orderNo: number;
  orderType: string;
  guestCount: number;
  discountTotal: number;
  discountReason: string | null;
  couponCode: string | null;
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  total: number;
  tableId: string | null;
}

export interface PosOrderItem {
  id: string;
  /** 英語名を引くための参照。削除済み商品や手入力行では null */
  menu_item_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  tax_rate: number;
  tax_included: boolean;
  line_total: number;
  status: string;
}

export interface PosCategory {
  id: string;
  name: string;
  name_en: string | null;
  color: string | null;
  sort_order: number;
}

export interface PosMenuItem {
  id: string;
  category_id: string | null;
  name: string;
  name_en: string | null;
  name_kana: string | null;
  price: number;
  takeout_price: number | null;
  item_type: string;
  is_sold_out: boolean;
  is_recommended: boolean;
  sort_order: number;
}

export interface PosCustomer {
  id: string;
  name: string;
  phone: string | null;
  pointBalance: number;
}

export interface DrawerConfig {
  autoOpenOnCash: boolean;
  openOnCashless: boolean;
}

function matchesQuery(item: PosMenuItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // 日本語・カナに加えて英語名でも引けるようにする（英語しか読めないスタッフが打てるように）
  const en = englishName(item.name, item.name_kana, item.name_en);
  return (
    item.name.toLowerCase().includes(q) ||
    (item.name_kana ?? '').toLowerCase().includes(q) ||
    (en ?? '').toLowerCase().includes(q)
  );
}

export function PosScreen({
  storeId,
  order,
  items,
  categories,
  menuItems,
  bestSellerIds,
  tableName,
  staffName,
  clerks,
  currentClerkId,
  optionGroupsByItem,
  customer,
  pointsAvailability,
  drawerConfig,
  canDiscount,
  canCheckout,
  terminalReaders,
  paymentAvailability,
  otherOpenOrders,
  availableTables,
  addItemAction,
  updateQtyAction,
  cancelItemAction,
  setDiscountAction,
  checkoutAction,
  splitOrderAction,
  mergeOrdersAction,
  moveTableAction,
  cancelEmptyOrderAction,
  setGuestCountAction,
  addSlipToTableAction,
  startTerminalPaymentAction,
  checkTerminalPaymentAction,
  cancelTerminalPaymentAction,
  applyCouponAction,
  clearCouponAction,
  searchCustomerAction,
  setOrderCustomerAction,
}: {
  storeId: string;
  order: PosOrder;
  items: PosOrderItem[];
  categories: PosCategory[];
  menuItems: PosMenuItem[];
  /** 過去30日の販売数量TOP12（menu_item_id）。多い順 */
  bestSellerIds: string[];
  tableName: string | null;
  staffName: string | null;
  /** 店舗に登録されたPOS担当者（会計時に選ぶ名前。アカウントではない） */
  clerks: ClerkOption[];
  currentClerkId: string | null;
  /** 商品ID → 選択肢グループ。設定がある商品はタップ時に選択ダイアログを出す */
  optionGroupsByItem: Record<string, PosOptionGroup[]>;
  customer: PosCustomer | null;
  pointsAvailability: PointsAvailability;
  drawerConfig: DrawerConfig;
  canDiscount: boolean;
  canCheckout: boolean;
  terminalReaders: PosTerminalReader[];
  paymentAvailability: PosPaymentAvailability;
  otherOpenOrders: MergeCandidate[];
  availableTables: AvailableTable[];
  addItemAction: (orderId: string, menuItemId: string, optionItemIds?: string[]) => Promise<void>;
  updateQtyAction: (orderId: string, orderItemId: string, delta: number) => Promise<void>;
  cancelItemAction: (orderId: string, orderItemId: string, reason: string) => Promise<void>;
  setDiscountAction: (orderId: string, discountTotal: number, reason: string) => Promise<void>;
  checkoutAction: (orderId: string, payments: CheckoutPayment[]) => Promise<CheckoutOutcome>;
  splitOrderAction: (orderId: string, moves: SplitMove[]) => Promise<{ newOrderId: string }>;
  mergeOrdersAction: (targetOrderId: string, sourceOrderId: string) => Promise<void>;
  moveTableAction: (orderId: string, newTableId: string) => Promise<{ tableName: string }>;
  /** 品目のない注文（会計前・¥0）を取消する。省略時はボタンを表示しない */
  cancelEmptyOrderAction?: (orderId: string, reason: string) => Promise<void>;
  /** 注文後の人数変更。省略時は人数バッジを押しても何も起きない */
  setGuestCountAction?: (orderId: string, guestCount: number) => Promise<void>;
  /** 同じテーブルに空の伝票をもう1枚作る（別会計用）。省略時はボタンを表示しない */
  addSlipToTableAction?: (orderId: string) => Promise<{ newOrderId: string; orderNo: number }>;
  startTerminalPaymentAction: (orderId: string, readerId: string) => Promise<TerminalPaymentState>;
  checkTerminalPaymentAction: (localIntentId: string) => Promise<TerminalPaymentState>;
  cancelTerminalPaymentAction: (localIntentId: string) => Promise<TerminalPaymentState>;
  applyCouponAction: (orderId: string, code: string, force?: boolean) => Promise<ApplyCouponResult>;
  clearCouponAction: (orderId: string) => Promise<void>;
  searchCustomerAction: (phone: string) => Promise<PosCustomerSearchResult[]>;
  setOrderCustomerAction: (orderId: string, customerId: string | null) => Promise<SetOrderCustomerResult>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [activeCategory, setActiveCategory] = useState<string>(categories[0]?.id ?? '');
  const [searchQuery, setSearchQuery] = useState('');
  const [cancelTarget, setCancelTarget] = useState<PosOrderItem | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [tableMoveOpen, setTableMoveOpen] = useState(false);
  const [cancelOrderOpen, setCancelOrderOpen] = useState(false);
  const [guestCountOpen, setGuestCountOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [optionTarget, setOptionTarget] = useState<string | null>(null);
  const [linkedCustomer, setLinkedCustomer] = useState(customer);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // QRからの追加注文が同じ order_items を更新するため、変更をRealtimeで検知して伝票へ反映する。
  // order_idまでは絞り込まず、store_id単位で購読する（filter仕様上のシンプルさを優先）。
  useStoreRealtimeRefresh({ storeId, tables: ['order_items'] });

  // キーボードショートカット（F2=検索フォーカス / F4=会計を開く）。Escでのダイアログ閉じは
  // components/ui/dialog.tsx 側で共通実装済みのためここでは扱わない。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (items.length > 0) setCheckoutOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [items.length]);

  // サーバー側（app/app/pos/actions.ts の addItem）と同じ判定にする。pre_order（事前注文）も
  // テイクアウト価格・軽減税率の対象（lib/tax.ts の applicableTaxRate 参照）。
  const isTakeoutLike =
    order.orderType === 'takeout' || order.orderType === 'delivery' || order.orderType === 'pre_order';
  const bestSellerRank = useMemo(() => new Map(bestSellerIds.map((id, i) => [id, i])), [bestSellerIds]);

  // 商品ID → 英語名。伝票明細は商品名のスナップショットしか持たないため、ここから引く
  // （メニューから消された商品は引けない＝日本語のみ表示になる）。
  const englishByItemId = useMemo(
    () => new Map(menuItems.map((m) => [m.id, englishName(m.name, m.name_kana, m.name_en)])),
    [menuItems]
  );

  const visibleItems = useMemo(() => {
    if (searchQuery.trim()) {
      return menuItems.filter((m) => matchesQuery(m, searchQuery));
    }
    if (activeCategory === FAVORITES_TAB) {
      return menuItems.filter((m) => m.is_recommended);
    }
    if (activeCategory === BESTSELLERS_TAB) {
      return menuItems
        .filter((m) => bestSellerRank.has(m.id))
        .sort((a, b) => bestSellerRank.get(a.id)! - bestSellerRank.get(b.id)!);
    }
    return activeCategory
      ? menuItems.filter((m) => m.category_id === activeCategory)
      : menuItems.filter((m) => !m.category_id);
  }, [menuItems, activeCategory, searchQuery, bestSellerRank]);

  const addWithOptions = (menuItemId: string, optionItemIds: string[]) => {
    startTransition(async () => {
      try {
        await addItemAction(order.id, menuItemId, optionItemIds);
      } catch (e) {
        toast(e instanceof Error ? e.message : '追加に失敗しました', 'error');
      }
    });
  };

  const handleAdd = (menuItemId: string) => {
    // 選択肢グループが設定された商品は、先に選択ダイアログを出す
    const groups = optionGroupsByItem[menuItemId];
    if (groups && groups.length > 0) {
      setOptionTarget(menuItemId);
      return;
    }
    addWithOptions(menuItemId, []);
  };

  const handleQty = (orderItemId: string, delta: number) => {
    startTransition(async () => {
      try {
        await updateQtyAction(order.id, orderItemId, delta);
      } catch (e) {
        toast(e instanceof Error ? e.message : '数量変更に失敗しました', 'error');
      }
    });
  };

  const handleQtyDirectInput = (item: PosOrderItem, nextValue: number) => {
    const next = Math.max(1, Math.floor(nextValue) || 1);
    if (next === item.quantity) return;
    handleQty(item.id, next - item.quantity);
  };

  const handleCancel = async (reason: string) => {
    if (!cancelTarget) return;
    try {
      await cancelItemAction(order.id, cancelTarget.id, reason);
    } catch (e) {
      toast(e instanceof Error ? e.message : '取消に失敗しました', 'error');
    }
  };

  // 品目のない注文の取消。成功したら注文一覧（会計待ち）へ戻る
  const handleCancelEmptyOrder = async (reason: string) => {
    if (!cancelEmptyOrderAction) return;
    try {
      await cancelEmptyOrderAction(order.id, reason);
      toast(`注文 #${order.orderNo} を取消しました`, 'success');
      router.push('/app/pos');
    } catch (e) {
      toast(e instanceof Error ? e.message : '注文の取消に失敗しました', 'error');
    }
  };

  // 伝票追加: 同じテーブルに空の伝票をもう1枚作り、そのままその伝票へ切り替えて注文を取れるようにする
  const handleAddSlip = () => {
    if (!addSlipToTableAction) return;
    startTransition(async () => {
      try {
        const { newOrderId, orderNo } = await addSlipToTableAction(order.id);
        toast(`伝票 #${orderNo} を追加しました`, 'success');
        router.push(`/app/pos?order=${newOrderId}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : '伝票の追加に失敗しました', 'error');
      }
    });
  };

  // 注文伝票（会計前の確認用）をレシートプリンターへ。会計も売上も動かさない
  const handleOrderSlipPrint = () => {
    startTransition(async () => {
      try {
        const res = await enqueueOrderSlipPrint(order.id);
        toast(res.ok ? 'お会計伝票を印刷します' : (res.error ?? 'お会計伝票の印刷に失敗しました'), res.ok ? 'success' : 'error');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'お会計伝票の印刷に失敗しました', 'error');
      }
    });
  };

  const attemptOpenDrawer = async (methods: string[]) => {
    if (!shouldOpenDrawer(methods, drawerConfig)) return;
    try {
      // CloudPRNT対応プリンタがあれば実機のドロアをキックする。
      const res = await enqueueDrawerKick(storeId);
      if (res.ok) {
        toast('ドロアを開きます', 'success');
        return;
      }
      // 未設定・非対応時は従来どおりシミュレーション表示にフォールバック。
      const result = await createMockDrawerProvider('opened').open();
      toast(DRAWER_STATUS_LABELS[result.status], result.status === 'opened' ? 'success' : 'error');
    } catch {
      // ドロア開放はベストエフォート（失敗しても会計自体は完了済み）
    }
  };

  const handleCheckout = async (payments: CheckoutPayment[]) => {
    const result = await checkoutAction(order.id, payments);
    if (result.alreadyPaid) {
      // エラーではなく案内: 二重会計はDB層で拒否済みのため、レシートへ誘導する
      toast('この注文は既に会計済みです。レシートをご確認ください', 'success');
      router.push(`/app/pos/receipt/${order.id}`);
      return;
    }
    const earned = result.pointsEarned ?? 0;
    const base = result.warning ?? '会計が完了しました';
    toast(earned > 0 ? `${base}（+${earned}ポイント付与）` : base, result.warning ? 'error' : 'success');
    void attemptOpenDrawer(payments.map((p) => p.method));
    router.push(`/app/pos/receipt/${order.id}`);
  };

  const handleTerminalPaymentFinalized = () => {
    toast('決済が完了しました', 'success');
    void attemptOpenDrawer(['credit']);
    router.push(`/app/pos/receipt/${order.id}`);
  };

  const checkoutOrder: CheckoutOrder = {
    id: order.id,
    subtotal: order.subtotal,
    taxTotal: order.taxTotal,
    serviceCharge: order.serviceCharge,
    discountTotal: order.discountTotal,
    couponCode: order.couponCode,
    total: order.total,
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col lg:flex-row">
      {/* 左: 検索・カテゴリ + 商品グリッド */}
      <div className="flex min-w-0 flex-1 flex-col border-b border-gray-200 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
          <Link href="/app/floor" className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-primary">
            <ArrowLeft className="h-4 w-4" />
            フロアへ戻る
          </Link>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="navy">{tableName ?? ORDER_TYPE_LABELS[order.orderType] ?? order.orderType}</Badge>
            {setGuestCountAction ? (
              <button
                type="button"
                onClick={() => setGuestCountOpen(true)}
                aria-label="人数を変更する"
                className="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-200"
              >
                <Users className="h-3.5 w-3.5" />
                {order.guestCount}名
              </button>
            ) : (
              <span className="text-gray-500">{order.guestCount}名</span>
            )}
            <ClerkSelector orderId={order.id} clerks={clerks} currentClerkId={currentClerkId} />
            {/* 担当者が未登録の店舗では従来どおりログインユーザー名を表示する */}
            {clerks.length === 0 && staffName && <span className="text-gray-500">担当: {staffName}</span>}
            <button
              type="button"
              onClick={() => setCustomerOpen(true)}
              className={cn(
                'flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                linkedCustomer ? 'bg-primary-soft text-primary-deep' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              )}
            >
              <User className="h-3.5 w-3.5" />
              {linkedCustomer ? linkedCustomer.name : '顧客未設定'}
            </button>
          </div>
        </div>

        <div className="border-b border-gray-200 bg-white px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="商品名・カナ・英語で検索（F2）"
              className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-2 focus:outline-primary/30"
            />
          </div>
        </div>

        {!searchQuery.trim() && (
          <div className="flex gap-2 overflow-x-auto border-b border-gray-200 bg-white px-3 py-2">
            <button
              type="button"
              onClick={() => setActiveCategory(FAVORITES_TAB)}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                activeCategory === FAVORITES_TAB ? 'bg-warning text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              <Star className="h-3.5 w-3.5" />
              おすすめ
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory(BESTSELLERS_TAB)}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                activeCategory === BESTSELLERS_TAB ? 'bg-danger text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              <Flame className="h-3.5 w-3.5" />
              売れ筋
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCategory(c.id)}
                className={cn(
                  'shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                  activeCategory === c.id ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
                style={activeCategory === c.id ? { backgroundColor: c.color ?? '#7B3FF2' } : undefined}
              >
                <span className="block leading-tight">{c.name}</span>
                {(() => {
                  const en = englishName(c.name, null, c.name_en);
                  return en ? (
                    <span
                      className={cn(
                        'block text-[11px] font-medium leading-tight',
                        activeCategory === c.id ? 'text-white/80' : 'text-gray-500'
                      )}
                    >
                      {en}
                    </span>
                  ) : null;
                })()}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3">
          {visibleItems.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">
              {searchQuery.trim() ? '該当する商品が見つかりません' : 'このカテゴリに商品がありません'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {visibleItems.map((m) => {
                const price = isTakeoutLike ? (m.takeout_price ?? m.price) : m.price;
                const category = categories.find((c) => c.id === m.category_id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={m.is_sold_out || pending}
                    onClick={() => handleAdd(m.id)}
                    className={cn(
                      'flex min-h-[96px] flex-col items-start justify-between rounded-xl border p-3 text-left shadow-sm transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60',
                      m.is_sold_out ? 'border-gray-200 bg-gray-100' : 'border-gray-200 bg-white'
                    )}
                    style={!m.is_sold_out && category?.color ? { borderLeft: `6px solid ${category.color}` } : undefined}
                  >
                    <span className="w-full">
                      <span className="flex items-center gap-1 text-sm font-bold leading-tight text-navy">
                        {m.is_recommended && <Star className="h-3.5 w-3.5 shrink-0 fill-warning text-warning" />}
                        {m.name}
                      </span>
                      {/* 日本語を読まないスタッフ向けの英語。英語名が無ければカナからローマ字 */}
                      {englishByItemId.get(m.id) && (
                        <span className="mt-0.5 block text-xs leading-tight text-gray-500">
                          {englishByItemId.get(m.id)}
                        </span>
                      )}
                    </span>
                    {m.is_sold_out ? (
                      <Badge tone="gray">売切</Badge>
                    ) : (
                      <span className="text-base font-bold tabular-nums text-primary-deep">{yen(price)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 右: 伝票（会計ボタン・合計は常時表示。スクロールは品目リストのみ） */}
      <div className="flex w-full flex-col bg-white lg:w-[380px] lg:shrink-0">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-bold text-navy">伝票 #{order.orderNo}</h2>
        </div>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">商品をタップして追加してください</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {items.map((it) => (
                <li key={it.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-tight text-navy">{it.name}</p>
                      {it.menu_item_id && englishByItemId.get(it.menu_item_id) && (
                        <p className="text-xs leading-tight text-gray-500">
                          {englishByItemId.get(it.menu_item_id)}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label="取消"
                      onClick={() => setCancelTarget(it)}
                      className="rounded p-1 text-gray-400 hover:bg-danger-soft hover:text-danger"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-xs text-gray-500 tabular-nums">{yen(it.unit_price)}</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => handleQty(it.id, -1)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-600 disabled:opacity-50"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        key={it.quantity}
                        type="number"
                        min={1}
                        disabled={pending}
                        defaultValue={it.quantity}
                        onBlur={(e) => handleQtyDirectInput(it, Number(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                        aria-label={`${it.name}の数量`}
                        className="w-12 rounded-lg border border-gray-300 py-1 text-center text-sm font-semibold tabular-nums focus:border-primary focus:outline-2 focus:outline-primary/30"
                      />
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => handleQty(it.id, 1)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-600 disabled:opacity-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-16 text-right text-sm font-bold tabular-nums text-navy">
                        {yen(it.line_total)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-1.5 border-t border-gray-200 px-4 py-3 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>小計</span>
            <span className="tabular-nums">{yen(order.subtotal)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>消費税</span>
            <span className="tabular-nums">{yen(order.taxTotal)}</span>
          </div>
          {order.serviceCharge > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>サービス料</span>
              <span className="tabular-nums">{yen(order.serviceCharge)}</span>
            </div>
          )}
          {order.discountTotal > 0 && (
            <div className="flex justify-between text-warning">
              <span>値引き{order.couponCode ? `（${order.couponCode}）` : ''}</span>
              <span className="tabular-nums">-{yen(order.discountTotal)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-gray-100 pt-1.5 text-base font-bold text-navy">
            <span>合計</span>
            <span className="tabular-nums">{yen(order.total)}</span>
          </div>
        </div>

        <div className="space-y-2 border-t border-gray-200 p-3">
          {canCheckout && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={items.length === 0}
                onClick={() => setSplitOpen(true)}
              >
                <Split className="h-4 w-4" />
                伝票分割
              </Button>
              {/* 別会計用に空の伝票をもう1枚作る（分割と違い、既存の品目は動かさない） */}
              {addSlipToTableAction && (
                <Button variant="secondary" size="sm" disabled={pending} onClick={handleAddSlip}>
                  <FilePlus className="h-4 w-4" />
                  伝票追加
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setMergeOpen(true)}>
                <Combine className="h-4 w-4" />
                伝票統合
              </Button>
              {order.tableId && (
                <Button variant="secondary" size="sm" onClick={() => setTableMoveOpen(true)}>
                  <ArrowRightLeft className="h-4 w-4" />
                  テーブル移動
                </Button>
              )}
            </div>
          )}
          {/* 会計前に「いま何をいくつ・合計いくら」をお客様へ紙で出す。会計・売上には影響しない */}
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            disabled={items.length === 0 || pending}
            onClick={handleOrderSlipPrint}
          >
            <Printer className="h-4 w-4" />
            お会計伝票を印刷
          </Button>
          <Button
            size="pos"
            className="w-full"
            disabled={items.length === 0 || pending}
            onClick={() => setCheckoutOpen(true)}
          >
            会計へ（{yen(order.total)}）
          </Button>
          {canCheckout && cancelEmptyOrderAction && items.length === 0 && (
            <Button
              variant="secondary"
              size="sm"
              className="w-full text-danger"
              disabled={pending}
              onClick={() => setCancelOrderOpen(true)}
            >
              <XCircle className="h-4 w-4" />
              この注文を取消（品目なし）
            </Button>
          )}
          <p className="text-center text-[11px] text-gray-400">
            {POS_SHORTCUTS.map((s) => `${s.label}:${s.description}`).join('　')}
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title="品目を取消しますか"
        message={cancelTarget ? `「${cancelTarget.name}」を取消します。取消理由を記録してください。` : ''}
        confirmLabel="取消する"
        requireReason
        onConfirm={handleCancel}
      />

      <ConfirmDialog
        open={cancelOrderOpen}
        onClose={() => setCancelOrderOpen(false)}
        title="この注文を取消しますか"
        message={`注文 #${order.orderNo}（品目なし・¥0）を取消し、会計待ちから外します。${order.tableId ? 'テーブルは空席に戻ります。' : ''}取消理由を記録してください。`}
        confirmLabel="注文を取消する"
        requireReason
        onConfirm={handleCancelEmptyOrder}
      />

      {setGuestCountAction && guestCountOpen && (
        <GuestCountDialog
          open
          onClose={() => setGuestCountOpen(false)}
          orderId={order.id}
          currentGuestCount={order.guestCount}
          setGuestCountAction={setGuestCountAction}
        />
      )}

      <CheckoutDialog
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        order={checkoutOrder}
        canDiscount={canDiscount}
        discountReason={order.discountReason}
        setDiscountAction={setDiscountAction}
        applyCouponAction={applyCouponAction}
        clearCouponAction={clearCouponAction}
        onCheckout={handleCheckout}
        terminalReaders={terminalReaders}
        paymentAvailability={paymentAvailability}
        pointsAvailability={pointsAvailability}
        startTerminalPaymentAction={startTerminalPaymentAction}
        checkTerminalPaymentAction={checkTerminalPaymentAction}
        cancelTerminalPaymentAction={cancelTerminalPaymentAction}
        onTerminalPaymentFinalized={handleTerminalPaymentFinalized}
      />

      {optionTarget && (() => {
        const target = menuItems.find((m) => m.id === optionTarget);
        const groups = optionGroupsByItem[optionTarget] ?? [];
        if (!target) return null;
        return (
          <OptionDialog
            itemName={target.name}
            itemNameEn={englishByItemId.get(target.id)}
            basePrice={target.price}
            groups={groups}
            onCancel={() => setOptionTarget(null)}
            onConfirm={(ids) => {
              setOptionTarget(null);
              addWithOptions(target.id, ids);
            }}
          />
        );
      })()}

      <CustomerLinkDialog
        open={customerOpen}
        onClose={() => setCustomerOpen(false)}
        orderId={order.id}
        currentCustomer={linkedCustomer ? { id: linkedCustomer.id, name: linkedCustomer.name } : null}
        searchCustomerAction={searchCustomerAction}
        setOrderCustomerAction={setOrderCustomerAction}
        onLinked={(result) => {
          if (!result.id || !result.customerName) {
            setLinkedCustomer(null);
          } else {
            setLinkedCustomer({ id: result.id, name: result.customerName, phone: null, pointBalance: result.pointBalance ?? 0 });
          }
        }}
      />

      {canCheckout && (
        <>
          <SplitDialog
            open={splitOpen}
            onClose={() => setSplitOpen(false)}
            orderId={order.id}
            items={items}
            splitOrderAction={splitOrderAction}
          />
          <MergeDialog
            open={mergeOpen}
            onClose={() => setMergeOpen(false)}
            orderId={order.id}
            candidates={otherOpenOrders}
            mergeOrdersAction={mergeOrdersAction}
          />
          {order.tableId && (
            <TableMoveDialog
              open={tableMoveOpen}
              onClose={() => setTableMoveOpen(false)}
              orderId={order.id}
              currentTableName={tableName}
              availableTables={availableTables}
              moveTableAction={moveTableAction}
            />
          )}
        </>
      )}
    </div>
  );
}
