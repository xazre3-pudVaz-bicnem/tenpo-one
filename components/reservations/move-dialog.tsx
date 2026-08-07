'use client';

import { useState, useTransition } from 'react';
import { Loader2, CalendarClock } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { moveReservation } from '@/app/app/reservations/actions';

const STAY_OPTIONS = [60, 90, 120, 150, 180];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = (i % 2) * 30;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
});

function toJstParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` };
}

function nearestHalfHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const rounded = Math.round(m / 30) * 30;
  const hh = rounded === 60 ? (h + 1) % 24 : h;
  const mm = rounded === 60 ? 0 : rounded;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function nearestStay(minutes: number): number {
  return STAY_OPTIONS.reduce((best, cur) => (Math.abs(cur - minutes) < Math.abs(best - minutes) ? cur : best), STAY_OPTIONS[0]);
}

/** 予約の日時変更（開始時刻・滞在時間）。ドラッグ&ドロップは今回未実装で、このクリック操作で代替する。 */
export function MoveDialog({
  reservationId,
  startAt,
  endAt,
  disabled,
  triggerLabel = '日時変更',
}: {
  reservationId: string;
  startAt: string;
  endAt: string;
  disabled?: boolean;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [openKey, setOpenKey] = useState(0);

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          setOpenKey((k) => k + 1);
          setOpen(true);
        }}
        className="h-7 px-2 text-xs"
      >
        <CalendarClock className="h-3.5 w-3.5" />
        {triggerLabel}
      </Button>
      {open && (
        <MoveDialogContent
          key={openKey}
          reservationId={reservationId}
          startAt={startAt}
          endAt={endAt}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function MoveDialogContent({
  reservationId,
  startAt,
  endAt,
  onClose,
}: {
  reservationId: string;
  startAt: string;
  endAt: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const initial = toJstParts(startAt);
  const initialStay = Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(nearestHalfHour(initial.time));
  const [stayMinutes, setStayMinutes] = useState(nearestStay(initialStay));

  const submit = () => {
    startTransition(async () => {
      try {
        await moveReservation(reservationId, { date, time, stayMinutes });
        toast('日時を変更しました');
        onClose();
      } catch (e) {
        toast(e instanceof Error ? e.message : '日時の変更に失敗しました', 'error');
      }
    });
  };

  return (
    <Dialog open onClose={onClose} title="日時変更">
      <div className="space-y-3">
        <div>
          <Label htmlFor="move-date">来店日</Label>
          <input
            id="move-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-primary focus:outline-2 focus:outline-primary/30"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="move-time">開始時刻</Label>
            <Select id="move-time" value={time} onChange={(e) => setTime(e.target.value)}>
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="move-stay">滞在時間</Label>
            <Select id="move-stay" value={stayMinutes} onChange={(e) => setStayMinutes(Number(e.target.value))}>
              {STAY_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}分
                </option>
              ))}
            </Select>
          </div>
        </div>
        <p className="text-xs text-gray-400">終了予定 {TIME_OPTIONS.includes(time) ? addMinutes(time, stayMinutes) : ''}</p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          キャンセル
        </Button>
        <Button onClick={submit} disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          変更する
        </Button>
      </div>
    </Dialog>
  );
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
