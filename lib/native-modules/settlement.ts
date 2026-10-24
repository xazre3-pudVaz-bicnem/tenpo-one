import 'server-only';
import { can } from '@/lib/permissions';
import { todayJst, yen } from '@/lib/format';
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from '@/components/invoices/labels';
import {
  FIXED_COST_KINDS,
  FIXED_COST_LABELS,
  MAX_OTHER_COSTS,
  isMonthKey,
  nextMonth,
  prevMonth,
  rangeLabel,
  shortDate,
  type ProfitLoss,
} from '@/lib/monthly-settlement';
import { loadSettlementView } from '@/lib/settlement-server';
import { saveMonthlyCosts } from '@/app/app/settlement/actions';
import type { NativeModuleGet, NativeModulePost, NativeModuleResult } from '@/lib/native-modules/registry';

/**
 * 月次清算の iPad ネイティブ（GET part=settlement&month=YYYY-MM ／ POST settlementCostsSave）。
 * 中身・操作は Web の /app/settlement と同じ（読み込み lib/settlement-server.ts、保存 app/app/settlement/actions.ts）。
 * Web と同じく、レジ端末のアカウントには出さない（管理画面だけ）。店を開くのは Web と同じ店舗の切り替え（POST switchStore）。
 * 権限も Web と同じ（reports.view。固定費・給料の入力は本部だけ＝Server Action の中で見る）。2026-10-24 Ronnie「全部ネイティブ」
 */

const SCANNED_LABEL: Record<string, string> = { rent: '家賃', electric: '電気', water: '水道', gas: 'ガス' };

const card = (label: string, value: number, sub: string, plain: boolean, detail?: ProfitLoss) => ({
  label,
  value,
  sub,
  plain,
  detail: detail
    ? `売上 ${yen(detail.sales)} − 仕入 ${yen(detail.purchases)} − 経費 ${yen(detail.expenses)} − 固定費 ${yen(detail.fixed)} − 給料 ${yen(detail.salary)}`
    : null,
});

const pl = (p: ProfitLoss) => ({ sales: p.sales, purchases: p.purchases, expenses: p.expenses, fixed: p.fixed, salary: p.salary, profit: p.profit });

