'use client';

import { useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { requestCorrection } from '@/app/app/attendance/actions';

/** 勤怠一覧の各行から開く修正申請ダイアログ */
export function CorrectionDialog({
  storeId,
  profileId,
  workDate,
  timeEntryId,
  defaultClockIn,
  defaultClockOut,
  defaultBreakMinutes,
}: {
  storeId: string;
  profileId: string;
  workDate: string;
  timeEntryId: string | null;
  defaultClockIn: string;
  defaultClockOut: string;
  defaultBreakMinutes: number;
}) {
  const [open, setOpen] = useState(false);
  const [clockIn, setClockIn] = useState(defaultClockIn);
  const [clockOut, setClockOut] = useState(defaultClockOut);
  const [breakMinutes, setBreakMinutes] = useState(String(defaultBreakMinutes));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const submit = () => {
    if (!clockIn || !clockOut) {
      setError('出勤時刻・退勤時刻を入力してください');
      return;
    }
    if (!reason.trim()) {
      setError('理由を入力してください');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await requestCorrection({
        storeId,
        profileId,
        timeEntryId,
        workDate,
        desiredClockIn: clockIn,
        desiredClockOut: clockOut,
        breakMinutes: Math.max(0, Number(breakMinutes) || 0),
        reason: reason.trim(),
      });
      toast(result.message, result.ok ? 'success' : 'error');
      if (result.ok) {
        close();
        setReason('');
      }
    });
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" />
        修正申請
      </Button>
      <Dialog open={open} onClose={close} title={`${workDate} の修正申請`}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="corr-in">希望出勤時刻</Label>
              <Input id="corr-in" type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="corr-out">希望退勤時刻</Label>
              <Input id="corr-out" type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="corr-break">休憩時間（分）</Label>
            <Input
              id="corr-break"
              type="number"
              min={0}
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="corr-reason">理由（必須）</Label>
            <Textarea
              id="corr-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例: 打刻を忘れてしまいました"
            />
          </div>
          <FieldError message={error ?? undefined} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? '送信中…' : '申請する'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
