import Link from 'next/link';
import { yen, formatDate } from '@/lib/format';
import type { RfmScore } from '@/lib/crm';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { rfmRankTone } from '@/components/customers/segment-badges';
import { cn } from '@/lib/utils';

export interface RfmCustomerRow {
  id: string;
  name: string;
  phone: string | null;
  visitCount: number;
  totalSpent: number;
  lastVisitAt: string | null;
  rfm: RfmScore;
}

/** M（累計利用額）の平均に応じた5段階のセル配色（primaryの単色ランプ、薄→濃） */
const HEAT_STEPS = ['#ede4fc', '#d1c2f5', '#b098ec', '#8e6fe4', '#714bdc', '#5a2ed6'];
const RANKS: RfmScore['rank'][] = ['S', 'A', 'B', 'C', 'D'];

function heatStyle(avgMonetary: number, maxAvg: number): { bg: string; text: string } {
  if (avgMonetary <= 0 || maxAvg <= 0) return { bg: '#f9fafb', text: '#9ca3af' };
  const ratio = Math.min(1, avgMonetary / maxAvg);
  const idx = Math.max(1, Math.min(HEAT_STEPS.length - 1, Math.ceil(ratio * (HEAT_STEPS.length - 1))));
  return { bg: HEAT_STEPS[idx], text: idx >= 4 ? '#ffffff' : '#0f1120' };
}

