'use client';

import { useState, useTransition } from 'react';
import { Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { updateCategoryBillOnOrder, updateCategoryStation } from './actions';

const STATION_OPTIONS = [
  { value: 'kitchen', label: 'キッチン' },
  { value: 'drink', label: 'ドリンク' },
  { value: 'dessert', label: 'デザート' },
  { value: 'grill', label: '焼き場' },
] as const;

export interface StationCategoryRow {
  id: string;
  name: string;
  station: string;
  /** 注文時に会計伝票を印刷（DB に列が無いときは null＝出さない） */
  printBillOnOrder?: boolean | null;
}

/**
 * カテゴリごとのKDS振り分け先（station）設定パネル。
 * /app/kitchen（KDS）はこのカテゴリのstationで注文品目をキッチン/ドリンク/デザートへ振り分ける。
 * menu_item_id が紐付かない品目は常に「キッチン」扱い（KDS側で処理）。
 */
export function StationPanel({ categories }: { categories: StationCategoryRow[] }) {
  const [rows, setRows] = useState(categories);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleChange = (id: string, station: string) => {
    const prev = rows;
    setRows((r) => r.map((c) => (c.id === id ? { ...c, station } : c)));
    startTransition(async () => {
      const result = await updateCategoryStation(id, station);
      if (result.error) {
        setRows(prev);
        toast(result.error, 'error');
        return;
      }
      toast('ステーションを更新しました');
    });
  };

  const handleBill = (id: string, on: boolean) => {
    const prev = rows;
    setRows((r) => r.map((c) => (c.id === id ? { ...c, printBillOnOrder: on } : c)));
    startTransition(async () => {
      const result = await updateCategoryBillOnOrder(id, on);
      if (result.error) {
        setRows(prev);
        toast(result.error, 'error');
        return;
      }
      toast(on ? '注文時に会計伝票を印刷します' : '注文時の会計伝票を止めました');
    });
  };

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">カテゴリが登録されていません</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-navy">KDSステーション振り分け</p>
      <p className="text-xs text-gray-500">
        カテゴリごとにキッチン画面（KDS）のタブと、厨房伝票を出すプリンター（キッチン機／ドリンク機など）の振り分け先を設定します
      </p>
      <ul className="space-y-1.5">
        {rows.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{c.name}</span>
            {/* 注文時に会計伝票を印刷（2026-10-23）。ON のカテゴリの商品を厨房へ送ると、レジにも会計伝票が1枚出る */}
            {c.printBillOnOrder != null && (
              <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-gray-500">
                注文時に会計伝票を印刷
                <button
                  type="button"
                  role="switch"
                  aria-checked={c.printBillOnOrder}
                  aria-label={`${c.name}：注文時に会計伝票を印刷`}
                  disabled={pending}
                  onClick={() => handleBill(c.id, !c.printBillOnOrder)}
                  className={cn('relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50', c.printBillOnOrder ? 'bg-iris' : 'bg-gray-300')}
                >
                  <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', c.printBillOnOrder ? 'left-[18px]' : 'left-0.5')} />
                </button>
              </span>
            )}
            <Select
              className="w-32 shrink-0"
              value={c.station}
              disabled={pending}
              onChange={(e) => handleChange(c.id, e.target.value)}
            >
              {STATION_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
    </div>
  );
}
