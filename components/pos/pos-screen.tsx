'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Minus, Plus, X, ArrowLeft, Split, Combine, ArrowRightLeft, Search, Star, User, XCircle,
  FilePlus, Printer, Users, ChefHat, Settings, Clock,
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
import { SeatTimeDialog } from './seat-time-dialog';
import { seatBadgeLabel, type SeatCourseOption, type SeatTimeState } from '@/lib/seat-time';
import type { SeatTimeInput } from '@/app/app/pos/actions';
import { CustomerLinkDialog } from './customer-link-dialog';
import type {
  CheckoutPayment, CheckoutOutcome, SplitMove, ApplyCouponResult,
  PosCustomerSearchResult, SetOrderCustomerResult, SendOrderResult,
} from '@/app/app/pos/actions';
import type { TerminalPaymentState } from '@/app/app/pos/payment-actions';

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: '店内 / Dine-in',
  takeout: 'テイクアウト / Takeout',
  delivery: 'デリバリー / Delivery',
  course: 'コース / Course',
  pre_order: '事前注文 / Pre-order',
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
  /** 厨房へ送った時刻。null = 未送信（「厨房へオーダー」を押すまで厨房に届かない） */
  kitchen_sent_at?: string | null;
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
  registerOpen = true,
  terminalReaders,
  paymentAvailability,
  otherOpenOrders,
  availableTables,
  addItemAction,
  updateQtyAction,
  cancelItemAction,
  setDiscountAction,
  checkoutAction,
  sendOrderAction,
  splitOrderAction,
  mergeOrdersAction,
  moveTableAction,
  cancelEmptyOrderAction,
  setGuestCountAction,
  seatTime,
  seatCourses = [],
  setSeatTimeAction,
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
  /** レジが開局しているか。未開局だと会計は受け付けない（先にレジクローズ画面で開局する） */
  registerOpen?: boolean;
  terminalReaders: PosTerminalReader[];
  paymentAvailability: PosPaymentAvailability;
  otherOpenOrders: MergeCandidate[];
  availableTables: AvailableTable[];
  /** 戻り値（追加した明細のID）はレジでは使わない（ハンディが厨房送信に使う） */
  addItemAction: (orderId: string, menuItemId: string, optionItemIds?: string[]) => Promise<unknown>;
  updateQtyAction: (orderId: string, orderItemId: string, delta: number) => Promise<void>;
  cancelItemAction: (orderId: string, orderItemId: string, reason: string) => Promise<void>;
  setDiscountAction: (orderId: string, discountTotal: number, reason: string) => Promise<void>;
  checkoutAction: (orderId: string, payments: CheckoutPayment[]) => Promise<CheckoutOutcome>;
  /** 未送信の品目をまとめて厨房へ送る */
  sendOrderAction?: (orderId: string) => Promise<SendOrderResult>;
  splitOrderAction: (orderId: string, moves: SplitMove[]) => Promise<{ newOrderId: string }>;
  mergeOrdersAction: (targetOrderId: string, sourceOrderId: string) => Promise<void>;
  moveTableAction: (orderId: string, newTableId: string) => Promise<{ tableName: string }>;
  /** 品目のない注文（会計前・¥0）を取消する。省略時はボタンを表示しない */
  cancelEmptyOrderAction?: (orderId: string, reason: string) => Promise<void>;
  /** 注文後の人数変更。省略時は人数バッジを押しても何も起きない */
  setGuestCountAction?: (orderId: string, guestCount: number) => Promise<void>;
  /** 席の時間・コース（卓の伝票だけ）。省略時はバッジを出さない */
  seatTime?: SeatTimeState;
  seatCourses?: SeatCourseOption[];
  setSeatTimeAction?: (orderId: string, input: SeatTimeInput) => Promise<void>;
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
  const [seatTimeOpen, setSeatTimeOpen] = useState(false);
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

  // 未送信（厨房にまだ伝えていない）品目。タップした瞬間ではなく、このボタンで初めて厨房伝票・KDS に出る
  const unsentItems = items.filter((it) => it.kitchen_sent_at === null);
  const handleSendOrder = () => {
    if (!sendOrderAction || unsentItems.length === 0) return;
    startTransition(async () => {
      try {
        const res = await sendOrderAction(order.id);
        toast(res.sent > 0 ? `厨房へ ${res.sent} 品を送信しました / Sent to kitchen` : '送信する品目がありません', res.sent > 0 ? 'success' : 'error');
      } catch (e) {
        toast(e instanceof Error ? e.message : '厨房への送信に失敗しました', 'error');
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
    if (result.registerClosed) {
      // 会計は確定していない。ダイアログ側の catch でトーストに出す
      throw new Error(
        'レジが未開局のため会計できません。「レジクローズ」画面で釣銭準備金を数えてレジを開局してから、もう一度会計してください / Register is not opened. Open the register (count the opening cash) first.'
      );
    }
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
    unsentCount: unsentItems.length,
  };

  /** カテゴリの並び（おすすめ・売れ筋 → 各カテゴリ）。中央の縦リストと、幅が狭いときの横並びで同じものを使う */
  const categoryTabs = [
    { id: FAVORITES_TAB, name: 'おすすめ', en: 'Picks', color: null as string | null },
    { id: BESTSELLERS_TAB, name: '売れ筋', en: 'Popular', color: null as string | null },
    ...categories.map((c) => ({ id: c.id, name: c.name, en: englishName(c.name, null, c.name_en), color: c.color })),
  ];

  const metaChip =
    'flex items-center gap-1 rounded-full bg-lilac px-3 py-1 text-xs font-semibold text-ink-2 transition-colors hover:bg-iris-soft';

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-3 lg:flex-row">
      {/* 左: 伝票（テーブル・人数・顧客と、追加した品目） */}
      <section className="flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-white lg:w-[380px]">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Link href="/app/floor" aria-label="フロアへ戻る" className="rounded-lg p-1.5 text-ink-3 hover:bg-lilac">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <span className="text-2xl font-extrabold leading-none text-royal">
            {tableName ?? ORDER_TYPE_LABELS[order.orderType] ?? order.orderType}
          </span>
          {setGuestCountAction ? (
            <button type="button" onClick={() => setGuestCountOpen(true)} aria-label="人数を変更する" className={metaChip}>
              <Users className="h-3.5 w-3.5" />
              {order.guestCount}名
            </button>
          ) : (
            <span className="text-sm text-ink-3">{order.guestCount}名</span>
          )}
          <span className="ml-auto text-xs text-ink-3">#{order.orderNo}</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2">
          <button
            type="button"
            onClick={() => setCustomerOpen(true)}
            className={cn(metaChip, linkedCustomer && 'bg-iris-soft text-royal')}
          >
            <User className="h-3.5 w-3.5" />
            {linkedCustomer ? linkedCustomer.name : '顧客 未設定'}
          </button>
          {seatTime && setSeatTimeAction && (
            <button type="button" onClick={() => setSeatTimeOpen(true)} aria-label="席の時間・コースを変更する" className={cn(metaChip, 'max-w-[15rem]')}>
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{seatBadgeLabel(seatTime, seatCourses)}</span>
            </button>
          )}
          <ClerkSelector orderId={order.id} clerks={clerks} currentClerkId={currentClerkId} />
          {clerks.length === 0 && staffName && <span className="text-xs text-ink-3">担当 {staffName}</span>}
          <Link href={`/app/pos/settings?order=${order.id}`} aria-label="レジの設定" className={cn(metaChip, 'ml-auto')}>
            <Settings className="h-3.5 w-3.5" aria-hidden />
            設定
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <p className="p-6 text-center text-sm text-ink-3">商品をタップして追加してください / Tap an item to add</p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-2.5 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold leading-tight text-navy">
                      {it.name}
                      {it.kitchen_sent_at === null && (
                        <span className="ml-1.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-bold text-amber-800">
                          未送信
                        </span>
                      )}
                    </p>
                    <p className="text-xs leading-tight text-ink-3 tabular-nums">
                      {yen(it.unit_price)}
                      {it.menu_item_id && englishByItemId.get(it.menu_item_id) ? ` ・ ${englishByItemId.get(it.menu_item_id)}` : ''}
                    </p>
                  </div>
                  {/* 数量は指で押せる大きさに（レジは iPad で使う） */}
                  <div className="flex shrink-0 items-center overflow-hidden rounded-xl border border-line">
                    <button
                      type="button"
                      aria-label={`${it.name}を1つ減らす`}
                      disabled={pending}
                      onClick={() => handleQty(it.id, -1)}
                      className="flex h-11 w-11 items-center justify-center bg-lilac-soft text-royal disabled:opacity-50"
                    >
                      <Minus className="h-4 w-4" />
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
                      className="h-11 w-11 border-0 text-center text-base font-bold tabular-nums text-navy focus:outline-none"
                    />
                    <button
                      type="button"
                      aria-label={`${it.name}を1つ増やす`}
                      disabled={pending}
                      onClick={() => handleQty(it.id, 1)}
                      className="flex h-11 w-11 items-center justify-center bg-lilac-soft text-royal disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <span className="w-[72px] shrink-0 text-right text-[15px] font-bold tabular-nums text-navy">
                    {yen(it.line_total)}
                  </span>
                  <button
                    type="button"
                    aria-label="取消"
                    onClick={() => setCancelTarget(it)}
                    className="shrink-0 rounded-lg p-1.5 text-ink-3 hover:bg-danger-soft hover:text-danger"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-line px-4 py-3">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-ink-2">
              <span>小計</span>
              <span className="tabular-nums">{yen(order.subtotal)}</span>
            </div>
            <div className="flex justify-between text-ink-2">
              <span>消費税</span>
              <span className="tabular-nums">{yen(order.taxTotal)}</span>
            </div>
            {order.serviceCharge > 0 && (
              <div className="flex justify-between text-ink-2">
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
          </div>
          <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
            <span className="text-[15px] font-bold text-ink-2">合計（税込）</span>
            <span className="text-3xl font-extrabold tabular-nums text-royal">{yen(order.total)}</span>
          </div>
          {canCheckout && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button type="button" disabled={items.length === 0} onClick={() => setSplitOpen(true)} className={cn(metaChip, 'disabled:opacity-40')}>
                <Split className="h-3.5 w-3.5" />
                伝票分割
              </button>
              {addSlipToTableAction && (
                <button type="button" disabled={pending} onClick={handleAddSlip} className={cn(metaChip, 'disabled:opacity-40')}>
                  <FilePlus className="h-3.5 w-3.5" />
                  伝票追加
                </button>
              )}
              <button type="button" onClick={() => setMergeOpen(true)} className={metaChip}>
                <Combine className="h-3.5 w-3.5" />
                伝票統合
              </button>
              {order.tableId && (
                <button type="button" onClick={() => setTableMoveOpen(true)} className={metaChip}>
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  テーブル移動
                </button>
              )}
              <button
                type="button"
                disabled={items.length === 0 || pending}
                onClick={handleOrderSlipPrint}
                className={cn(metaChip, 'disabled:opacity-40')}
              >
                <Printer className="h-3.5 w-3.5" />
                お会計伝票
              </button>
              {cancelEmptyOrderAction && items.length === 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setCancelOrderOpen(true)}
                  className={cn(metaChip, 'text-danger disabled:opacity-40')}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  この注文を取消
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 中: カテゴリ（縦一列。iPad で指で選びやすいように） */}
      {!searchQuery.trim() && (
        <nav className="hidden w-[168px] shrink-0 overflow-y-auto rounded-2xl border border-line bg-white lg:block">
          {categoryTabs.map((c) => {
            const on = activeCategory === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCategory(c.id)}
                className={cn(
                  'w-full border-b border-line px-3.5 py-3.5 text-left text-[15px] font-bold leading-tight transition-colors last:border-b-0',
                  on ? 'text-white' : 'text-ink-2 hover:bg-lilac-soft'
                )}
                style={on ? { backgroundColor: c.color ?? '#7B3FE4' } : undefined}
              >
                <span className="block">{c.name}</span>
                {c.en && <span className={cn('block text-[11px] font-medium', on ? 'text-white/80' : 'text-ink-3')}>{c.en}</span>}
              </button>
            );
          })}
        </nav>
      )}

      {/* 右: 検索・商品グリッドと、下の「厨房へオーダー」「会計へ」 */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="商品名・カナ・英語で検索 / Search"
              className="h-11 w-full rounded-xl border border-line bg-white pl-9 pr-3 text-[15px] text-navy placeholder:text-ink-3 focus:border-iris focus:outline-2 focus:outline-iris/30"
            />
          </div>
        </div>

        {/* 幅が狭いとき（スマホ・縦置き）はカテゴリを横並びで出す */}
        {!searchQuery.trim() && (
          <div className="flex gap-2 overflow-x-auto border-b border-line px-3 py-2 lg:hidden">
            {categoryTabs.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCategory(c.id)}
                className={cn(
                  'shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                  activeCategory === c.id ? 'text-white' : 'bg-lilac text-ink-2'
                )}
                style={activeCategory === c.id ? { backgroundColor: c.color ?? '#7B3FE4' } : undefined}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {visibleItems.length === 0 ? (
            <p className="p-6 text-center text-sm text-ink-3">
              {searchQuery.trim() ? '該当する商品が見つかりません / No items found' : 'このカテゴリに商品がありません / No items in this category'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
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
                      'flex min-h-[92px] flex-col items-center justify-center gap-1.5 rounded-xl border px-2.5 py-3 text-center transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60',
                      m.is_sold_out ? 'border-line bg-lilac' : 'border-line bg-white hover:bg-lilac-soft'
                    )}
                    style={!m.is_sold_out && category?.color ? { borderTop: `4px solid ${category.color}` } : undefined}
                  >
                    <span className="flex items-center gap-1 text-[15px] font-bold leading-tight text-navy">
                      {m.is_recommended && <Star className="h-3.5 w-3.5 shrink-0 fill-warning text-warning" />}
                      {m.name}
                    </span>
                    {englishByItemId.get(m.id) && (
                      <span className="text-[11px] leading-tight text-ink-3">{englishByItemId.get(m.id)}</span>
                    )}
                    {m.is_sold_out ? (
                      <Badge tone="gray">売切 / Sold out</Badge>
                    ) : (
                      <span className="text-[17px] font-extrabold tabular-nums text-royal">{yen(price)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {canCheckout && !registerOpen && (
          <Link
            href="/app/cash/close"
            className="mx-3 mb-2 block rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger"
          >
            <b>レジが未開局です。</b>
            会計の前に「レジクローズ」画面で釣銭準備金を数えてレジを開局してください（タップで移動）
          </Link>
        )}

        <div className="grid grid-cols-2 gap-3 border-t border-line p-3 pb-[calc(0.75rem+3.5rem+env(safe-area-inset-bottom))] lg:pb-3">
          {sendOrderAction ? (
            <Button
              size="pos"
              variant={unsentItems.length > 0 ? 'navy' : 'secondary'}
              className="h-[60px] w-full text-[17px]"
              disabled={unsentItems.length === 0 || pending}
              onClick={handleSendOrder}
            >
              <ChefHat className="h-5 w-5" />
              {unsentItems.length > 0 ? `注文確定（${unsentItems.length}品）` : '注文確定（未送信なし）'}
            </Button>
          ) : (
            <span />
          )}
          <Button
            size="pos"
            className="h-[60px] w-full text-[18px]"
            disabled={items.length === 0 || pending}
            onClick={() => setCheckoutOpen(true)}
          >
            会計へ（{yen(order.total)}）
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title="品目を取消しますか / Cancel this item?"
        message={cancelTarget ? `「${cancelTarget.name}」を取消します。取消理由を記録してください。` : ''}
        confirmLabel="取消する / Cancel item"
        requireReason
        onConfirm={handleCancel}
      />

      <ConfirmDialog
        open={cancelOrderOpen}
        onClose={() => setCancelOrderOpen(false)}
        title="この注文を取消しますか / Cancel this order?"
        message={`注文 #${order.orderNo}（品目なし・¥0）を取消し、会計待ちから外します。${order.tableId ? 'テーブルは空席に戻ります。' : ''}取消理由を記録してください。`}
        confirmLabel="注文を取消する / Cancel order"
        requireReason
        onConfirm={handleCancelEmptyOrder}
      />

      {seatTime && setSeatTimeAction && seatTimeOpen && (
        <SeatTimeDialog
          onClose={() => setSeatTimeOpen(false)}
          orderId={order.id}
          current={seatTime}
          courses={seatCourses}
          setSeatTimeAction={setSeatTimeAction}
        />
      )}

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
