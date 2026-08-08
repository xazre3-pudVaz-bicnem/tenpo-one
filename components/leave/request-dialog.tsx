'use client';

import { useState, useTransition } from 'react';
import { CalendarPlus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createLeaveRequest } from '@/app/app/leave/actions';

/** 有給休暇の申請ダイアログ（本人用）。日付・全休/半休・理由を入力する。 */
export function LeaveRequestDialog({ defaultDate }: { defaultDate: string }) {
  const [open, setOpen] = useState(false);
  const [leaveDate, setLeaveDate] = useState(defaultDate);
  const [fraction, setFraction] = useState<'1' | '0.5'>('1');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const submit = () => {
    if (!leaveDate) {
      setError('申請日を入力してください');
      return;
    }
    if (!reason.trim()) {
      setError('理由を入力してください');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createLeaveRequest({
        leaveDate,
        fraction: fraction === '0.5' ? 0.5 : 1,
        reason: reason.trim(),
      });
      toast(result.message, result.warning ? 'warning' : result.ok ? 'success' : 'error');
      if (result.ok) {
        close();
        setReason('');
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <CalendarPlus className="h-3.5 w-3.5" />
        有給を申請
      </Button>
      <Dialog open={open} onClose={close} title="有給休暇を申請">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="leave-req-date">取得日</Label>
              <Input id="leave-req-date" type="date" value={leaveDate} onChange={(e) => setLeaveDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="leave-req-fraction">区分</Label>
              <Select id="leave-req-fraction" value={fraction} onChange={(e) => setFraction(e.target.value as '1' | '0.5')}>
                <option value="1">全休（1.0日）</option>
                <option value="0.5">半休（0.5日）</option>
              </Select>
              <p className="mt-1 text-xs text-gray-400">時間単位の有給は今後対応予定です</p>
            </div>
          </div>
          <div>
            <Label htmlFor="leave-req-reason">理由</Label>
            <Textarea
              id="leave-req-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例: 私用のため"
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
