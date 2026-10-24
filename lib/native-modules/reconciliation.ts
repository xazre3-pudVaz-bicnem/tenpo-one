import 'server-only';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { daysAgoJst, formatDate, todayJst, yen } from '@/lib/format';
import { RECON_STATUS_LABEL, reconciliationScope, signedDiff, type ReconStatus } from '@/lib/reconciliation';
import { loadReconciliationData } from '@/lib/reconciliation-server';
import type { NativeModuleGet } from '@/lib/native-modules/registry';

/**
 * 照合（売上・現金・在庫）の iPad ネイティブ（GET part=reconciliation&from=&to=&store=）。読むだけ。
 * 中身は Web の /app/reconciliation と同じ（期間・店舗 lib/reconciliation.ts、読み込み lib/reconciliation-server.ts）。
 * 権限も Web と同じ（csv.export・会計の機能）。2026-10-24 Ronnie「全部ネイティブ」
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const status = (s: ReconStatus) => ({ status: s, label: RECON_STATUS_LABEL[s] });
const OVERALL_MESSAGE: Record<ReconStatus, string> = {
  ok: '売上・現金・在庫はすべて一致しています',
  mismatch: '不一致があります。内容を確認してください',
  no_data: 'データが不足しています',
};

export const reconciliationGet: NativeModuleGet = async ({ ctx, url }) => {
  if (!ctx.organizationId || ctx.disabledFeatures?.has('accounting')) return { status: 403, body: { ok: false, error: '照合は使えません' } };
  if (!can(ctx.role, 'csv.export')) return { status: 403, body: { ok: false, error: '照合を見る権限がありません' } };
  const q = url.searchParams;
  const sp = {
    from: DATE.test(q.get('from') ?? '') ? (q.get('from') as string) : undefined,
    to: DATE.test(q.get('to') ?? '') ? (q.get('to') as string) : undefined,
    store: UUID.test(q.get('store') ?? '') ? (q.get('store') as string) : undefined,
  };
  const scope = reconciliationScope(ctx, sp, todayJst(), daysAgoJst(6));
  const head = {
    ok: true,
    from: scope.from,
    to: scope.to,
    storeId: scope.storeId,
    // 店舗の選択は本部だけ（Web と同じ）
    stores: ctx.isHq ? ctx.stores.map((s) => ({ id: s.id, name: s.name })) : [],
    description: `${scope.storeName ?? '全社（全店舗）'}｜${scope.from.replaceAll('-', '/')}〜${scope.to.replaceAll('-', '/')}`,
  };
  if (scope.storeIds.length === 0) return { body: { ...head, noStores: true } };

  const d = await loadReconciliationData(await createClient(), { organizationId: ctx.organizationId }, scope);
  const diff = (v: number) => signedDiff(v, yen);
  const plus = (v: number) => `${v > 0 ? '+' : ''}${yen(v)}`;

  return {
    body: {
      ...head,
      noStores: false,
      overall: { ...status(d.overallStatus), message: OVERALL_MESSAGE[d.overallStatus] },
      sales: {
        ...status(d.salesStatus),
        rows: [
          { key: 'pos', label: '(a) POS純売上', amount: d.posNetSales, diff: '—', mismatch: false, note: '会計成立注文（paid+refunded）total合計 − 返金', href: `/app/orders?from=${scope.from}&to=${scope.to}` },
          { key: 'payments', label: '(b) 決済合計', amount: d.paymentsNet, diff: diff(d.diffPayments), mismatch: d.diffPayments !== 0, note: 'payments（completed）合計 − 返金', href: '/app/cash?tab=today' },
          { key: 'journal', label: '(c) 仕訳売上', amount: d.journalNetSales, diff: diff(d.diffJournal), mismatch: d.diffJournal !== 0, note: '確定済み仕訳（pos_sales/pos_refund）の売上高（400/401）net', href: '/app/accounting/auto' },
        ],
        unconfirmedDays: d.unconfirmedDayCount,
      },
      cash: {
        ...status(d.cashStatus),
        hasRows: d.cashRows.length > 0,
        expectedTotal: d.expectedCashTotal,
        countedTotal: d.countedCashTotal,
        differenceTotal: d.cashDifferenceTotal,
        differenceLabel: plus(d.cashDifferenceTotal),
        diffDays: d.cashDiffDays.map((r) => ({
          id: r.id,
          dateLabel: formatDate(r.businessDate),
          storeName: r.storeName,
          expected: r.expectedCash,
          counted: r.countedCash,
          differenceLabel: plus(r.cashDifference),
          href: `/app/cash?tab=closings&from=${r.businessDate}&to=${r.businessDate}`,
        })),
      },
      inventory: {
        ...status(d.inventoryStatus),
        hasCounts: d.hasStockCounts,
        diffCount: d.inventoryDiffRows.length,
        diffAmountTotal: d.inventoryDiffAmountTotal,
        diffAmountLabel: plus(d.inventoryDiffAmountTotal),
        rows: d.inventoryDiffRows.map((r) => ({
          id: r.id,
          name: r.name,
          qtyLabel: `${r.diffQty > 0 ? '+' : ''}${r.diffQty}${r.unit}`,
          short: r.diffQty < 0,
          unitCost: r.unitCost,
          amountLabel: r.diffAmount == null ? '単価未設定' : plus(r.diffAmount),
          mismatch: (r.diffAmount ?? 0) !== 0,
        })),
      },
    },
  };
};
