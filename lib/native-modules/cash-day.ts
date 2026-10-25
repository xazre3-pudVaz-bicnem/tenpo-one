import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { loadStoreDay } from '@/lib/register-day-server';
import { loadRegisterBoard, STORE_DAY_CLOSE_ROLES } from '@/app/app/cash/close/data';
import { loadCloseBreakdown } from '@/app/app/cash/close/breakdown-data';
import { closeStoreDay } from '@/app/app/cash/actions';
import { CLOSING_STATUS_LABELS, METHOD_LABELS, type ClosingStatus } from '@/components/cash/labels';
import { parseCashDayQuery, parseStoreDayClose } from '@/lib/native-owner-settings';
import { nativeBad, nativeErrorText } from '@/lib/native-modules/guard';
import type { NativeModuleGet, NativeModulePost } from '@/lib/native-modules/registry';

/**
 * iPhone の店長・オーナー：店舗日次締め・開店チェックリスト・売上の内訳（GET part=cashDay&period=&date= ／ POST storeDayClose）。
 * 中身は Web の /app/cash（開店チェックリスト）と /app/cash/close（店舗日次締め 実行前チェック・本日の締めサマリ・売上の内訳）と同じ
 * （app/app/cash/close/data.ts の loadRegisterBoard・breakdown-data.ts の loadCloseBreakdown・actions.ts の closeStoreDay）。
 * レジ精算レシートのプレビュー・印刷は別のチームの持ち物なので出さない。2026-10-25 Ronnie「101% native」
 */

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v ?? 0) || 0);

export const cashDayGet: NativeModuleGet = async ({ ctx, url, store }) => {
  if (ctx.disabledFeatures?.has('accounting')) return nativeBad('入出金は使えません', 403);
  const supabase = await createClient();
  const storeDay = await loadStoreDay(supabase, store.id);
  const today = storeDay.businessDate;
  const q = parseCashDayQuery(url.searchParams.get('period'), url.searchParams.get('date'), today);
  const [board, breakdown] = await Promise.all([loadRegisterBoard(store.id, today), loadCloseBreakdown(store.id, q.period, q.date)]);
  const c = board.todayClosing as Record<string, unknown> | null;
  const payments = c && c.payment_breakdown && typeof c.payment_breakdown === 'object' ? (c.payment_breakdown as Record<string, unknown>) : {};
  return {
    body: {
      ok: true,
      store,
      businessDate: today,
      period: q.period,
      date: q.date,
      openingItems: board.openingItems,
      preCloseItems: board.preCloseItems,
      alreadyClosed: !!c,
      canClose: STORE_DAY_CLOSE_ROLES.includes(ctx.role ?? ''),
      closing: c
        ? {
            status: String(c.status ?? ''),
            statusLabel: CLOSING_STATUS_LABELS[c.status as ClosingStatus] ?? String(c.status ?? ''),
            salesTotal: num(c.sales_total),
            refundTotal: num(c.refund_total),
            netSales: num(c.net_sales),
            discountTotal: num(c.discount_total),
            pettyInTotal: num(c.petty_in_total),
            pettyOutTotal: num(c.petty_out_total),
            expectedCash: c.expected_cash == null ? null : num(c.expected_cash),
            countedCash: c.counted_cash == null ? null : num(c.counted_cash),
            cashDifference: num(c.cash_difference),
            payments: Object.entries(payments)
              .map(([method, amount]) => ({ method, label: METHOD_LABELS[method] ?? method, amount: num(amount) }))
              .filter((p) => p.amount !== 0),
            registers: board.registerBreakdown.map((r) => ({
              registerName: r.registerName,
              expectedCash: r.expectedCash,
              countedCash: r.countedCash,
              difference: r.difference,
              closedByName: r.closedByName,
            })),
          }
        : null,
      breakdown,
    },
  };
};

/** 店舗日次締め（Web の StoreDayClosePanel と同じ closeStoreDay。未締めレジが残っていればサーバーが断る） */
export const storeDayClosePost: NativeModulePost = async ({ ctx, store, raw }) => {
  if (ctx.disabledFeatures?.has('accounting')) return nativeBad('入出金は使えません', 403);
  if (!STORE_DAY_CLOSE_ROLES.includes(ctx.role ?? '')) return nativeBad('店舗日次締めの実行権限がありません', 403);
  const parsed = parseStoreDayClose(raw);
  if (!parsed.ok) return nativeBad(parsed.error);
  try {
    const r = await closeStoreDay(store.id, parsed.businessDate);
    if (!r.ok) return nativeBad(r.error);
    return { body: { ok: true } };
  } catch (e) {
    return nativeBad(nativeErrorText(e, '店舗日次締めに失敗しました'));
  }
};
