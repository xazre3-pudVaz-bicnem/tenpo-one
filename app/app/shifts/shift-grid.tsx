'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  upsertShift,
  deleteShift,
  requestShift,
  requestShiftChange,
  rejectShiftChange,
  type ShiftKind,
} from './actions';

export interface ShiftLite {
  id: string;
  startTime: string; // 'HH:MM:SS'
  endTime: string;
  kind: ShiftKind;
  status: string;
  note: string | null;
}

export interface StaffRow {
  id: string;
  name: string;
  /** 自店舗以外のスタッフ（店舗間ヘルプ）か */
  isHelp?: boolean;
}

export interface OrgStaffOption {
  id: string;
  name: string;
  homeStores: string;
}

const KIND_LABEL: Record<ShiftKind, string> = { planned: '仮', requested: '希望', confirmed: '確定' };

function kindClass(kind: ShiftKind) {
  if (kind === 'confirmed') return 'bg-success-soft text-success border border-success/30';
  if (kind === 'requested') return 'bg-warning-soft text-warning border border-warning/30';
  return 'bg-white text-primary-deep border-2 border-primary/50';
}

function cellClass(shift: ShiftLite) {
  if (shift.status === 'change_requested') return 'bg-warning-soft text-warning border-2 border-warning';
  return kindClass(shift.kind);
}

function hhmm(t: string) {
  return t.slice(0, 5);
}

type CellMode = 'manage' | 'request' | 'change_request';

export function ShiftGrid({
  storeId,
  weekDates,
  staff,
  shiftsByKey,
  canManage,
  selfId,
  orgStaffOptions,
}: {
  storeId: string;
  weekDates: { date: string; label: string }[];
  staff: StaffRow[];
  shiftsByKey: Record<string, ShiftLite[]>;
  canManage: boolean;
  selfId: string;
  orgStaffOptions: OrgStaffOption[];
}) {
  const [cell, setCell] = useState<{
    profileId: string;
    profileName: string;
    date: string;
    shift: ShiftLite | null;
    mode: CellMode;
  } | null>(null);

  const openCell = (profileId: string, profileName: string, date: string, shifts: ShiftLite[]) => {
    if (canManage) {
      setCell({ profileId, profileName, date, shift: shifts[0] ?? null, mode: 'manage' });
      return;
    }
    if (profileId !== selfId) return;
    const primary = shifts[0];
    if (!primary) {
      setCell({ profileId, profileName, date, shift: null, mode: 'request' });
      return;
    }
    if (primary.kind === 'requested') {
      setCell({ profileId, profileName, date, shift: primary, mode: 'request' });
      return;
    }
    if (primary.status === 'published') {
      setCell({ profileId, profileName, date, shift: primary, mode: 'change_request' });
    }
    // change_requested（申請中）・draft は本人操作対象外
  };

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-navy">シフト表</h2>
        {canManage && (
          <CreateShiftDialog storeId={storeId} weekDates={weekDates} homeStaff={staff} orgStaffOptions={orgStaffOptions} />
        )}
      </div>
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
                  <div className="flex items-center gap-1.5">
                    {s.name}
                    {s.isHelp && <Badge tone="primary">ヘルプ</Badge>}
                  </div>
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
                          primary ? cellClass(primary) : 'border border-dashed border-gray-300 text-gray-300'
                        )}
                      >
                        {primary ? (
                          <>
                            <span className="font-semibold">
                              {hhmm(primary.startTime)}–{hhmm(primary.endTime)}
                            </span>
                            <span>{primary.status === 'change_requested' ? '変更申請中' : KIND_LABEL[primary.kind]}</span>
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

      {cell && <CellDialog storeId={storeId} cell={cell} onClose={() => setCell(null)} />}
    </>
  );
}

