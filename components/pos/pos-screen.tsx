'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Minus, Plus, X, ArrowLeft, Search, Star, User,
  Users, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { englishName } from '@/lib/romaji';
import { groupMenuPages, menuPageLabel, type MenuBookSettings } from '@/lib/menu-book';
import type { DiscountPreset, PointBrand } from '@/lib/checkout-presets';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useStoreRealtimeRefresh } from '@/components/realtime/use-store-refresh';
import { createMockDrawerProvider } from '@/lib/printing/providers';
import { enqueueDrawerKick } from '@/app/app/pos/print-actions';
import { ClerkSelector, type ClerkOption } from './clerk-selector';
import { useClerkGate } from './clerk-gate';
import { OptionDialog, type PosOptionGroup } from './option-dialog';
import { SlideToConfirm } from '@/components/ui/slide-to-confirm';
import { shouldOpenDrawer, type DrawerResultStatus } from '@/lib/printing/types';
import {
  CheckoutDialog,
  type CheckoutOrder,
  type PosPaymentAvailability,
  type PosTerminalReader,
  type PointsAvailability,
} from './checkout-dialog';
import { TableMoveDialog, type AvailableTable } from './table-move-dialog';
import { GuestCountDialog } from './guest-count-dialog';
import { SeatTimeDialog } from './seat-time-dialog';
import { seatBadgeLabel, type SeatCourseOption, type SeatTimeState } from '@/lib/seat-time';
import type { SeatTimeInput } from '@/app/app/pos/actions';
import { CustomerLinkDialog } from './customer-link-dialog';
import type {
  CheckoutPayment, CheckoutOutcome, ApplyCouponResult,
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

/** 「テイクアウト」のメニュー（カテゴリ名で判断する。無い店はこれまでどおり） */
const TAKEOUT_CATEGORY = /テイクアウト|持ち帰り|お持ち帰り|take\s*out|takeaway/i;

/** まだ注文していない品（カート）の1行。Order を押すまで伝票には入らない */
interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  nameEn: string | null;
  unitPrice: number;
  quantity: number;
  optionItemIds: string[];
  optionLabel: string | null;
}

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
  /** 厨房のステーション。ページ（上のタブ）の自動振り分けに使う */
  station: string | null;
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
  menuPages,
  discountPresets = [],
  pointBrands = [],
  methodBrands = {},
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
  availableTables,
  addItemAction,
  updateQtyAction,
  cancelItemAction,
  setDiscountAction,
  checkoutAction,
  sendOrderAction,
  openCheckout = false,
  openTableMove = false,
  moveTableAction,
  cancelEmptyOrderAction,
  splitOrderAction,
  setGuestCountAction,
  seatTime,
  seatCourses = [],
  setSeatTimeAction,
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
  /** メニューブックの「ページ」設定。上のタブ（ランチ・ドリンク・フード…）に使う */
  menuPages?: Pick<MenuBookSettings, 'pages' | 'categoryPage'>;
  /** 会計の値引きの選択肢（設定 > 決済・端末） */
  discountPresets?: DiscountPreset[];
  /** 会計のポイントの選択肢（ホットペッパー・ぐるなび・食べログなど） */
  pointBrands?: PointBrand[];
  /** 会計の支払方法ごとの内訳（クレジット→VISA…、QR→PayPay…） */
  methodBrands?: Record<string, PointBrand[]>;
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
  availableTables: AvailableTable[];
  /** 戻り値（追加した明細のID）はレジでは使わない（ハンディが厨房送信に使う） */
  addItemAction: (
    orderId: string,
    menuItemId: string,
    optionItemIds?: string[],
    quantity?: number
  ) => Promise<unknown>;
  updateQtyAction: (orderId: string, orderItemId: string, delta: number) => Promise<void>;
  cancelItemAction: (
    orderId: string,
    orderItemId: string,
    reason: string,
    approvedByClerkId?: string | null
  ) => Promise<void>;
  setDiscountAction: (orderId: string, discountTotal: number, reason: string) => Promise<void>;
  checkoutAction: (orderId: string, payments: CheckoutPayment[]) => Promise<CheckoutOutcome>;
  /** 未送信の品目をまとめて厨房へ送る */
  sendOrderAction?: (orderId: string) => Promise<SendOrderResult>;
  /** テーブル一覧のポップアップから「会計」「テーブル移動」を選んで来たときに、その画面を開く */
  openCheckout?: boolean;
  openTableMove?: boolean;
  moveTableAction: (orderId: string, newTableId: string) => Promise<{ tableName: string }>;
  /** 品目のない注文（会計前・¥0）を取消する。省略時はボタンを表示しない */
  cancelEmptyOrderAction?: (orderId: string, reason: string, approvedByClerkId?: string | null) => Promise<void>;
  /** 別々会計：選んだ品目を別の伝票に移す（移した伝票をそのまま会計する） */
  splitOrderAction?: (
    orderId: string,
    moves: { orderItemId: string; quantity: number }[]
  ) => Promise<{ newOrderId: string }>;
  /** 注文後の人数変更。省略時は人数バッジを押しても何も起きない */
  setGuestCountAction?: (orderId: string, guestCount: number) => Promise<void>;
  /** 席の時間・コース（卓の伝票だけ）。省略時はバッジを出さない */
  seatTime?: SeatTimeState;
  seatCourses?: SeatCourseOption[];
  setSeatTimeAction?: (orderId: string, input: SeatTimeInput) => Promise<void>;
  /** 同じテーブルに空の伝票をもう1枚作る（別会計用）。省略時はボタンを表示しない */
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
  const clerkGate = useClerkGate();
  const [pending, startTransition] = useTransition();
  /**
   * テイクアウトの伝票は「テイクアウト」のカテゴリがあればそこから開く（2026-09-24 店舗要望）。
   * 無ければ今までどおり最初のカテゴリ。ここは最初の1回だけで、あとは押したカテゴリに従う。
   */
  const [activeCategory, setActiveCategory] = useState<string>(() => {
    const takeoutSlip =
      order.orderType === 'takeout' || order.orderType === 'delivery' || order.orderType === 'pre_order';
    if (takeoutSlip) {
      const takeoutCategory = categories.find((c) => TAKEOUT_CATEGORY.test(c.name));
      if (takeoutCategory) return takeoutCategory.id;
    }
    return categories[0]?.id ?? '';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [cancelTarget, setCancelTarget] = useState<PosOrderItem | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(openCheckout);
  const [tableMoveOpen, setTableMoveOpen] = useState(openTableMove);
  const [cancelOrderOpen, setCancelOrderOpen] = useState(false);
  const [guestCountOpen, setGuestCountOpen] = useState(false);
  const [seatTimeOpen, setSeatTimeOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [optionTarget, setOptionTarget] = useState<string | null>(null);
  /**
   * まだ注文していない品（カート）。2026-09-25 店舗要望
   * 「商品をタップしただけでは注文にしない。右下の Order を押してはじめて注文にする」。
   * ハンディと同じ作りで、Order を押した時に伝票へ入り、厨房へ出て、テーブルにも金額が出る。
   */
  const [cart, setCart] = useState<CartLine[]>([]);
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

  /** タップした品はまずカートへ（同じ品・同じ選択肢はまとめて数量を足す） */
  const addWithOptions = (menuItemId: string, optionItemIds: string[]) => {
    const item = menuItems.find((m) => m.id === menuItemId);
    if (!item) return;
    const groups = optionGroupsByItem[menuItemId] ?? [];
    const chosen = groups
      .flatMap((g) => g.items)
      .filter((o) => optionItemIds.includes(o.id));
    const extra = chosen.reduce((n, o) => n + Number(o.price ?? 0), 0);
    const basePrice = isTakeoutLike ? (item.takeout_price ?? item.price) : item.price;
    const key = `${menuItemId}:${[...optionItemIds].sort().join(',')}`;
    setCart((cur) => {
      const found = cur.find((l) => l.key === key);
      if (found) {
        return cur.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...cur,
        {
          key,
          menuItemId,
          name: item.name,
          nameEn: englishByItemId.get(menuItemId) ?? null,
          unitPrice: Number(basePrice) + extra,
          quantity: 1,
          optionItemIds,
          optionLabel: chosen.length > 0 ? chosen.map((o) => o.name).join('・') : null,
        },
      ];
    });
  };

  const cartQty = (key: string, delta: number) =>
    setCart((cur) =>
      cur
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );

  const cartCount = cart.reduce((n, l) => n + l.quantity, 0);
  const cartTotal = cart.reduce((n, l) => n + l.unitPrice * l.quantity, 0);

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

  /**
   * 取消の前に店長以上の担当者に承認してもらう（レジのみ。2026-09-24 店舗要望）。
   * パソコン・ハンディ（clerkGate が無い）は今まで通りそのまま取消できる。
   */
  const askCancelApproval = async (): Promise<{ ok: boolean; approverId: string | null }> => {
    if (!clerkGate) return { ok: true, approverId: null };
    const answer = await clerkGate.askApprover();
    if (!answer.ok) {
      toast('取消には店長以上の承認が必要です / Manager approval required', 'error');
      return { ok: false, approverId: null };
    }
    return { ok: true, approverId: answer.approver?.id ?? null };
  };

  const handleCancel = async (reason: string) => {
    if (!cancelTarget) return;
    const approval = await askCancelApproval();
    if (!approval.ok) return;
    try {
      await cancelItemAction(order.id, cancelTarget.id, reason, approval.approverId);
    } catch (e) {
      toast(e instanceof Error ? e.message : '取消に失敗しました', 'error');
    }
  };

  // 品目のない注文の取消。成功したら注文一覧（会計待ち）へ戻る
  const handleCancelEmptyOrder = async (reason: string) => {
    if (!cancelEmptyOrderAction) return;
    const approval = await askCancelApproval();
    if (!approval.ok) return;
    try {
      await cancelEmptyOrderAction(order.id, reason, approval.approverId);
      toast(`注文 #${order.orderNo} を取消しました`, 'success');
      router.push('/app/pos');
    } catch (e) {
      toast(e instanceof Error ? e.message : '注文の取消に失敗しました', 'error');
    }
  };

  // 伝票追加: 同じテーブルに空の伝票をもう1枚作り、そのままその伝票へ切り替えて注文を取れるようにする
  // 注文伝票（会計前の確認用）をレシートプリンターへ。会計も売上も動かさない
  // 未送信（厨房にまだ伝えていない）品目。タップした瞬間ではなく、このボタンで初めて厨房伝票・KDS に出る
  const unsentItems = items.filter((it) => it.kitchen_sent_at === null);
  /**
   * Order（決定）。カートの品をまとめて伝票に入れ、そのまま厨房へ送る。
   * ここではじめて伝票・テーブルの金額・厨房伝票に出る（2026-09-25 店舗要望）。
   */
  const handleSendOrder = () => {
    if (cart.length === 0 && unsentItems.length === 0) return;
    startTransition(async () => {
      try {
        for (const line of cart) {
          await addItemAction(order.id, line.menuItemId, line.optionItemIds, line.quantity);
        }
        setCart([]);
        if (!sendOrderAction) {
          toast('伝票に入れました', 'success');
          return;
        }
        const res = await sendOrderAction(order.id);
        toast(
          res.sent > 0 ? `厨房へ ${res.sent} 品を送信しました / Sent to kitchen` : '伝票に入れました',
          'success'
        );
      } catch (e) {
        toast(e instanceof Error ? e.message : '注文に失敗しました', 'error');
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
    // 画面遷移はしない: 会計ダイアログが「会計完了（お預り・おつり）」を出し、
    // そこから レシート／テーブル一覧／連続会計 を選ぶ
  };

  const handleTerminalPaymentFinalized = () => {
    toast('決済が完了しました', 'success');
    void attemptOpenDrawer(['credit']);
    router.push(`/app/pos/receipt/${order.id}`);
  };

  const checkoutOrder: CheckoutOrder = {
    label: tableName ?? ORDER_TYPE_LABELS[order.orderType] ?? order.orderType,
    guestCount: order.guestCount,
    orderNo: order.orderNo,
    lines: items.map((i) => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      lineTotal: i.line_total,
    })),
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
  /**
   * 上のタブ（ページ）と、その中のカテゴリ。
   * ページはメニューブックの設定（ハンディ・お客様QRと同じ）をそのまま使う。
   * 先頭に「おすすめ・売れ筋」のページを置く。
   */
  const pages = useMemo(() => {
    const book = { pages: menuPages?.pages ?? [], categoryPage: menuPages?.categoryPage ?? {} };
    // 0円だけのカテゴリ＝食べ放題・飲み放題の中身。ページの自動振り分けに使う
    const zeroOnly = new Map<string, boolean>();
    for (const m of menuItems) {
      if (!m.category_id) continue;
      const zero = Number(m.price) === 0;
      zeroOnly.set(m.category_id, (zeroOnly.get(m.category_id) ?? true) && zero);
    }
    const forPages = categories.map((c) => ({ ...c, allZeroPrice: zeroOnly.get(c.id) ?? false }));
    const grouped = groupMenuPages(forPages, book).map((pg) => {
      const label = menuPageLabel(pg, (c) => c.name);
      const first = pg.categories[0];
      return {
        key: pg.key,
        label,
        en: pg.categories.length === 1 ? englishName(first.name, null, first.name_en) : englishName(label, null, null),
        categories: pg.categories.map((c) => ({
          id: c.id,
          name: c.name,
          en: englishName(c.name, null, c.name_en),
          color: c.color,
        })),
      };
    });
    return [
      {
        key: 'picks',
        label: 'おすすめ',
        en: 'Picks',
        categories: [
          { id: FAVORITES_TAB, name: 'おすすめ', en: 'Picks', color: null as string | null },
          { id: BESTSELLERS_TAB, name: '売れ筋', en: 'Popular', color: null as string | null },
        ],
      },
      ...grouped,
    ];
  }, [categories, menuItems, menuPages]);

  const activePage = pages.find((pg) => pg.categories.some((c) => c.id === activeCategory)) ?? pages[0];

  /** 左の列に出すのは「いま開いているページ」の中のカテゴリだけ（上のタブ＝ページ、左＝その中身） */
  const categoryTabs = activePage?.categories ?? [];

  /** 上のタブ（ページ）を押したら、そのページの最初のカテゴリを開く */
  const openPage = (key: string) => {
    const pg = pages.find((p) => p.key === key);
    if (pg?.categories[0]) setActiveCategory(pg.categories[0].id);
  };

  /** 担当者は必須（店舗に担当者が登録されている場合）。未選択なら注文確定・会計へ進めない */
  const clerkMissing = clerks.length > 0 && !currentClerkId;

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
          <ClerkSelector orderId={order.id} clerks={clerks} currentClerkId={currentClerkId} required />
          {clerks.length === 0 && staffName && <span className="text-xs text-ink-3">担当 {staffName}</span>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-ink-3">商品をタップして追加してください / Tap an item to add</p>
              {/* 品目のない伝票はここから取消せる（卓に開きっぱなしの伝票を閉じるため。2026-09-24 店舗要望）。
                  売上には入らない（会計ではなく「取消」で閉じる） */}
              {cancelEmptyOrderAction && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setCancelOrderOpen(true)}
                  className="mt-4 inline-flex h-10 items-center rounded-xl border border-danger/40 px-4 text-sm font-bold text-danger hover:bg-danger-soft disabled:opacity-50"
                >
                  この伝票を取消 / Cancel slip
                </button>
              )}
            </div>
          ) : null}

          {/* まだ注文していない品（カート）。Order を押すと伝票へ入る（2026-09-25 店舗要望） */}
          {cart.length > 0 && (
            <div className="border-b-2 border-dashed border-iris/40 bg-iris-soft/40">
              <p className="px-3 pt-2 text-[11px] font-bold text-royal">
                未確定 / Not ordered yet
                <span className="ml-1 font-normal text-ink-3">Order を押すと注文になります</span>
              </p>
              <ul>
                {cart.map((l) => (
                  <li key={l.key} className="flex items-center gap-2.5 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-bold leading-tight text-navy">
                        {l.nameEn ?? l.name}
                      </p>
                      <p className="truncate text-xs leading-tight text-ink-3 tabular-nums">
                        {yen(l.unitPrice)}
                        {l.nameEn ? ` ・ ${l.name}` : ''}
                        {l.optionLabel ? ` ・ ${l.optionLabel}` : ''}
                      </p>
                    </div>
                    <span className="w-[72px] shrink-0 text-right text-[15px] font-bold tabular-nums text-navy">
                      {yen(l.unitPrice * l.quantity)}
                    </span>
                    <div className="flex shrink-0 items-center overflow-hidden rounded-xl border border-line bg-white">
                      <button
                        type="button"
                        aria-label={`${l.name}を1つ減らす`}
                        onClick={() => cartQty(l.key, -1)}
                        className="flex h-11 w-11 items-center justify-center bg-lilac-soft text-royal"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="grid h-11 w-11 place-items-center text-base font-bold tabular-nums text-navy">
                        {l.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label={`${l.name}を1つ増やす`}
                        onClick={() => cartQty(l.key, 1)}
                        className="flex h-11 w-11 items-center justify-center bg-lilac-soft text-royal"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      aria-label="取消"
                      onClick={() => setCart((cur) => cur.filter((x) => x.key !== l.key))}
                      className="shrink-0 rounded-lg p-1.5 text-ink-3 hover:bg-danger-soft hover:text-danger"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {items.length > 0 && (
            <ul className="divide-y divide-line">
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-2.5 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    {/* レジの画面は英語を主にする（日本語を読まないスタッフが打つため。2026-09-24 店舗要望）。
                        日本語名は下に小さく残す。印刷する会計伝票は日本語のまま */}
                    <p className="truncate text-[15px] font-bold leading-tight text-navy">
                      {(it.menu_item_id && englishByItemId.get(it.menu_item_id)) || it.name}
                      {it.kitchen_sent_at === null && (
                        <span className="ml-1.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-bold text-amber-800">
                          未送信
                        </span>
                      )}
                    </p>
                    <p className="text-xs leading-tight text-ink-3 tabular-nums">
                      {yen(it.unit_price)}
                      {it.menu_item_id && englishByItemId.get(it.menu_item_id) ? ` ・ ${it.name}` : ''}
                    </p>
                  </div>
                  <span className="w-[72px] shrink-0 text-right text-[15px] font-bold tabular-nums text-navy">
                    {yen(it.line_total)}
                  </span>
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
                      // ブラウザの上下の矢印は出さない（数は −／＋ で変える。2026-09-24 要望）
                      className="h-11 w-11 border-0 text-center text-base font-bold tabular-nums text-navy focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
          {cart.length > 0 && (
            <div className="mt-1 flex justify-between text-sm font-bold text-royal">
              <span>未確定（Order前）</span>
              <span className="tabular-nums">+{yen(cartTotal)}</span>
            </div>
          )}
          <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
            <span className="text-[15px] font-bold text-ink-2">合計（税込）</span>
            <span className="text-3xl font-extrabold tabular-nums text-royal">{yen(order.total)}</span>
          </div>
        </div>
      </section>

      {/* 右側: 上が「ページ」のタブ（フード・ドリンク…）、下が「カテゴリの列 + 商品」 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {!searchQuery.trim() && pages.length > 1 && (
          <nav className="flex shrink-0 gap-1.5 overflow-x-auto rounded-2xl border border-line bg-white p-1.5">
            {pages.map((pg, i) => {
              const on = activePage?.key === pg.key;
              return (
                <button
                  key={pg.key}
                  type="button"
                  onClick={() => openPage(pg.key)}
                  className={cn(
                    'tap3d flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-left',
                    on ? 'bg-royal text-white' : 'bg-white text-ink-2 hover:bg-lilac-soft'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] font-extrabold tabular-nums',
                      on ? 'bg-white/20 text-white' : 'bg-lilac text-ink-3'
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="leading-tight">
                    <span className="block whitespace-nowrap text-[15px] font-bold">{pg.en ?? pg.label}</span>
                    {pg.en && (
                      <span className={cn('block whitespace-nowrap text-[10px] font-semibold', on ? 'text-white/75' : 'text-ink-3')}>
                        {pg.label}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </nav>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
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
                      'tap3d w-full border-b border-line px-3.5 py-3.5 text-left text-[15px] font-bold leading-tight last:border-b-0',
                      on ? 'text-white' : 'text-ink-2 hover:bg-lilac-soft'
                    )}
                    style={on ? { backgroundColor: c.color ?? '#7B3FE4' } : undefined}
                  >
                    <span className="block">{c.en ?? c.name}</span>
                    {c.en && <span className={cn('block text-[11px] font-medium', on ? 'text-white/80' : 'text-ink-3')}>{c.name}</span>}
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
                      'tap3d shrink-0 rounded-full px-4 py-2 text-sm font-semibold',
                      activeCategory === c.id ? 'text-white' : 'bg-lilac text-ink-2'
                    )}
                    style={activeCategory === c.id ? { backgroundColor: c.color ?? '#7B3FE4' } : undefined}
                  >
                    {c.en ?? c.name}
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
                          'tap3d flex min-h-[92px] flex-col items-center justify-center gap-1.5 rounded-xl border px-2.5 py-3 text-center disabled:cursor-not-allowed disabled:opacity-60',
                          m.is_sold_out ? 'border-line bg-lilac' : 'border-line bg-white hover:bg-lilac-soft'
                        )}
                        style={!m.is_sold_out && category?.color ? { borderTop: `4px solid ${category.color}` } : undefined}
                      >
                        <span className="flex items-center gap-1 text-[15px] font-bold leading-tight text-navy">
                          {m.is_recommended && <Star className="h-3.5 w-3.5 shrink-0 fill-warning text-warning" />}
                          {englishByItemId.get(m.id) ?? m.name}
                        </span>
                        {englishByItemId.get(m.id) && (
                          <span className="text-[11px] leading-tight text-ink-3">{m.name}</span>
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

            {clerkMissing && (
              <p className="mx-3 mb-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-xs font-bold text-danger">
                担当者を選んでください（注文確定・会計には担当者が必要です）
              </p>
            )}

            {canCheckout && !registerOpen && (
              <Link
                href="/app/cash/close"
                className="mx-3 mb-2 block rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger"
              >
                <b>レジが未開局です。</b>
                会計の前に「レジクローズ」画面で釣銭準備金を数えてレジを開局してください（タップで移動）
              </Link>
            )}

            <div className="border-t border-line p-3 pb-[calc(0.75rem+3.5rem+env(safe-area-inset-bottom))] lg:pb-3">
              <div className={cn('grid gap-3', order.tableId ? 'grid-cols-1' : 'grid-cols-2')}>
                {/* 決定はスライドで（押し間違いで注文が飛ばない。2026-09-25 店舗要望） */}
                <SlideToConfirm
                  label={
                    cartCount + unsentItems.length > 0
                      ? `Order（${cartCount + unsentItems.length}品）`
                      : 'Order（未確定なし）'
                  }
                  hint="スライドして注文 / Slide to order"
                  busy={pending}
                  disabled={cartCount + unsentItems.length === 0 || pending || clerkMissing}
                  onConfirm={handleSendOrder}
                />
                {/* テーブルのある伝票は テーブル一覧のポップアップから会計する。
                    テイクアウト等（卓なし）はここからしか会計できないので残す */}
                {!order.tableId && (
                  <Button
                    size="pos"
                    className="h-[64px] w-full text-[18px]"
                    disabled={items.length === 0 || pending || clerkMissing}
                    onClick={() => setCheckoutOpen(true)}
                  >
                    会計へ（{yen(order.total)}）
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

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

      {checkoutOpen && (
      <CheckoutDialog
        onClose={() => setCheckoutOpen(false)}
        order={checkoutOrder}
        canDiscount={canDiscount}
        discountReason={order.discountReason}
        setDiscountAction={setDiscountAction}
        applyCouponAction={applyCouponAction}
        clearCouponAction={clearCouponAction}
        onCheckout={handleCheckout}
        splitOrderAction={splitOrderAction}
        terminalReaders={terminalReaders}
        paymentAvailability={paymentAvailability}
        pointsAvailability={pointsAvailability}
        startTerminalPaymentAction={startTerminalPaymentAction}
        checkTerminalPaymentAction={checkTerminalPaymentAction}
        cancelTerminalPaymentAction={cancelTerminalPaymentAction}
        onTerminalPaymentFinalized={handleTerminalPaymentFinalized}
        clerks={clerks}
        currentClerkId={currentClerkId}
        discountPresets={discountPresets}
        pointBrands={pointBrands}
        methodBrands={methodBrands}
      />
      )}

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
