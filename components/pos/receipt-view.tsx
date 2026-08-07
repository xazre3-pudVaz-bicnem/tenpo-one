'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { yen, formatDateTime } from '@/lib/format';
import { METHOD_LABELS } from '@/components/cash/labels';
import { Input } from '@/components/ui/input';
import { PrintButton } from './print-button';

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: '店内飲食',
  takeout: 'テイクアウト',
  delivery: 'デリバリー',
  course: 'コース',
  pre_order: '事前注文',
};

export interface ReceiptOrder {
  id: string;
  orderNo: number;
  orderType: string;
  guestCount: number;
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  discountTotal: number;
  discountReason: string | null;
  total: number;
  /** 返金合計（返金がある場合のみ0より大きい） */
  refundTotal?: number;
  closedAt: string | null;
  businessDate: string;
}

export interface ReceiptItem {
  id: string;
  name: string;
  unit_price: number;
  quantity: number;
  tax_rate: number;
  tax_included: boolean;
  line_total: number;
}

export interface ReceiptPayment {
  method: string;
  amount: number;
  tendered: number | null;
  change_amount: number | null;
  paid_at: string;
}

export interface ReceiptStore {
  name: string;
  address: string | null;
  phone: string | null;
  receiptHeader: string | null;
  receiptFooter: string | null;
  invoiceRegistrationNumber: string | null;
}

function taxBreakdown(items: ReceiptItem[]) {
  const byRate = new Map<number, { gross: number; tax: number }>();
  for (const it of items) {
    const rate = it.tax_rate;
    let gross = it.line_total;
    let tax: number;
    if (it.tax_included) {
      tax = gross - Math.floor(gross / (1 + rate / 100));
    } else {
      tax = Math.floor((gross * rate) / 100);
      gross = gross + tax;
    }
    const prev = byRate.get(rate) ?? { gross: 0, tax: 0 };
    byRate.set(rate, { gross: prev.gross + gross, tax: prev.tax + tax });
  }
  return [...byRate.entries()].sort((a, b) => b[0] - a[0]);
}

