/**
 * 仕訳⇔元取引の双方向リンク規約。
 * 元取引の source_id 形式（app/app/accounting/auto/actions.ts 準拠）:
 *   pos_sales  = `{storeId}:{businessDate}`（日次・店舗単位の集計仕訳。個々の注文には紐付かない）
 *   pos_refund = `{storeId}:{businessDate}`（返金の営業日で集計。元売上の日ではない点に注意）
 *   purchase   = invoices.id（仕入請求書）
 *   expense    = expenses.id
 *   petty_cash = cash_transactions.id（小口現金）
 *   payroll    = payroll_runs.id
 *   bank       = bank_transactions.id
 * manual / correction / opening は外部の元取引を持たない。
 */
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SourceType } from './labels';

/** 仕訳一覧（source_type/source_id で絞り込み）への逆リンク。元取引ページから使う。 */
export function JournalSourceLink({
  sourceType,
  sourceId,
  label = '仕訳を見る',
  className,
}: {
  sourceType: SourceType;
  sourceId: string;
  label?: string;
  className?: string;
}) {
  const params = new URLSearchParams({ source_type: sourceType, source_id: sourceId });
  return (
    <Link
      href={`/app/accounting?${params.toString()}`}
      className={cn('inline-flex items-center gap-1 text-xs font-medium text-primary-deep hover:underline', className)}
    >
      <FileText className="h-3.5 w-3.5" />
      {label}
    </Link>
  );
}

/** 仕訳行から元取引ページへのリンク先ラベル（区分ごと） */
export const ORIGIN_LINK_LABELS: Partial<Record<SourceType, string>> = {
  pos_sales: '売上を見る',
  pos_refund: '返金元の取引を見る',
  expense: '経費を見る',
  purchase: '請求書を見る',
  petty_cash: '小口現金を見る',
  payroll: '給与を見る',
  bank: '銀行取引を見る',
};

/**
 * 仕訳の source_type/source_id から元取引ページのURLを解決する（純関数）。
 * 元取引が存在しない区分（manual/correction/opening/fixed_asset）や
 * source_id が無い場合は null を返す（＝リンクを表示しない）。
 */
export function resolveSourceOriginHref(sourceType: SourceType, sourceId: string | null): string | null {
  if (!sourceId) return null;
  switch (sourceType) {
    case 'pos_sales':
    case 'pos_refund': {
      const sep = sourceId.indexOf(':');
      const date = sep >= 0 ? sourceId.slice(sep + 1) : null;
      return date ? `/app/orders?from=${date}&to=${date}` : '/app/orders';
    }
    case 'expense':
      return '/app/expenses';
    case 'purchase':
      return '/app/invoices';
    case 'petty_cash':
      return '/app/cash?tab=petty';
    case 'payroll':
      return `/app/payroll/${sourceId}`;
    case 'bank':
      return '/app/accounting/banks';
    default:
      return null;
  }
}
