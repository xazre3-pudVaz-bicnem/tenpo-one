/**
 * 原価差異分析カード（v0.4.2 RPT-C3）。
 * 理論原価（販売数量×レシピ×平均仕入単価）と実原価（理論原価＋廃棄＋棚卸差異等の実在庫変動）を並記し、
 * 差異の内訳（廃棄・棚卸差異・その他）へドリルダウンできるようにする。
 * 計算は lib/metrics.ts の computeCostVariance に統一（画面側で独自の式を書かない）。
 */
import Link from 'next/link';
import { yen } from '@/lib/format';
import type { CostVariance } from '@/lib/metrics';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function CostVarianceCard({ variance, salesTotal }: { variance: CostVariance; salesTotal: number }) {
  const actualCostRatePct = salesTotal > 0 ? (variance.actualCost / salesTotal) * 100 : 0;
  const varianceTone = variance.variance > 0 ? 'danger' : variance.variance < 0 ? 'success' : 'gray';

  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle>原価差異分析（理論原価 vs 実原価）</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-gray-500">
          理論原価は販売数量×レシピ×平均仕入単価で算出した「本来かかったはずの原価」、実原価は理論原価に廃棄・棚卸差異など実際の在庫減少を加えた「実際に消えた在庫価値」です。
          P/Lカスケード・原価率のKPIは理論原価を使用しており、実際の在庫ロスを含めた原価水準はこちらで確認してください。
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs font-medium text-gray-500">理論原価</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-navy">{yen(variance.theoreticalCost)}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs font-medium text-gray-500">実原価</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-navy">{yen(variance.actualCost)}</p>
            <p className="mt-0.5 text-[11px] text-gray-400">対純売上 {actualCostRatePct.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs font-medium text-gray-500">差異（実原価−理論原価）</p>
            <p className={`mt-1 text-xl font-bold tabular-nums ${variance.variance > 0 ? 'text-danger' : variance.variance < 0 ? 'text-success' : 'text-navy'}`}>
              {variance.variance > 0 ? '+' : ''}
              {yen(variance.variance)}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs font-medium text-gray-500">差異率</p>
            <p className="mt-1 flex items-center gap-1.5 text-xl font-bold tabular-nums text-navy">
              {variance.varianceRate.toFixed(1)}%
              <Badge tone={varianceTone}>{variance.variance > 0 ? 'ロス超過' : variance.variance < 0 ? '理論より良好' : '差異なし'}</Badge>
            </p>
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-gray-500">差異の内訳</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Link
              href="/app/inventory"
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-primary/40 hover:bg-primary-soft/30"
            >
              <span className="text-sm text-gray-600">廃棄</span>
              <span className="tabular-nums font-semibold text-navy">{yen(variance.breakdown.waste)}</span>
            </Link>
            <Link
              href="/app/inventory?tab=counts"
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-primary/40 hover:bg-primary-soft/30"
            >
              <span className="text-sm text-gray-600">棚卸差異</span>
              <span className={`tabular-nums font-semibold ${variance.breakdown.countAdjustment > 0 ? 'text-danger' : variance.breakdown.countAdjustment < 0 ? 'text-success' : 'text-navy'}`}>
                {variance.breakdown.countAdjustment > 0 ? '+' : ''}
                {yen(variance.breakdown.countAdjustment)}
              </span>
            </Link>
            <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
              <span className="text-sm text-gray-600">その他</span>
              <span className="tabular-nums font-semibold text-navy">{yen(variance.breakdown.other)}</span>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            棚卸差異は「実棚卸数−期待在庫数」がマイナス（実数不足）の場合を費用（プラス表示）、プラス（実数超過）の場合を差異縮小（マイナス表示）として計上しています。単価未設定の品目は集計から除外しています。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
