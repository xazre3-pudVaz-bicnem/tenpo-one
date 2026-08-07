'use client';

import { STATION_LABELS, type AggregatedKdsItem, type Station } from './types';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';

/**
 * 品目集約表示。「唐揚げ ×5」のように、未提供品目を station×品目名×オプションでまとめて
 * 表示する（仕込み・調理の全体量を把握しやすくする用途）。個別の状態進行は注文カード表示で行う。
 */
export function AggregateBoard({ rows }: { rows: AggregatedKdsItem[] }) {
  if (rows.length === 0) {
    return <EmptyState title="現在調理待ちの品目はありません" description="新しい注文が入るとここに表示されます" />;
  }

  const byStation = new Map<Station, AggregatedKdsItem[]>();
  for (const row of rows) {
    const list = byStation.get(row.station) ?? [];
    list.push(row);
    byStation.set(row.station, list);
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {[...byStation.entries()].map(([station, items]) => (
        <div key={station} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-bold text-navy">{STATION_LABELS[station]}</p>
          <ul className="space-y-2">
            {items.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2">
                <div className="min-w-0">
                  <p className="text-base font-bold text-navy">
                    {row.name} <span className="tabular-nums">× {row.quantity}</span>
                  </p>
                  {row.modifiers.length > 0 && (
                    <p className="text-xs text-gray-500">{row.modifiers.map((m) => m.name).join('、')}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  {row.pendingCount > 0 && <Badge tone="gray">未着手{row.pendingCount}</Badge>}
                  {row.preparingCount > 0 && <Badge tone="warning">調理中{row.preparingCount}</Badge>}
                  {row.readyCount > 0 && <Badge tone="success">完成{row.readyCount}</Badge>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