export function ReceiptView({
  order,
  items,
  payments,
  store,
  logPrintJobAction,
}: {
  order: ReceiptOrder;
  items: ReceiptItem[];
  payments: ReceiptPayment[];
  store: ReceiptStore;
  logPrintJobAction: (orderId: string, jobType: 'receipt' | 'ryoshusho') => Promise<void>;
}) {
  const [tab, setTab] = useState<'receipt' | 'invoice'>('receipt');
  const [recipientName, setRecipientName] = useState('');
  const [purpose, setPurpose] = useState('お品代として');
  const breakdown = useMemo(() => taxBreakdown(items), [items]);
  const dateLabel = formatDateTime(order.closedAt ?? order.businessDate);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab('receipt')}
            className={cn(
              'rounded-full px-4 py-2 text-sm font-semibold',
              tab === 'receipt' ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600'
            )}
          >
            レシート
          </button>
          <button
            type="button"
            onClick={() => setTab('invoice')}
            className={cn(
              'rounded-full px-4 py-2 text-sm font-semibold',
              tab === 'invoice' ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600'
            )}
          >
            領収書
          </button>
        </div>
        <PrintButton
          orderId={order.id}
          jobType={tab === 'receipt' ? 'receipt' : 'ryoshusho'}
          logPrintJobAction={logPrintJobAction}
        />
      </div>

      {tab === 'invoice' && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 print:hidden">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">宛名</label>
            <Input
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="お客様名（空欄可）"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">但し書き</label>
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </div>
        </div>
      )}

      <div className="print-area mx-auto max-w-[300px] rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-800 shadow-sm">
        {tab === 'receipt' ? (
          <>
            <div className="text-center">
              <p className="text-sm font-bold">{store.name}</p>
              {store.address && <p>{store.address}</p>}
              {store.phone && <p>TEL {store.phone}</p>}
              {store.receiptHeader && <p className="mt-1 whitespace-pre-line">{store.receiptHeader}</p>}
            </div>
            <div className="my-2 border-t border-dashed border-gray-300" />
            <p>
              注文番号 #{order.orderNo}　{ORDER_TYPE_LABELS[order.orderType] ?? order.orderType}
            </p>
            <p>{dateLabel}</p>
            <div className="my-2 border-t border-dashed border-gray-300" />
            <table className="w-full">
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-0.5 align-top">
                      {it.name}
                      <br />
                      <span className="text-[10px] text-gray-500">
                        {yen(it.unit_price)} × {it.quantity}
                      </span>
                    </td>
                    <td className="py-0.5 text-right align-top tabular-nums">{yen(it.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="my-2 border-t border-dashed border-gray-300" />
            <div className="space-y-0.5">
              <div className="flex justify-between">
                <span>小計</span>
                <span className="tabular-nums">{yen(order.subtotal)}</span>
              </div>
              {order.serviceCharge > 0 && (
                <div className="flex justify-between">
                  <span>サービス料</span>
                  <span className="tabular-nums">{yen(order.serviceCharge)}</span>
                </div>
              )}
              {order.discountTotal > 0 && (
                <div className="flex justify-between">
                  <span>値引き{order.discountReason ? `（${order.discountReason}）` : ''}</span>
                  <span className="tabular-nums">-{yen(order.discountTotal)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold">
                <span>合計</span>
                <span className="tabular-nums">{yen(order.total)}</span>
              </div>
              {breakdown.map(([rate, v]) => (
                <div key={rate} className="flex justify-between text-[10px] text-gray-500">
                  <span>（内消費税{rate}%対象 {yen(v.gross)}）</span>
                  <span className="tabular-nums">税額 {yen(v.tax)}</span>
                </div>
              ))}
            </div>
            <div className="my-2 border-t border-dashed border-gray-300" />
            <div className="space-y-0.5">
              {payments.map((p, i) => (
                <div key={i} className="flex justify-between">
                  <span>{METHOD_LABELS[p.method] ?? p.method}</span>
                  <span className="tabular-nums">{yen(p.amount)}</span>
                </div>
              ))}
              {payments.some((p) => p.tendered != null) && (
                <>
                  <div className="flex justify-between">
                    <span>預り金</span>
                    <span className="tabular-nums">
                      {yen(payments.reduce((a, p) => a + (p.tendered ?? 0), 0))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>お釣り</span>
                    <span className="tabular-nums">
                      {yen(payments.reduce((a, p) => a + (p.change_amount ?? 0), 0))}
                    </span>
                  </div>
                </>
              )}
              {!!order.refundTotal && order.refundTotal > 0 && (
                <>
                  <div className="flex justify-between text-danger">
                    <span>返金</span>
                    <span className="tabular-nums">-{yen(order.refundTotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold">
                    <span>実質お支払い額</span>
                    <span className="tabular-nums">{yen(order.total - order.refundTotal)}</span>
                  </div>
                </>
              )}
            </div>
            {store.invoiceRegistrationNumber && (
              <>
                <div className="my-2 border-t border-dashed border-gray-300" />
                <p>登録番号 {store.invoiceRegistrationNumber}</p>
              </>
            )}
            {store.receiptFooter && (
              <p className="mt-2 whitespace-pre-line text-center">{store.receiptFooter}</p>
            )}
          </>
        ) : (
          <>
            <p className="text-center text-sm font-bold">領収書</p>
            <div className="my-2 border-t border-dashed border-gray-300" />
            <p className="border-b border-gray-400 pb-1 text-sm">
              {recipientName ? `${recipientName} 様` : '　　　　　　　様'}
            </p>
            <p className="mt-3 text-center text-lg font-bold tabular-nums">{yen(order.total)}−</p>
            <p className="mt-1 text-center text-[10px] text-gray-500">（税込）</p>
            <div className="my-2 border-t border-dashed border-gray-300" />
            <p>但し {purpose} として</p>
            <p className="mt-1">上記正に領収いたしました</p>
            <div className="my-2 border-t border-dashed border-gray-300" />
            <div className="flex justify-between text-[10px] text-gray-500">
              <span>内消費税</span>
              <span className="tabular-nums">{yen(order.taxTotal)}</span>
            </div>
            <p className="mt-2">{dateLabel}</p>
            <p className="mt-2 font-bold">{store.name}</p>
            {store.address && <p>{store.address}</p>}
            {store.phone && <p>TEL {store.phone}</p>}
            {store.invoiceRegistrationNumber && <p>登録番号 {store.invoiceRegistrationNumber}</p>}
          </>
        )}
      </div>
    </div>
  );
}