export function RfmView({
  customers,
  basePath,
  selected,
}: {
  customers: RfmCustomerRow[];
  basePath: string;
  selected: { r: number; f: number } | null;
}) {
  if (customers.length === 0) {
    return <EmptyState title="分析対象の顧客がいません" description="来店実績のある顧客が登録されるとRFM分析が表示されます" />;
  }

  // 5(R) x 5(F) マトリクス集計
  const matrix: { count: number; totalMonetary: number }[][] = Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => ({ count: 0, totalMonetary: 0 }))
  );
  for (const c of customers) {
    const cell = matrix[c.rfm.recency - 1][c.rfm.frequency - 1];
    cell.count += 1;
    cell.totalMonetary += c.totalSpent;
  }
  const avgMatrix = matrix.map((row) => row.map((cell) => (cell.count > 0 ? cell.totalMonetary / cell.count : 0)));
  const maxAvg = Math.max(0, ...avgMatrix.flat());

  // ランク別サマリー
  const totalSales = customers.reduce((a, c) => a + c.totalSpent, 0);
  const rankSummary = RANKS.map((rank) => {
    const rows = customers.filter((c) => c.rfm.rank === rank);
    const sales = rows.reduce((a, c) => a + c.totalSpent, 0);
    return { rank, count: rows.length, sales, share: totalSales > 0 ? (sales / totalSales) * 100 : 0 };
  });

  const cellHref = (r: number, f: number) => {
    const isSame = selected?.r === r && selected?.f === f;
    return isSame ? `${basePath}?view=rfm` : `${basePath}?view=rfm&r=${r}&f=${f}`;
  };

  const selectedCustomers =
    selected != null
      ? customers
          .filter((c) => c.rfm.recency === selected.r && c.rfm.frequency === selected.f)
          .sort((a, b) => b.totalSpent - a.totalSpent)
      : [];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>ランク別サマリー（S〜D）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TableWrap className="border-0">
            <Table>
              <THead>
                <Tr>
                  <Th>ランク</Th>
                  <Th className="text-right">人数</Th>
                  <Th className="text-right">累計売上</Th>
                  <Th className="text-right">売上構成比</Th>
                </Tr>
              </THead>
              <TBody>
                {rankSummary.map((r) => (
                  <Tr key={r.rank}>
                    <Td>
                      <Badge tone={rfmRankTone(r.rank)}>{r.rank}</Badge>
                    </Td>
                    <Td className="text-right tabular-nums">{r.count.toLocaleString('ja-JP')}人</Td>
                    <Td className="text-right tabular-nums">{yen(r.sales)}</Td>
                    <Td className="text-right tabular-nums">{r.share.toFixed(1)}%</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>R × F マトリクス（セルをクリックで顧客リストを表示）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="grid min-w-[560px] grid-cols-[80px_repeat(5,1fr)] gap-1">
              <div />
              {[1, 2, 3, 4, 5].map((f) => (
                <div key={f} className="pb-1 text-center text-xs font-medium text-gray-500">
                  F{f}
                </div>
              ))}
              {[5, 4, 3, 2, 1].map((r) => (
                <FragmentRow key={r} r={r}>
                  {[1, 2, 3, 4, 5].map((f) => {
                    const cell = matrix[r - 1][f - 1];
                    const style = heatStyle(avgMatrix[r - 1][f - 1], maxAvg);
                    const isSelected = selected?.r === r && selected?.f === f;
                    return (
                      <Link
                        key={f}
                        href={cellHref(r, f)}
                        className={cn(
                          'flex flex-col items-center justify-center rounded-lg py-3 text-center transition-transform hover:scale-[1.03]',
                          isSelected && 'ring-2 ring-primary ring-offset-1'
                        )}
                        style={{ backgroundColor: style.bg, color: style.text }}
                        title={`R${r} F${f}｜${cell.count}人｜平均利用額 ${yen(Math.round(avgMatrix[r - 1][f - 1]))}`}
                      >
                        <span className="text-sm font-bold tabular-nums">{cell.count}</span>
                        <span className="text-[10px] opacity-80">
                          {cell.count > 0 ? yen(Math.round(avgMatrix[r - 1][f - 1])) : '—'}
                        </span>
                      </Link>
                    );
                  })}
                </FragmentRow>
              ))}
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            縦軸: R（最終来店の新しさ・上ほど直近）／横軸: F（来店頻度）／セル内上段は人数、下段は平均累計利用額（M）です。
          </p>
          <p className="mt-1 text-xs text-gray-400">
            R・F・Mの区分としきい値は lib/crm.ts（calcRfm の固定しきい値、セグメント分類は SEGMENT_THRESHOLDS）で定義された固定値です。本画面から変更はできません。
          </p>
        </CardContent>
      </Card>

      {selected != null && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>
              R{selected.r} × F{selected.f} の顧客（{selectedCustomers.length}人）
            </CardTitle>
            <Link href={`${basePath}?view=rfm`} className="text-xs font-medium text-primary hover:underline">
              絞込を解除
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {selectedCustomers.length === 0 ? (
              <div className="p-5">
                <EmptyState title="該当する顧客がいません" className="border-0 py-8" />
              </div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto">
                <TableWrap className="border-0">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>名前</Th>
                        <Th>電話</Th>
                        <Th>RFMランク</Th>
                        <Th className="text-right">来店回数</Th>
                        <Th className="text-right">累計利用額</Th>
                        <Th>最終来店</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {selectedCustomers.map((c) => (
                        <Tr key={c.id}>
                          <Td>
                            <Link href={`/app/customers/${c.id}`} className="font-medium text-navy hover:text-primary hover:underline">
                              {c.name}
                            </Link>
                          </Td>
                          <Td className="text-gray-600">{c.phone || '—'}</Td>
                          <Td>
                            <Badge tone={rfmRankTone(c.rfm.rank)}>{c.rfm.rank}</Badge>
                          </Td>
                          <Td className="text-right tabular-nums">{c.visitCount}回</Td>
                          <Td className="text-right tabular-nums">{yen(c.totalSpent)}</Td>
                          <Td className="text-gray-600">{c.lastVisitAt ? formatDate(c.lastVisitAt) : '—'}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** CSS Gridの行を構成するための素通しラッパー（行見出し + 5セル） */
function FragmentRow({ r, children }: { r: number; children: React.ReactNode }) {
  return (
    <>
      <div className="flex items-center justify-end pr-2 text-xs font-medium text-gray-500">R{r}</div>
      {children}
    </>
  );
}
