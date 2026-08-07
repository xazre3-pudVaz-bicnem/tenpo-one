'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, Lock } from 'lucide-react';
import { useStoreRealtimeRefresh } from '@/components/realtime/use-store-refresh';
import { TableSheet } from './table-sheet';

export interface ReservationChip {
  time: string;
  guestName: string;
  partySize: number;
}

export interface FloorTable {
  id: string;
  floor_id: string | null;
  name: string;
  capacity_min: number;
  capacity_max: number;
  is_private_room: boolean;
  is_counter: boolean;
  current_status: string;
}

export interface FloorRow {
  id: string;
  name: string;
  sort_order: number;
}

const STATUS_STYLES: Record<string, string> = {
  available: 'border-gray-200 bg-white text-navy',
  reserved: 'border-2 border-primary bg-white text-navy',
  waiting: 'border-2 border-primary/60 bg-primary-soft text-primary-deep',
  seated: 'border-success bg-success-soft text-success',
  ordering: 'border-success bg-success-soft text-success',
  billing: 'border-warning bg-warning-soft text-warning',
  cleaning: 'border-slate-400 bg-slate-100 text-slate-600',
  unavailable: 'border-gray-300 bg-gray-100 text-gray-400',
};

const STATUS_LABELS: Record<string, string> = {
  available: '空席',
  reserved: '予約あり',
  waiting: 'キャンセル待ち',
  seated: '着席中',
  ordering: '注文中',
  billing: '会計中',
  cleaning: '清掃中',
  unavailable: '利用停止',
};

export function FloorBoard({
  storeId,
  floors,
  tables,
  reservationByTable,
  canOperate,
  startWalkInAction,
  goToOrderAction,
  completeCleaningAction,
  setTableAvailabilityAction,
}: {
  storeId: string;
  floors: FloorRow[];
  tables: FloorTable[];
  reservationByTable: Record<string, ReservationChip>;
  canOperate: boolean;
  startWalkInAction: (tableId: string, partySize: number) => Promise<{ orderId: string }>;
  goToOrderAction: (tableId: string) => Promise<{ orderId: string }>;
  completeCleaningAction: (tableId: string) => Promise<void>;
  setTableAvailabilityAction: (tableId: string, unavailable: boolean) => Promise<void>;
}) {
  const [selected, setSelected] = useState<FloorTable | null>(null);

  // テーブル状態（着席・清掃中など）と、テーブルに紐づく注文の変化をRealtimeで検知して画面を更新する。
  useStoreRealtimeRefresh({ storeId, tables: ['restaurant_tables', 'orders'] });

  const grouped = floors.length > 0
    ? floors.map((f) => ({ floor: f, tables: tables.filter((t) => t.floor_id === f.id) }))
    : [{ floor: { id: '_', name: 'テーブル', sort_order: 0 }, tables }];
  const unassigned = tables.filter((t) => !floors.some((f) => f.id === t.floor_id));

  return (
    <div className="space-y-6">
      {/* 凡例 */}
      <div className="flex flex-wrap gap-3 text-xs text-gray-600">
        {Object.entries(STATUS_LABELS)
          .filter(([k]) => ['available', 'reserved', 'seated', 'billing', 'cleaning', 'unavailable'].includes(k))
          .map(([k, label]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={cn('h-3 w-3 rounded border', STATUS_STYLES[k])} />
              {label}
            </span>
          ))}
      </div>

      {grouped.map(({ floor, tables: floorTables }) => (
        <Card key={floor.id} className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-navy">{floor.name}</h2>
          {floorTables.length === 0 ? (
            <p className="text-xs text-gray-400">このフロアにテーブルはありません</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {floorTables.map((t) => {
                const chip = reservationByTable[t.id];
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelected(t)}
                    className={cn(
                      'flex min-h-[92px] flex-col items-start justify-between rounded-xl border p-3 text-left shadow-sm transition-transform active:scale-[0.97]',
                      STATUS_STYLES[t.current_status] ?? STATUS_STYLES.available
                    )}
                  >
                    <div className="flex w-full items-start justify-between gap-1">
                      <span className="text-sm font-bold">{t.name}</span>
                      {t.current_status === 'unavailable' && <Lock className="h-3.5 w-3.5 shrink-0" />}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] opacity-80">
                      <Users className="h-3 w-3" />
                      {t.capacity_min}〜{t.capacity_max}名
                      {t.is_private_room && '・個室'}
                      {t.is_counter && '・カウンター'}
                    </div>
                    <div className="flex w-full items-center justify-between gap-1">
                      <Badge tone="gray" className="bg-white/70 text-[10px]">
                        {STATUS_LABELS[t.current_status] ?? t.current_status}
                      </Badge>
                      {chip && (
                        <span className="truncate text-[10px] font-medium">
                          {chip.time} {chip.guestName}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      ))}

      {floors.length > 0 && unassigned.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-navy">未分類</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {unassigned.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelected(t)}
                className={cn(
                  'flex min-h-[92px] flex-col items-start justify-between rounded-xl border p-3 text-left shadow-sm',
                  STATUS_STYLES[t.current_status] ?? STATUS_STYLES.available
                )}
              >
                <span className="text-sm font-bold">{t.name}</span>
                <Badge tone="gray" className="bg-white/70 text-[10px]">
                  {STATUS_LABELS[t.current_status] ?? t.current_status}
                </Badge>
              </button>
            ))}
          </div>
        </Card>
      )}

      <TableSheet
        table={selected}
        reservation={selected ? reservationByTable[selected.id] : undefined}
        canOperate={canOperate}
        onClose={() => setSelected(null)}
        startWalkInAction={startWalkInAction}
        goToOrderAction={goToOrderAction}
        completeCleaningAction={completeCleaningAction}
        setTableAvailabilityAction={setTableAvailabilityAction}
      />
    </div>
  );
}
