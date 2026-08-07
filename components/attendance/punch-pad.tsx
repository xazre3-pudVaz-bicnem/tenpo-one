'use client';

import { useTransition } from 'react';
import { LogIn, LogOut, Coffee, Play, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { punch, type PunchEventType } from '@/app/app/attendance/actions';

export interface PunchState {
  canClockIn: boolean;
  canClockOut: boolean;
  canBreakStart: boolean;
  canBreakEnd: boolean;
}

const BUTTONS: { type: PunchEventType; label: string; icon: LucideIcon; variant: 'primary' | 'danger' | 'secondary' }[] = [
  { type: 'clock_in', label: '出勤', icon: LogIn, variant: 'primary' },
  { type: 'break_start', label: '休憩開始', icon: Coffee, variant: 'secondary' },
  { type: 'break_end', label: '休憩終了', icon: Play, variant: 'secondary' },
  { type: 'clock_out', label: '退勤', icon: LogOut, variant: 'danger' },
];

/** 個人打刻用の大きなタッチボタン */
export function PunchPad({
  storeId,
  state,
  onBreak = false,
}: {
  storeId: string;
  state: PunchState;
  /** 休憩中フラグ（time_entries.on_break）。true の場合は退勤ボタン付近に注意書きを表示する */
  onBreak?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const enabledMap: Record<PunchEventType, boolean> = {
    clock_in: state.canClockIn,
    clock_out: state.canClockOut,
    break_start: state.canBreakStart,
    break_end: state.canBreakEnd,
  };

  const handlePunch = (type: PunchEventType) => {
    startTransition(async () => {
      const result = await punch(storeId, type);
      toast(result.message, result.warning ? 'warning' : result.ok ? 'success' : 'error');
    });
  };

  return (
    <div>
      {onBreak && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <Coffee className="mt-0.5 h-4 w-4 shrink-0" />
          <p>休憩中です。退勤すると休憩を自動終了します。</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {BUTTONS.map(({ type, label, icon: Icon, variant }) => (
          <Button
            key={type}
            size="pos"
            variant={variant}
            disabled={pending || !enabledMap[type]}
            onClick={() => handlePunch(type)}
            className="min-h-24 flex-col gap-2 text-2xl transition-transform active:scale-95 disabled:active:scale-100"
          >
            <Icon className="h-8 w-8" />
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