export const settlementGet: NativeModuleGet = async ({ ctx, url }) => {
  if (!ctx.organizationId) return { status: 403, body: { ok: false, error: '月次清算は使えません' } };
  if (!can(ctx.role, 'reports.view')) return { status: 403, body: { ok: false, error: '月次清算を見る権限がありません' } };
  const today = todayJst();
  const raw = url.searchParams.get('month');
  const month = isMonthKey(raw) ? raw : today.slice(0, 7);
  const view = await loadSettlementView(ctx, month, today);
  const nav = { month, prevMonth: prevMonth(month), nextMonth: nextMonth(month), isCurrentMonth: month === today.slice(0, 7) };

  if (view.kind === 'register') {
    return {
      body: {
        ok: true,
        kind: 'empty',
        ...nav,
        title: 'この画面はパソコン（管理画面）でご利用ください',
        message: '売上・仕入・固定費・給料の清算は、店長以上のアカウントでパソコンから開きます。レジ（iPad）には出しません',
      },
    };
  }
  if (view.kind === 'noStores') {
    return { body: { ok: true, kind: 'empty', ...nav, title: '対象の店舗がありません', message: '店舗を選択してから開いてください' } };
  }

  const { mw, ww, monthLabel, monthInProgress } = view;
  const until = monthInProgress ? `（${shortDate(mw.last)} まで）` : '';

  if (view.kind === 'all') {
    const perStore = view.perStore;
    const rows = perStore.map(({ store, monthPl, weekPl }) => ({ storeId: store.id, storeName: store.name, month: pl(monthPl), weekProfit: weekPl.profit }));
    const total = (pick: (p: (typeof perStore)[number]) => number) => perStore.reduce((s, p) => s + pick(p), 0);
    return {
      body: {
        ok: true,
        kind: 'all',
        ...nav,
        monthLabel,
        description: `全店舗・${monthLabel}${until}。店を開くと日ごとの表と固定費・給料の入力`,
        cards: [
          card('今週の損益', total((p) => p.weekPl.profit), rangeLabel(ww.first, ww.last), false),
          card(`${monthLabel}の損益`, total((p) => p.monthPl.profit), '固定費・給料は月の金額', false),
          card('売上', total((p) => p.monthPl.sales), monthLabel, true),
          card('仕入・経費・固定費・給料', total((p) => p.monthPl.purchases + p.monthPl.expenses + p.monthPl.fixed + p.monthPl.salary), monthLabel, true),
        ],
        rows,
        totals: {
          month: {
            sales: total((p) => p.monthPl.sales),
            purchases: total((p) => p.monthPl.purchases),
            expenses: total((p) => p.monthPl.expenses),
            fixed: total((p) => p.monthPl.fixed),
            salary: total((p) => p.monthPl.salary),
            profit: total((p) => p.monthPl.profit),
          },
          weekProfit: total((p) => p.weekPl.profit),
        },
        note: '売上＝レジで会計した金額（返金を引く）。仕入＝請求書・書類に入れた仕入先の請求書（差戻し以外）。経費＝レジ・管理画面で入れた経費（却下以外）。家賃・電気・水道・給料は各店を開いて本部が月ごとに入れる。今週の損益は、月の固定費・給料を日割りして引く。',
      },
    };
  }

  const { p, table, monthInvoices, scannedBills } = view;
  return {
    body: {
      ok: true,
      kind: 'store',
      ...nav,
      monthLabel,
      description: `${p.store.name}・${monthLabel}${until}`,
      storeId: p.store.id,
      storeName: p.store.name,
      canEdit: view.canEdit,
      cards: [
        card('今週の損益', p.weekPl.profit, `${rangeLabel(ww.first, ww.last)}・固定費・給料は日割り`, false, p.weekPl),
        card(`${monthLabel}の損益`, p.monthPl.profit, '固定費・給料は月の金額', false, p.monthPl),
        card('売上', p.monthPl.sales, `${monthLabel}（返金を引いた金額）`, true),
        card('仕入・経費', p.monthPl.purchases + p.monthPl.expenses, table.outgoShare != null ? `売上の ${table.outgoShare}%` : monthLabel, true),
      ],
      table: {
        vendors: table.vendors,
        rows: table.rows.map((r) => ({ date: r.date, label: shortDate(r.date), sales: r.sales, byVendor: r.byVendor, expenses: r.expenses, outgo: r.outgo })),
        totals: table.totals,
        vendorShare: table.vendorShare,
        expensesShare: table.expensesShare,
        outgoShare: table.outgoShare,
      },
      costs: p.costs,
      costKinds: FIXED_COST_KINDS.map((k) => ({ key: k, label: FIXED_COST_LABELS[k].ja })),
      maxOther: MAX_OTHER_COSTS,
      scanned: scannedBills.map((b) => ({
        documentId: b.documentId,
        category: b.category,
        label: SCANNED_LABEL[b.category] ?? b.category,
        amount: b.amount,
        dateLabel: b.date ? b.date.slice(5).replace('-', '/') : null,
      })),
      invoices: monthInvoices.map((inv) => ({
        id: inv.id,
        dateLabel: shortDate(inv.date),
        vendor: inv.vendor,
        invoiceNo: inv.invoiceNo,
        amount: inv.amount,
        dueLabel: inv.dueDate ? shortDate(inv.dueDate) : null,
        status: inv.status,
        statusLabel: INVOICE_STATUS_LABELS[inv.status as InvoiceStatus] ?? inv.status,
      })),
    },
  };
};

/** 家賃・電気・水道・給料・その他を保存（Web の MonthlyCostsForm → saveMonthlyCosts と同じ。本部だけ・レジ端末は不可は Server Action が見る） */
export const settlementCostsSavePost: NativeModulePost = async ({ ctx, raw }): Promise<NativeModuleResult> => {
  if (!can(ctx.role, 'reports.view')) return { status: 403, body: { ok: false, error: '権限がありません' } };
  const storeId = typeof raw.storeId === 'string' ? raw.storeId : '';
  const month = typeof raw.month === 'string' ? raw.month : '';
  const c = raw.costs && typeof raw.costs === 'object' && !Array.isArray(raw.costs) ? (raw.costs as Record<string, unknown>) : null;
  if (!storeId || !isMonthKey(month) || !c) return { status: 400, body: { ok: false, error: '内容が正しくありません' } };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const other = Array.isArray(c.other)
    ? c.other.slice(0, MAX_OTHER_COSTS + 1).map((o) => {
        const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
        return { name: typeof r.name === 'string' ? r.name : '', amount: num(r.amount) };
      })
    : [];
  const result = await saveMonthlyCosts(storeId, month, { rent: num(c.rent), electric: num(c.electric), water: num(c.water), salary: num(c.salary), other });
  if (result.error) return { status: 400, body: { ok: false, error: result.error } };
  return { body: { ok: true, message: '固定費・給料を保存しました' } };
};
