'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  DURATION_MAX_MINUTES,
  DURATION_MIN_MINUTES,
  GUEST_COUNT_MAX,
  SEAT_DURATION_CHOICES,
  durationForCourse,
  durationLabel,
  isGuestCount,
  isSeatDuration,
  jstHm,
  seatDurationMinutes,
  type SeatCourseOption,
  type SeatTimeState,
} from '@/lib/seat-time';
import type { SeatTimeInput } from '@/app/app/pos/actions';

/**
 * 伝票画面の上から「席の時間・コース」を直すダイアログ（2026-09-22 店舗要望）。
 * 開始時間・時間（ワンタップ＋分で直接）・コースを1画面で直し、フロア・ハンディの残り時間に反映する。
 */
export function SeatTimeDialog({
  onClose,
  orderId,
  current,
  courses,
  setSeatTimeAction,
}: {
  onClose: () => void;
  orderId: string;
  current: SeatTimeState;
  courses: SeatCourseOption[];
  setSeatTimeAction: (orderId: string, input: SeatTimeInput) => Promise<void>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const inFlightRef = useRef(false);

  const initialStart = jstHm(current.startMs);
  const [startHm, setStartHm] = useState(initialStart);
  const [minutes, setMinutes] = useState<number | null>(seatDurationMinutes(current));
  const [courseId, setCourseId] = useState<string>(current.courseId ?? '');
  // 人数（伝票画面から開いたときだけ渡ってくる。2026-09-26 店舗要望「この画面で人数の変更ができるといい」）
  const hasGuests = current.guestCount != null;
  const [guests, setGuests] = useState<number>(current.guestCount ?? 1);
  const clampGuests = (n: number) => Math.min(GUEST_COUNT_MAX, Math.max(1, Math.floor(n) || 1));

  const endLabel =
    minutes != null && /^\d{2}:\d{2}$/.test(startHm)
      ? (() => {
          const [h, m] = startHm.split(':').map(Number);
          const total = h * 60 + m + minutes;
          return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
        })()
      : null;

  const handleSave = () => {
    if (inFlightRef.current) return;
    if (minutes != null && !isSeatDuration(minutes)) {
      toast(`時間は${DURATION_MIN_MINUTES}分〜${DURATION_MAX_MINUTES / 60}時間で入れてください`, 'error');
      return;
    }
    if (hasGuests && !isGuestCount(guests)) {
      toast(`人数は1〜${GUEST_COUNT_MAX}名で入れてください`, 'error');
      return;
    }
    const guestChanged = hasGuests && guests !== current.guestCount;
    inFlightRef.current = true;
    startTransition(async () => {
      try {
        await setSeatTimeAction(orderId, {
          startTime: startHm !== initialStart ? startHm : null,
          durationMinutes: minutes,
          courseId: courseId || null,
          guestCount: guestChanged ? guests : null,
        });
        toast(guestChanged ? `席の時間・コース・人数（${guests}名）を変更しました` : '席の時間・コースを変更しました', 'success');
        router.refresh();
        onClose();
      } catch (e) {
        toast(e instanceof Error ? e.message : '席の時間の変更に失敗しました', 'error');
      } finally {
        inFlightRef.current = false;
      }
    });
  };

  return (
    <Dialog open onClose={onClose} title="席の時間・コース / Seat time & course">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="seat-start">開始時間 / Start</Label>
            <input
              id="seat-start"
              type="time"
              value={startHm}
              onChange={(e) => setStartHm(e.target.value)}
              disabled={pending}
              className="h-12 w-full rounded-xl border border-gray-300 bg-white px-3 text-2xl font-bold tabular-nums text-navy focus:border-primary focus:outline-2 focus:outline-primary/30"
            />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">終了予定 / End</p>
            <p className="flex h-12 items-center text-2xl font-bold tabular-nums text-navy">{endLabel ?? '—'}</p>
          </div>
        </div>

        {hasGuests && (
          <div>
            <Label htmlFor="seat-guests">人数 / Guests</Label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="1名減らす"
                onClick={() => setGuests((v) => clampGuests(v - 1))}
                disabled={pending || guests <= 1}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-navy hover:bg-gray-50 disabled:opacity-40"
              >
                <Minus className="h-5 w-5" />
              </button>
              <input
                id="seat-guests"
                type="number"
                inputMode="numeric"
                min={1}
                max={GUEST_COUNT_MAX}
                value={guests}
                onChange={(e) => setGuests(clampGuests(Number(e.target.value)))}
                disabled={pending}
                className="h-12 w-24 rounded-xl border border-gray-300 bg-white text-center text-2xl font-bold tabular-nums text-navy focus:border-primary focus:outline-2 focus:outline-primary/30"
              />
              <span className="text-base font-semibold text-gray-500">名</span>
              <button
                type="button"
                aria-label="1名増やす"
                onClick={() => setGuests((v) => clampGuests(v + 1))}
                disabled={pending || guests >= GUEST_COUNT_MAX}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-navy hover:bg-gray-50 disabled:opacity-40"
              >
                <Plus className="h-5 w-5" />
              </button>
              {guests !== current.guestCount && (
                <span className="ml-1 text-xs text-gray-500">今 {current.guestCount}名 → {guests}名（金額は変わりません）</span>
              )}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1.5 text-sm font-medium text-gray-700">時間 / Duration</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {SEAT_DURATION_CHOICES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setMinutes(n)}
                disabled={pending}
                className={cn(
                  'rounded-xl border py-3 text-sm font-semibold transition-colors disabled:opacity-50',
                  minutes === n ? 'border-primary bg-primary-soft text-primary-deep' : 'border-gray-200 text-navy hover:bg-gray-50'
                )}
              >
                {durationLabel(n)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setMinutes(null)}
              disabled={pending}
              className={cn(
                'rounded-xl border py-3 text-sm font-semibold transition-colors disabled:opacity-50',
                minutes === null ? 'border-primary bg-primary-soft text-primary-deep' : 'border-gray-200 text-navy hover:bg-gray-50'
              )}
            >
              制限なし
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
            <input
              type="number"
              inputMode="numeric"
              min={DURATION_MIN_MINUTES}
              max={DURATION_MAX_MINUTES}
              step={5}
              value={minutes ?? ''}
              placeholder="分"
              onChange={(e) => setMinutes(e.target.value === '' ? null : Math.round(Number(e.target.value)))}
              disabled={pending}
              aria-label="時間（分）"
              className="h-10 w-24 rounded-lg border border-gray-300 bg-white px-2 text-center text-base tabular-nums"
            />
            分（{DURATION_MIN_MINUTES}分〜{DURATION_MAX_MINUTES / 60}時間）
          </div>
        </div>

        <div>
          <Label htmlFor="seat-course">コース / Course</Label>
          <Select
            id="seat-course"
            value={courseId}
            disabled={pending}
            onChange={(e) => {
              const id = e.target.value;
              setCourseId(id);
              const c = courses.find((x) => x.id === id) ?? null;
              setMinutes((cur) => durationForCourse(c, cur));
            }}
          >
            <option value="">なし（アラカルト） / None</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.durationMinutes ? `（${durationLabel(c.durationMinutes)}）` : ''}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-gray-500">
            コースを選ぶと時間がコースの所要時間になります。コースの料金は今まで通り商品から伝票に入れてください。
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={handleSave} disabled={pending}>
            {pending ? '保存中…' : '保存する'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
