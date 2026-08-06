'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { upsertShift, deleteShift, requestShift, type ShiftKind } from './actions';

export interface ShiftLite {
  id: string;
  startTime: string; // 'HH:MM:SS'
  endTime: string;
  kind: ShiftKind;
  status: string;
}

export interface StaffRow {
  id: string;
  name: string;
}

const KIND_LABEL: Record<ShiftKind, string> = { planned: '仮', requested: '希望', confirmed: '確定' };

function kindClass(kind: ShiftKind) {
  if (kind === 'confirmed') return 'bg-success-soft text-success border border-success/30';
  if (kind === 'requested') return 'bg-warning-soft text-warning border border-warning/30';
  return 'bg-white text-primary-deep border-2 border-primary/50';
}

function hhmm(t: string) {
  return t.slice(0, 5);
}

export function ShiftGrid({
  storeId,
  weekDates,
  staff,
  shiftsByKey,
  canManage,
  selfId,
}: {
  storeId: string;
  weekDates: { date: string; label: string }[];
  staff: StaffRow[];
  shiftsByKey: Record<string, ShiftLite[]>;
  canManage: boolean;
  selfId: string;
}) {
  const [cell, setCell] = useState<{ profileId: string; profileName: string; date: string; shift: ShiftLite | null; mode: 'manage' | 'request' } | null>(null);

  const openCell = (profileId: string, profileName: string, date: string, shifts: ShiftLite[]) => {
    if (canManage) {
      setCell({ profileId, profileName, date, shift: shifts[0] ?? null, mode: 'manage' });
      return;
    }
    if (profileId !== selfId) return;
    const own = shifts.find((s) => s.kind === 'requested') ?? null;
    if (shifts.length > 0 && !own) return; // 確定済み等は編集不可
    setCell({ profileId, profileName, date, shift: own, mode: 'request' });
  };

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-600">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 font-medium">スタッフ</th>
              {weekDates.map((d) => (
                <th key={d.date} className="px-3 py-3 text-center font-medium whitespace-nowrap">
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {staff.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="sticky left-0 z-10 bg-white px-4 py-2 font-medium whitespace-nowrap text-navy">
                  {s.name}
                </td>
                {weekDates.map((d) => {
                  const key = `${s.id}_${d.date}`;
                  const shifts = shiftsByKey[key] ?? [];
                  const primary = shifts[0];
                  const clickable = canManage || s.id === selfId;
                  return (
                    <td key={d.date} className="px-2 py-2 text-center align-top">
                      <button
                        type="button"
                        disabled={!clickable}
                        onClick={() => openCell(s.id, s.name, d.date, shifts)}
                        className={cn(
                          'flex min-h-14 w-24 flex-col items-center justify-center rounded-lg px-1 py-1 text-xs transition-colors',
                          clickable ? 'hover:opacity-80' : 'cursor-default',
                          primary ? kindClass(primary.kind) : 'border border-dashed border-gray-300 text-gray-300'
                        )}
                      >
                        {primary ? (
                          <>
                            <span className="font-semibold">
                              {hhmm(primary.startTime)}–{hhmm(primary.endTime)}
                            </span>
                            <span>{KIND_LABEL[primary.kind]}</span>
                            {shifts.length > 1 && <span>+{shifts.length - 1}</span>}
                          </>
                        ) : clickable ? (
                          <Plus className="h-4 w-4" />
                        ) : (
                          '—'
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cell && (
        <CellDialog storeId={storeId} cell={cell} onClose={() => setCell(null)} />
      )}
    </>
  );
}

function CellDialog({
  storeId,
  cell,
  onClose,
}: {
  storeId: string;
  cell: { profileId: string; profileName: string; date: string; shift: ShiftLite | null; mode: 'manage' | 'request' };
  onClose: () => void;
}) {
  const [start, setStart] = useState(cell.shift ? hhmm(cell.shift.startTime) : '09:00');
  const [end, setEnd] = useState(cell.shift ? hhmm(cell.shift.endTime) : '17:00');
  const [kind, setKind] = useState<ShiftKind>(cell.shift?.kind ?? 'planned');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result =
        cell.mode === 'manage'
          ? await upsertShift({
              id: cell.shift?.id,
              storeId,
              profileId: cell.profileId,
              date: cell.date,
              startTime: start,
              endTime: end,
              kind,
            })
          : await requestShift({ id: cell.shift?.id, storeId, date: cell.date, startTime: start, endTime: end });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast(result.message, 'success');
      onClose();
    });
  };

  const remove = () => {
    if (!cell.shift) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteShift(cell.shift!.id);
      toast(result.message, result.ok ? 'success' : 'error');
      if (result.ok) onClose();
    });
  };

  return (
    <Dialog open onClose={onClose} title={`${cell.profileName} さん — ${cell.date}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="shift-start">開始</Label>
            <Input id="shift-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="shift-end">終了</Label>
            <Input id="shift-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        {cell.mode === 'manage' && (
          <div>
            <Label htmlFor="shift-kind">種別</Label>
            <Select id="shift-kind" value={kind} onChange={(e) => setKind(e.target.value as ShiftKind)}>
              <option value="planned">仮シフト</option>
              <option value="requested">希望</option>
              <option value="confirmed">確定</option>
            </Select>
          </div>
        )}
        <FieldError message={error ?? undefined} />
      </div>
      <div className="mt-5 flex justify-between gap-2">
        {cell.shift && (cell.mode === 'manage' || cell.shift.kind === 'requested') ? (
          <Button variant="danger" onClick={remove} disabled={pending}>
            削除
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? '保存中…' : cell.mode === 'manage' ? '保存する' : '希望を提出'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
