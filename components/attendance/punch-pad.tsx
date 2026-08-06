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
export function PunchPad({ storeId, state }: { storeId: string; state: PunchState }) {
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
      toast(result.message, result.ok ? 'success' : 'error');
    });
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      {BUTTONS.map(({ type, label, icon: Icon, variant }) => (
        <Button
          key={type}
          size="pos"
          variant={variant}
          disabled={pending || !enabledMap[type]}
          onClick={() => handlePunch(type)}
          className="h-24 flex-col gap-2 text-lg"
        >
          <Icon className="h-7 w-7" />
          {label}
        </Button>
      ))}
    </div>
  );
}
