'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Minus, Plus, X, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import {
  CheckoutDialog,
  type CheckoutOrder,
  type PosPaymentAvailability,
  type PosTerminalReader,
} from './checkout-dialog';
import type { CheckoutPayment } from '@/app/app/pos/actions';
import type { TerminalPaymentState } from '@/app/app/pos/payment-actions';

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: '店内',
  takeout: 'テイクアウト',
  delivery: 'デリバリー',
  course: 'コース',
  pre_order: '事前注文',
};

export interface PosOrder {
  id: string;
  orderNo: number;
  orderType: string;
  guestCount: number;
  discountTotal: number;
  discountReason: string | null;
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  total: number;
}

export interface PosOrderItem {
  id: string;
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
  color: string | null;
  sort_order: number;
}

export interface PosMenuItem {
  id: string;
  category_id: string | null;
  name: string;
  price: number;
  takeout_price: number | null;
  item_type: string;
  is_sold_out: boolean;
  sort_order: number;
}

export function PosScreen({
  order,
  items,
  categories,
  menuItems,
  tableName,
  staffName,
  canDiscount,
  terminalReaders,
  paymentAvailability,
  addItemAction,
  updateQtyAction,
  cancelItemAction,
  setDiscountAction,
  checkoutAction,
  startTerminalPaymentAction,
  checkTerminalPaymentAction,
  cancelTerminalPaymentAction,
}: {
  order: PosOrder;
  items: PosOrderItem[];
  categories: PosCategory[];
  menuItems: PosMenuItem[];
  tableName: string | null;
  staffName: string | null;
  canDiscount: boolean;
  terminalReaders: PosTerminalReader[];
  paymentAvailability: PosPaymentAvailability;
  addItemAction: (orderId: string, menuItemId: string) => Promise<void>;
  updateQtyAction: (orderId: string, orderItemId: string, delta: number) => Promise<void>;
  cancelItemAction: (orderId: string, orderItemId: string, reason: string) => Promise<void>;
  setDiscountAction: (orderId: string, discountTotal: number, reason: string) => Promise<void>;
  checkoutAction: (
    orderId: string,
    payments: CheckoutPayment[]
  ) => Promise<{ ok: true; warning: string | null }>;
  startTerminalPaymentAction: (orderId: string, readerId: string) => Promise<TerminalPaymentState>;
  checkTerminalPaymentAction: (localIntentId: string) => Promise<TerminalPaymentState>;
  cancelTerminalPaymentAction: (localIntentId: string) => Promise<TerminalPaymentState>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [activeCategory, setActiveCategory] = useState<string>(categories[0]?.id ?? '');
  const [cancelTarget, setCancelTarget] = useState<PosOrderItem | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const isTakeoutLike = order.orderType === 'takeout' || order.orderType === 'delivery';
  const visibleItems = useMemo(
    () =>
      activeCategory
        ? menuItems.filter((m) => m.category_id === activeCategory)
        : menuItems.filter((m) => !m.category_id),
    [menuItems, activeCategory]
  );

  const handleAdd = (menuItemId: string) => {
    startTransition(async () => {
      try {
        await addItemAction(order.id, menuItemId);
      } catch (e) {
        toast(e instanceof Error ? e.message : '追加に失敗しました', 'error');
      }
    });
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

  const handleCancel = async (reason: string) => {
    if (!cancelTarget) return;
    try {
      await cancelItemAction(order.id, cancelTarget.id, reason);
    } catch (e) {
      toast(e instanceof Error ? e.message : '取消に失敗しました', 'error');
    }
  };

  const handleCheckout = async (payments: CheckoutPayment[]) => {
    const result = await checkoutAction(order.id, payments);
    toast(result.warning ?? '会計が完了しました', result.warning ? 'error' : 'success');
    router.push(`/app/pos/receipt/${order.id}`);
  };

  const handleTerminalPaymentFinalized = () => {
    toast('決済が完了しました', 'success');
    router.push(`/app/pos/receipt/${order.id}`);
  };

  const checkoutOrder: CheckoutOrder = {
    id: order.id,
    subtotal: order.subtotal,
    taxTotal: order.taxTotal,
    serviceCharge: order.serviceCharge,
    discountTotal: order.discountTotal,
    total: order.total,
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col lg:flex-row">
      {/* 左: カテゴリ + 商品グリッド */}
      <div className="flex min-w-0 flex-1 flex-col border-b border-gray-200 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
          <Link href="/app/floor" className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-primary">
            <ArrowLeft className="h-4 w-4" />
            フロアへ戻る
          </Link>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="navy">{tableName ?? ORDER_TYPE_LABELS[order.orderType] ?? order.orderType}</Badge>
            <span className="text-gray-500">{order.guestCount}名</span>
            {staffName && <span className="text-gray-500">担当: {staffName}</span>}
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto border-b border-gray-200 bg-white px-3 py-2">
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
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {visibleItems.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">このカテゴリに商品がありません</p>
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
                    <span className="text-sm font-bold text-navy">{m.name}</span>
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

      {/* 右: 伝票 */}
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
                    <p className="min-w-0 flex-1 text-sm font-medium text-navy">{it.name}</p>
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
                      <span className="w-6 text-center text-sm font-semibold tabular-nums">{it.quantity}</span>
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
              <span>値引き</span>
              <span className="tabular-nums">-{yen(order.discountTotal)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-gray-100 pt-1.5 text-base font-bold text-navy">
            <span>合計</span>
            <span className="tabular-nums">{yen(order.total)}</span>
          </div>
        </div>

        <div className="border-t border-gray-200 p-3">
          <Button
            size="pos"
            className="w-full"
            disabled={items.length === 0 || pending}
            onClick={() => setCheckoutOpen(true)}
          >
            会計へ（{yen(order.total)}）
          </Button>
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

      <CheckoutDialog
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        order={checkoutOrder}
        canDiscount={canDiscount}
        discountReason={order.discountReason}
        setDiscountAction={setDiscountAction}
        onCheckout={handleCheckout}
        terminalReaders={terminalReaders}
        paymentAvailability={paymentAvailability}
        startTerminalPaymentAction={startTerminalPaymentAction}
        checkTerminalPaymentAction={checkTerminalPaymentAction}
        cancelTerminalPaymentAction={cancelTerminalPaymentAction}
        onTerminalPaymentFinalized={handleTerminalPaymentFinalized}
      />
    </div>
  );
}
