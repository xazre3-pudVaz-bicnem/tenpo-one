import Link from 'next/link';
import { cn } from '@/lib/utils';
import { yen, formatTime } from '@/lib/format';
import { buttonVariants } from '@/components/ui/button';
import { KIND_LABELS, IN_KINDS, OUT_KINDS, type CashKind } from '@/components/cash/labels';

/** 表示用の入出金1行（app/app/cash/close/data.ts の TodayCashRow と同じ形） */
export interface CashHistoryRow {
  id: string;
  kind: CashKind;
  amount: number;
  purpose: string | null;
  occurredAt: string;
  approvalStatus: string;
  receiptDocumentId: string | null;
  createdByName: string;
  registerName: string | null;
  advanceOpen: boolean;
}

/** 「理由：メモ」形式の用途を見出しと補足に分ける */
export function splitPurpose(purpose: string | null, kind: CashKind): { main: string; sub: string | null } {
  if (!purpose) return { main: KIND_LABELS[kind], sub: null };
  const i = purpose.indexOf('：');
  if (i <= 0) return { main: purpose, sub: null };
  return { main: purpose.slice(0, i), sub: purpose.slice(i + 1) || null };
}

const chip = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-bold whitespace-nowrap';
export const CHIP = {
  in: cn(chip, 'bg-success-soft text-success'),
  out: cn(chip, 'bg-saffron-soft text-saffron'),
  ok: cn(chip, 'bg-success-soft text-success'),
  ng: cn(chip, 'bg-danger-soft text-danger'),
  wait: cn(chip, 'bg-saffron-soft text-saffron'),
  muted: cn(chip, 'bg-lilac text-ink-2'),
};

/**
 * 出金のレシート状態チップ＋操作（添付／精算へ）。
 * レシートは登録時に必須ではない。出金を先に記録しておき、レシートは後から添付する運用のため、
 * 未添付は「エラー」ではなく「あとで貼る」ぶんとして落ち着いた色で出す。
 */
export function ReceiptCell({
  row,
  canScan,
  canSettle,
  compact,
}: {
  row: Pick<CashHistoryRow, 'id' | 'kind' | 'receiptDocumentId' | 'advanceOpen'>;
  canScan: boolean;
  canSettle: boolean;
  compact?: boolean;
}) {
  const mini = cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-8 border-wisteria px-3 text-[12.5px] font-bold text-royal');
  const miniPrimary = cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'h-8 px-3 text-[12.5px]');
  if (row.kind === 'petty_advance') {
    if (!row.advanceOpen) return <span className={CHIP.ok}>精算済</span>;
    return (
      <span className={compact ? 'flex flex-col items-end gap-1' : 'inline-flex items-center gap-2'}>
        <span className={compact ? 'text-[11.5px] font-bold text-danger' : CHIP.wait}>{compact ? '仮払い 未精算' : '精算待ち'}</span>
        {canSettle && (
          <Link href="/app/cash?tab=petty" className={compact ? miniPrimary : mini}>
            精算へ
          </Link>
        )}
      </span>
    );
  }
  if (row.kind !== 'withdrawal' && row.kind !== 'petty_out') return <span className="text-ink-3">—</span>;
  if (row.receiptDocumentId) return <span className={CHIP.ok}>✓ {compact ? 'レシート' : '写真'}</span>;
  return (
    <span className={compact ? 'flex flex-col items-end gap-1' : 'inline-flex items-center gap-2'}>
      <span className={compact ? 'text-[11.5px] font-bold text-ink-2' : CHIP.muted}>レシート未添付</span>
      {canScan && (
        <Link
          href={`/app/scan?tx=${row.id}`}
          title="いま撮る／あとで写真・PDFを選んで添付する"
          className={compact ? miniPrimary : mini}
        >
          添付する
        </Link>
      )}
    </span>
  );
}

/** 本日の入出金履歴テーブル（プロトタイプの cash 右カラム） */
export function CashHistoryTable({
  rows,
  canScan,
  canSettle,
}: {
  rows: CashHistoryRow[];
  canScan: boolean;
  canSettle: boolean;
}) {
  if (rows.length === 0) {
    return <p className="px-5 py-12 text-center text-sm text-ink-3">本日の入出金はまだありません</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-[13.5px]">
        <thead>
          <tr className="bg-lilac-soft text-left text-xs font-semibold text-ink-3">
            <th className="border-b border-line px-3.5 py-2.5">時刻</th>
            <th className="border-b border-line px-3.5 py-2.5">区分</th>
            <th className="border-b border-line px-3.5 py-2.5">理由／メモ</th>
            <th className="border-b border-line px-3.5 py-2.5 text-right">金額</th>
            <th className="border-b border-line px-3.5 py-2.5">レシート</th>
            <th className="border-b border-line px-3.5 py-2.5">担当</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isIn = IN_KINDS.includes(r.kind);
            const isOut = OUT_KINDS.includes(r.kind) || r.kind === 'petty_advance';
            const { main, sub } = splitPurpose(r.purpose, r.kind);
            const kindNote = [KIND_LABELS[r.kind], r.registerName].filter(Boolean).join('・');
            return (
              <tr key={r.id} className="border-b border-line last:border-b-0">
                <td className="px-3.5 py-3 font-bold text-royal tabular-nums">{formatTime(r.occurredAt)}</td>
                <td className="px-3.5 py-3">
                  <span className={isIn ? CHIP.in : isOut ? CHIP.out : CHIP.muted}>{isIn ? '入金' : isOut ? '出金' : '調整'}</span>
                </td>
                <td className="max-w-[16rem] px-3.5 py-3">
                  <span className="block truncate text-ink">{main}</span>
                  <small className="block truncate text-xs text-ink-3">
                    {sub ?? kindNote}
                    {r.approvalStatus === 'pending' && <span className="ml-1 font-bold text-saffron">承認待ち</span>}
                  </small>
                </td>
                <td className="px-3.5 py-3 text-right font-bold text-ink tabular-nums">
                  {isIn ? '+' : isOut ? '−' : ''}
                  {yen(r.amount)}
                </td>
                <td className="px-3.5 py-3">
                  <ReceiptCell row={r} canScan={canScan} canSettle={canSettle} />
                </td>
                <td className="px-3.5 py-3 text-[12.5px] text-ink-3">{r.createdByName}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