function CellDialog({
  storeId,
  cell,
  onClose,
}: {
  storeId: string;
  cell: { profileId: string; profileName: string; date: string; shift: ShiftLite | null; mode: CellMode };
  onClose: () => void;
}) {
  const [start, setStart] = useState(cell.shift ? hhmm(cell.shift.startTime) : '09:00');
  const [end, setEnd] = useState(cell.shift ? hhmm(cell.shift.endTime) : '17:00');
  const [kind, setKind] = useState<ShiftKind>(cell.shift?.kind ?? 'planned');
  const [dayOff, setDayOff] = useState(false);
  const [reason, setReason] = useState('');
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

  const reject = () => {
    if (!cell.shift) return;
    setError(null);
    startTransition(async () => {
      const result = await rejectShiftChange(cell.shift!.id);
      toast(result.message, result.ok ? 'success' : 'error');
      if (result.ok) onClose();
    });
  };

  const submitChangeRequest = () => {
    if (!reason.trim()) {
      setError('理由を入力してください');
      return;
    }
    if (!dayOff && start >= end) {
      setError('終了時刻は開始時刻より後にしてください');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await requestShiftChange({
        shiftId: cell.shift!.id,
        dayOff,
        desiredStart: dayOff ? null : start,
        desiredEnd: dayOff ? null : end,
        reason: reason.trim(),
      });
      toast(result.message, result.ok ? 'success' : 'error');
      if (result.ok) onClose();
    });
  };

  if (cell.mode === 'change_request') {
    return (
      <Dialog open onClose={onClose} title={`${cell.date} のシフト変更申請`}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            現在のシフト: {cell.shift ? `${hhmm(cell.shift.startTime)}–${hhmm(cell.shift.endTime)}` : '—'}
          </p>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={dayOff} onChange={(e) => setDayOff(e.target.checked)} />
            休み希望（出勤なし）
          </label>
          {!dayOff && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cr-start">希望開始</Label>
                <Input id="cr-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="cr-end">希望終了</Label>
                <Input id="cr-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
          )}
          <div>
            <Label htmlFor="cr-reason">理由（必須）</Label>
            <Textarea id="cr-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例: 通院のため" />
          </div>
          <FieldError message={error ?? undefined} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={submitChangeRequest} disabled={pending}>
            {pending ? '送信中…' : '変更申請を送る'}
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title={`${cell.profileName} さん — ${cell.date}`}>
      <div className="space-y-4">
        {cell.mode === 'manage' && cell.shift?.status === 'change_requested' && (
          <div className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
            <p className="font-semibold">変更申請中</p>
            <p className="mt-1 whitespace-pre-wrap">{cell.shift.note}</p>
          </div>
        )}
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
          {cell.mode === 'manage' && cell.shift?.status === 'change_requested' && (
            <Button variant="danger" onClick={reject} disabled={pending}>
              却下
            </Button>
          )}
          <Button onClick={save} disabled={pending}>
            {pending ? '保存中…' : cell.mode === 'manage' ? '保存する' : '希望を提出'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** シフト新規作成ダイアログ。店舗間ヘルプ（他店舗スタッフ）のアサインにも対応する。 */
function CreateShiftDialog({
  storeId,
  weekDates,
  homeStaff,
  orgStaffOptions,
}: {
  storeId: string;
  weekDates: { date: string; label: string }[];
  homeStaff: StaffRow[];
  orgStaffOptions: OrgStaffOption[];
}) {
  const [open, setOpen] = useState(false);
  const [includeHelp, setIncludeHelp] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [date, setDate] = useState(weekDates[0]?.date ?? '');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [kind, setKind] = useState<ShiftKind>('planned');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const options: { id: string; name: string; homeStores: string }[] = includeHelp
    ? orgStaffOptions
    : homeStaff.map((s) => ({ id: s.id, name: s.name, homeStores: '' }));

  const close = () => {
    setOpen(false);
    setError(null);
    setProfileId('');
  };

  const submit = () => {
    if (!profileId) {
      setError('スタッフを選択してください');
      return;
    }
    if (start >= end) {
      setError('終了時刻は開始時刻より後にしてください');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await upsertShift({ storeId, profileId, date, startTime: start, endTime: end, kind });
      toast(result.message, result.ok ? 'success' : 'error');
      if (result.ok) close();
      else setError(result.message);
    });
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        シフトを追加
      </Button>
      <Dialog open={open} onClose={close} title="シフトを追加">
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={includeHelp}
              onChange={(e) => {
                setIncludeHelp(e.target.checked);
                setProfileId('');
              }}
            />
            他店舗スタッフを含める（店舗間ヘルプ）
          </label>
          <div>
            <Label htmlFor="create-staff">スタッフ</Label>
            <Select id="create-staff" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">選択してください</option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.homeStores ? `（${s.homeStores}）` : ''}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="create-date">日付</Label>
            <Select id="create-date" value={date} onChange={(e) => setDate(e.target.value)}>
              {weekDates.map((d) => (
                <option key={d.date} value={d.date}>
                  {d.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="create-start">開始</Label>
              <Input id="create-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="create-end">終了</Label>
              <Input id="create-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="create-kind">種別</Label>
            <Select id="create-kind" value={kind} onChange={(e) => setKind(e.target.value as ShiftKind)}>
              <option value="planned">仮シフト</option>
              <option value="requested">希望</option>
              <option value="confirmed">確定</option>
            </Select>
          </div>
          <FieldError message={error ?? undefined} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? '保存中…' : '追加する'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
