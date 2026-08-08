import { yen, formatDate, formatDateTime } from '@/lib/format';

export interface SnapshotPayrollRule {
  id: string;
  profileId: string;
  storeId: string | null;
  payType: 'monthly' | 'hourly' | 'daily';
  baseAmount: number;
  overtimeRate: number;
  nightRate: number;
  holidayRate: number;
  commuteAllowance: number;
  allowances: { name: string; amount: number; per: 'month' | 'day' }[];
  effectiveFrom: string;
  effectiveTo: string | null;
  closingDay: number;
  paymentDay: number;
}

export interface SnapshotCommissionRule {
  id: string;
  name: string;
  targetType: string;
  profileId: string | null;
  storeId: string | null;
  method: 'fixed' | 'rate' | 'tiered';
  rate: number | null;
  fixedAmount: number | null;
  tiers: { from: number; to: number | null; rate: number }[] | null;
  basis: string;
  minAmount: number | null;
  maxAmount: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface RulesSnapshot {
  calcVersion?: string;
  generatedAt?: string;
  note?: string;
  payrollRules?: SnapshotPayrollRule[];
  commissionRules?: SnapshotCommissionRule[];
}

const PAY_TYPE_LABEL: Record<string, string> = { monthly: '月給', hourly: '時給', daily: '日給' };
const METHOD_LABEL: Record<string, string> = { fixed: '固定額', rate: '料率', tiered: '段階料率' };

/**
 * 承認済み給与runが確定時点で使用した給与ルール・歩合ルールのスナップショット表示。
 * payroll_runs.rules_snapshot（承認時に固定・以後不変）をそのまま表示する。
 * profileNameById が無い（削除済み等の）場合は profileId を短縮表示する。
 */
export function RulesSnapshotPanel({
  snapshot,
  profileNameById,
}: {
  snapshot: RulesSnapshot;
  profileNameById: Map<string, string>;
}) {
  const rules = snapshot.payrollRules ?? [];
  const commissionRules = snapshot.commissionRules ?? [];

  return (
    <div className="rounded-xl border border-navy/15 bg-navy/[0.03] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-navy">このrunの計算に使用したルール（確定時点で固定）</h3>
        {snapshot.generatedAt && <span className="text-xs text-gray-500">記録日時: {formatDateTime(snapshot.generatedAt)}</span>}
      </div>

      {snapshot.note && <p className="mb-3 text-xs text-gray-500">{snapshot.note}</p>}

      {rules.length === 0 && commissionRules.length === 0 && !snapshot.note && (
        <p className="text-xs text-gray-400">記録されたルールはありません</p>
      )}

      {rules.length > 0 && (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full min-w-max text-xs">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-1 pr-3 font-medium">スタッフ</th>
                <th className="py-1 pr-3 font-medium">給与形態</th>
                <th className="py-1 pr-3 text-right font-medium">基本額</th>
                <th className="py-1 pr-3 text-right font-medium">残業倍率</th>
                <th className="py-1 pr-3 text-right font-medium">深夜加算</th>
                <th className="py-1 pr-3 text-right font-medium">休日倍率</th>
                <th className="py-1 pr-3 text-right font-medium">交通費</th>
                <th className="py-1 pr-3 font-medium">適用期間</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/10">
              {rules.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-3 font-medium text-navy">{profileNameById.get(r.profileId) ?? r.profileId.slice(0, 8)}</td>
                  <td className="py-1.5 pr-3">{PAY_TYPE_LABEL[r.payType] ?? r.payType}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{yen(r.baseAmount)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.overtimeRate}倍</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">+{r.nightRate}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.holidayRate}倍</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{yen(r.commuteAllowance)}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {formatDate(r.effectiveFrom)} 〜 {r.effectiveTo ? formatDate(r.effectiveTo) : '無期限'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {commissionRules.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-xs">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-1 pr-3 font-medium">ルール名</th>
                <th className="py-1 pr-3 font-medium">対象</th>
                <th className="py-1 pr-3 font-medium">計算方法</th>
                <th className="py-1 pr-3 text-right font-medium">料率／固定額</th>
                <th className="py-1 pr-3 font-medium">適用期間</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/10">
              {commissionRules.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-3 font-medium text-navy">{r.name}</td>
                  <td className="py-1.5 pr-3">{r.profileId ? profileNameById.get(r.profileId) ?? r.profileId.slice(0, 8) : '全スタッフ'}</td>
                  <td className="py-1.5 pr-3">{METHOD_LABEL[r.method] ?? r.method}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {r.method === 'rate' && r.rate != null ? `${r.rate}%` : r.method === 'fixed' && r.fixedAmount != null ? yen(r.fixedAmount) : '段階別'}
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {formatDate(r.effectiveFrom)} 〜 {r.effectiveTo ? formatDate(r.effectiveTo) : '無期限'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
