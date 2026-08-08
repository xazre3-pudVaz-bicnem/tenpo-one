/**
 * レジ締め（daily_closings）のsnapshot表示。gross/refund/net・支払方法別内訳（売上/返金別）・
 * 小口入出金・理論現金（式付き）・実現金・差異を表示する（v0.4.2 REFUND CONSISTENCY）。
 * 「今日の締めサマリ」カードと締め履歴の展開行の両方から使う共通表示。
 */
import { StatCard } from '@/components/ui/stat-card';
import { yen } from '@/lib/format';
import { METHOD_LABELS } from './labels';

export interface ClosingSnapshotData {
  salesTotal: number;
  refundTotal: number;
  /** 純売上（net_sales）。旧データ（expected_cashがnull）ではdefault 0のままなので信用しない */
  netSales: number;
  discountTotal: number;
  paymentBreakdown: Record<string, number>;
  refundBreakdown: Record<string, number>;
  pettyInTotal: number;
  pettyOutTotal: number;
  /** null許容。null = v0.4.2以前の締め（新snapshot列は記録されていない） */
  expectedCash: number | null;
  countedCash: number | null;
  cashDifference: number;
}

export function ClosingSnapshot({ data }: { data: ClosingSnapshotData }) {
  // expected_cashはclose_register_session内で必ず算出される値のため、nullは
  // 「このmigration以前に作られた締め」を意味する唯一の信頼できる判定材料。
  const isLegacy = data.expectedCash == null;
  const paymentEntries = Object.entries(data.paymentBreakdown).filter(([, v]) => v);
  const refundEntries = Object.entries(data.refundBreakdown).filter(([, v]) => v);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="総売上（gross）" value={yen(data.salesTotal)} />
        <StatCard label="値引" value={yen(data.discountTotal)} />
        <StatCard label="返金" value={yen(data.refundTotal)} tone={data.refundTotal > 0 ? 'warning' : 'default'} />
        <StatCard label="純売上" value={isLegacy ? '—' : yen(data.netSales)} tone="primary" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-gray-500">支払方法別内訳（売上）</p>
          {paymentEntries.length === 0 ? (
            <p className="mt-2 text-sm text-gray-400">データがありません</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {paymentEntries.map(([method, amt]) => (
                <li key={method} className="flex justify-between gap-2">
                  <span className="text-gray-600">{METHOD_LABELS[method] ?? method}</span>
                  <span className="tabular-nums font-medium text-navy">{yen(amt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500">支払方法別内訳（返金）</p>
          {isLegacy ? (
            <p className="mt-2 text-sm text-gray-400">—（旧データのため記録なし）</p>
          ) : refundEntries.length === 0 ? (
            <p className="mt-2 text-sm text-gray-400">返金はありません</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {refundEntries.map(([method, amt]) => (
                <li key={method} className="flex justify-between gap-2">
                  <span className="text-gray-600">{METHOD_LABELS[method] ?? method}</span>
                  <span className="tabular-nums font-medium text-danger">{yen(amt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="小口入金" value={isLegacy ? '—' : yen(data.pettyInTotal)} />
        <StatCard label="小口出金" value={isLegacy ? '—' : yen(data.pettyOutTotal)} />
        <StatCard
          label="理論現金"
          value={isLegacy ? '—' : yen(data.expectedCash)}
          tone="primary"
          sub="開始現金＋現金売上＋入金－現金返金－小口出金"
        />
        <StatCard
          label="実現金"
          value={data.countedCash == null ? '—' : yen(data.countedCash)}
        />
      </div>

      <div className="space-y-1 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
        <p>クレジット／QRコード決済等の返金は現金残高へ影響しません。理論現金の計算に含まれるのは現金返金のみです。</p>
        <p>
          この数値は締め実行時点のスナップショットです。締め後に発生した返金は、返金が発生した営業日側の集計に計上されます（この日の数値は遡って変わりません）。
        </p>
        {isLegacy && (
          <p className="font-medium text-warning">
            この締めは純売上・返金内訳・小口入出金・理論現金／実現金の記録が追加される前に実行されたため、該当項目は「—」表示です（0円ではありません）。
          </p>
        )}
      </div>
    </div>
  );
}
