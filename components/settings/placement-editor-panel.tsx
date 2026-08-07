'use client';

import { useMemo, useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { saveTablePlacement, saveTableShape, type TableShape } from '@/app/app/settings/tables/actions';
import type { FloorRow } from './floors-panel';

export interface PlacementTableRow {
  id: string;
  name: string;
  floorId: string | null;
  capacityMin: number;
  capacityMax: number;
  posX: number | null;
  posY: number | null;
  shape: TableShape;
}

const GRID_COLS = 8;
const GRID_ROWS = 6;

const SHAPE_LABEL: Record<TableShape, string> = { square: '四角', round: '丸', counter: 'カウンター' };
const SHAPE_CLASS: Record<TableShape, string> = {
  square: 'rounded-lg',
  round: 'rounded-full',
  counter: 'rounded-md',
};

/**
 * フロアマップ配置エディタ。フロアごとに8×6グリッドを表示し、
 * 左のテーブル一覧から選択→グリッドをクリックで配置、配置済みマスを再クリックで解除する。
 */
export function PlacementEditorPanel({
  storeId,
  floors,
  tables,
}: {
  storeId: string;
  floors: FloorRow[];
  tables: PlacementTableRow[];
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const hasUnassigned = tables.some((t) => t.floorId == null);
  const tabs = useMemo(
    () =>
      floors.length > 0
        ? hasUnassigned
          ? [...floors, { id: '_none', name: '未割当' }]
          : floors
        : [{ id: '_all', name: 'テーブル' }],
    [floors, hasUnassigned]
  );

  const [selectedFloorTab, setSelectedFloorTab] = useState(tabs[0]?.id ?? '_all');
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  const floorTables = useMemo(() => {
    if (selectedFloorTab === '_all') return tables;
    if (selectedFloorTab === '_none') return tables.filter((t) => t.floorId == null);
    return tables.filter((t) => t.floorId === selectedFloorTab);
  }, [tables, selectedFloorTab]);

  const selectedTable = floorTables.find((t) => t.id === selectedTableId) ?? null;

  const place = (tableId: string, posX: number | null, posY: number | null) => {
    startTransition(async () => {
      const result = await saveTablePlacement(tableId, storeId, posX, posY);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast(posX == null ? '配置を解除しました' : '配置を保存しました');
    });
  };

  const changeShape = (tableId: string, shape: TableShape) => {
    startTransition(async () => {
      const result = await saveTableShape(tableId, storeId, shape);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast('形状を保存しました');
    });
  };

  const handleCellClick = (x: number, y: number) => {
    const occupant = floorTables.find((t) => t.posX === x && t.posY === y);
    if (occupant) {
      if (selectedTableId === occupant.id) {
        place(occupant.id, null, null);
      } else {
        setSelectedTableId(occupant.id);
      }
      return;
    }
    if (!selectedTableId) {
      toast('先にテーブルを選択してください', 'error');
      return;
    }
    place(selectedTableId, x, y);
  };

  if (tables.length === 0) {
    return <p className="text-sm text-gray-500">配置するテーブルがありません。先にテーブルを追加してください。</p>;
  }

  return (
    <div className="space-y-4">
      {tabs.length > 1 && (
        <div className="flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setSelectedFloorTab(tab.id);
                setSelectedTableId(null);
              }}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                selectedFloorTab === tab.id ? 'bg-navy text-white' : 'text-gray-600 hover:bg-gray-100'
              )}
            >
              {tab.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <div className="overflow-x-auto">
          <div
            className="grid min-w-[36rem] gap-1.5 rounded-xl border border-gray-200 bg-gray-50 p-2"
            style={{
              gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${GRID_ROWS}, 3.75rem)`,
            }}
          >
            {Array.from({ length: GRID_ROWS }).map((_, y) =>
              Array.from({ length: GRID_COLS }).map((_, x) => {
                const occupant = floorTables.find((t) => t.posX === x && t.posY === y);
                const isSelected = !!occupant && occupant.id === selectedTableId;
                return (
                  <button
                    key={`${x}-${y}`}
                    type="button"
                    disabled={pending}
                    onClick={() => handleCellClick(x, y)}
                    className={cn(
                      'flex items-center justify-center border p-1 text-center text-[11px] font-medium leading-tight transition-colors',
                      occupant
                        ? isSelected
                          ? 'border-primary bg-primary text-white'
                          : 'border-primary-soft bg-primary-soft/60 text-primary-deep hover:bg-primary-soft'
                        : 'border-dashed border-gray-300 bg-white text-gray-300 hover:border-primary/40 hover:text-primary/60',
                      occupant ? SHAPE_CLASS[occupant.shape] : 'rounded-lg'
                    )}
                  >
                    {occupant ? occupant.name : ''}
                  </button>
                );
              })
            )}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            テーブルを選択してからマスをクリックすると配置されます。配置済みのマスをもう一度クリックすると解除します。
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500">このフロアのテーブル</p>
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {floorTables.length === 0 && <li className="text-xs text-gray-400">テーブルがありません</li>}
            {floorTables.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedTableId((cur) => (cur === t.id ? null : t.id))}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs',
                    selectedTableId === t.id ? 'border-primary bg-primary-soft/50' : 'border-gray-200 hover:bg-gray-50'
                  )}
                >
                  <span className="font-medium text-navy">{t.name}</span>
                  {t.posX != null && t.posY != null ? (
                    <Badge tone="primary">配置済み</Badge>
                  ) : (
                    <Badge tone="gray">未配置</Badge>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {selectedTable && (
            <div className="rounded-lg border border-gray-200 p-2.5">
              <p className="mb-1 text-xs font-semibold text-navy">{selectedTable.name} の形状</p>
              <Select
                value={selectedTable.shape}
                onChange={(e) => changeShape(selectedTable.id, e.target.value as TableShape)}
                className="h-9"
              >
                {(Object.keys(SHAPE_LABEL) as TableShape[]).map((s) => (
                  <option key={s} value={s}>
                    {SHAPE_LABEL[s]}
                  </option>
                ))}
              </Select>
              {selectedTable.posX != null && selectedTable.posY != null && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2 w-full"
                  disabled={pending}
                  onClick={() => place(selectedTable.id, null, null)}
                >
                  配置を解除する
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
