'use client';

import { useState, useTransition } from 'react';
import { Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { updateCategoryStation } from './actions';

const STATION_OPTIONS = [
  { value: 'kitchen', label: 'キッチン' },
  { value: 'drink', label: 'ドリンク' },
  { value: 'dessert', label: 'デザート' },
] as const;

export interface StationCategoryRow {
  id: string;
  name: string;
  station: string;
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

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">カテゴリが登録されていません</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-navy">KDSステーション振り分け</p>
      <p className="text-xs text-gray-500">
        カテゴリごとにキッチン画面（KDS）でのタブ振り分け先を設定します
      </p>
      <ul className="space-y-1.5">
        {rows.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2">
            <span className="min-w-0 truncate text-sm text-gray-700">{c.name}</span>
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
