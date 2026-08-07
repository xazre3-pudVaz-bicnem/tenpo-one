'use client';

import { useEffect, useState, useTransition } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { assignTables, getOccupiedTableIds } from '@/app/app/reservations/actions';
import { suggestTables, type TableLike } from '@/lib/reservations';

export interface AssignableTable {
  id: string;
  name: string;
  capacityMin: number;
  capacityMax: number;
}

interface AssignTableDialogProps {
  reservationId: string;
  storeId: string;
  partySize: number;
  startAt: string;
  endAt: string;
  currentTableIds: string[];
  tables: AssignableTable[];
  triggerLabel?: string;
  triggerVariant?: NonNullable<ButtonProps['variant']>;
  disabled?: boolean;
}

/**
 * テーブル割当・席移動ダイアログ。
 * 開くたびに同時間帯の割当済みテーブルを取得し、suggestTables（lib/reservations.ts）で自動候補を提示する。
 * 複数選択・テーブル結合に対応し、確定時は reservation_tables を全置換する。
 */
export function AssignTableDialog({
  reservationId,
  storeId,
  partySize,
  startAt,
  endAt,
  currentTableIds,
  tables,
  triggerLabel,
  triggerVariant = 'secondary',
  disabled,
}: AssignTableDialogProps) {
  const [open, setOpen] = useState(false);
  const [openKey, setOpenKey] = useState(0);

  return (
    <>
      <Button
        size="sm"
        variant={triggerVariant}
        disabled={disabled}
        onClick={() => {
          setOpenKey((k) => k + 1);
          setOpen(true);
        }}
        className="h-7 px-2 text-xs"
      >
        {triggerLabel ?? (currentTableIds.length > 0 ? '席移動' : 'テーブル割当')}
      </Button>
      {open && (
        <AssignTableDialogContent
          key={openKey}
          reservationId={reservationId}
          storeId={storeId}
          partySize={partySize}
          startAt={startAt}
          endAt={endAt}
          currentTableIds={currentTableIds}
          tables={tables}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AssignTableDialogContent({
  reservationId,
  storeId,
  partySize,
  startAt,
  endAt,
  currentTableIds,
  tables,
  onClose,
}: Omit<AssignTableDialogProps, 'triggerLabel' | 'triggerVariant' | 'disabled'> & { onClose: () => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [occupiedIds, setOccupiedIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>(currentTableIds);

  useEffect(() => {
    let cancelled = false;
    getOccupiedTableIds(storeId, startAt, endAt, reservationId)
      .then((ids) => {
        if (!cancelled) setOccupiedIds(ids);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, startAt, endAt, reservationId]);

  const tableLikes: TableLike[] = tables.map((t) => ({
    id: t.id,
    name: t.name,
    capacityMin: t.capacityMin,
    capacityMax: t.capacityMax,
    isActive: true,
    isOccupied: occupiedIds.includes(t.id) && !currentTableIds.includes(t.id),
  }));
  const suggestions = suggestTables(tableLikes, partySize);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = () => {
    startTransition(async () => {
      try {
        await assignTables(reservationId, selected);
        toast(selected.length > 0 ? 'テーブルを割り当てました' : '割当を解除しました');
        onClose();
      } catch (e) {
        toast(e instanceof Error ? e.message : '割当に失敗しました', 'error');
      }
    });
  };

  const totalCapacity = tables.filter((t) => selected.includes(t.id)).reduce((sum, t) => sum + t.capacityMax, 0);

  return (
    <Dialog open onClose={onClose} title="テーブル割当">
      <p className="mb-3 text-xs text-gray-500">
        人数 {partySize}名｜選択中 {selected.length > 0 ? `${totalCapacity}席相当（${selected.length}卓）` : 'なし'}
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {suggestions.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-primary-deep">
                <Sparkles className="h-3.5 w-3.5" />
                おすすめ
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s.tableIds.join('-')}
                    type="button"
                    onClick={() => setSelected(s.tableIds)}
                    className="rounded-lg border border-primary-soft bg-primary-soft/40 px-3 py-1.5 text-xs font-medium text-primary-deep hover:bg-primary-soft"
                  >
                    {s.combined ? `結合: ${s.label}` : `おすすめ: ${s.label}`}（{s.totalCapacity}席）
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
            {tables.length === 0 && <p className="px-2 py-4 text-center text-sm text-gray-400">テーブルが登録されていません</p>}
            {tables.map((t) => {
              const occupied = occupiedIds.includes(t.id) && !currentTableIds.includes(t.id);
              return (
                <label
                  key={t.id}
                  className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm ${
                    occupied ? 'cursor-not-allowed text-gray-300' : 'cursor-pointer hover:bg-gray-50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(t.id)}
                      disabled={occupied}
                      onChange={() => toggle(t.id)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    {t.name}
                    <span className="text-xs text-gray-400">
                      {t.capacityMin}-{t.capacityMax}名
                    </span>
                  </span>
                  {occupied && <Badge tone="gray">割当済み</Badge>}
                </label>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          閉じる
        </Button>
        <Button onClick={submit} disabled={pending || loading}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          割り当てる
        </Button>
      </div>
    </Dialog>
  );
}
