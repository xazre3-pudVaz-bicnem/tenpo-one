'use client';

import { useState, useTransition } from 'react';
import { CalendarPlus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { addManualEntry } from '@/app/app/attendance/actions';

/** 打刻なしの勤怠（有給・欠勤）を手動追加するダイアログ（attendance.approve 権限者用） */
export function ManualEntryDialog({
  storeId,
  staffOptions,
  defaultDate,
}: {
  storeId: string;
  staffOptions: { id: string; name: string }[];
  defaultDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [workDate, setWorkDate] = useState(defaultDate);
  const [entryType, setEntryType] = useState<'paid_leave' | 'absent'>('paid_leave');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const submit = () => {
    if (!profileId) {
      setError('対象スタッフを選択してください');
      return;
    }
    if (!reason.trim()) {
      setError('理由を入力してください');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addManualEntry({ storeId, profileId, workDate, entryType, reason: reason.trim() });
      toast(result.message, result.ok ? 'success' : 'error');
      if (result.ok) {
        close();
        setReason('');
        setProfileId('');
      }
    });
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <CalendarPlus className="h-3.5 w-3.5" />
        勤怠を手動追加
      </Button>
      <Dialog open={open} onClose={close} title="勤怠を手動追加（有給・欠勤）">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="manual-staff">対象スタッフ</Label>
              <Select id="manual-staff" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                <option value="">選択してください</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="manual-date">日付</Label>
              <Input id="manual-date" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="manual-type">区分</Label>
            <Select id="manual-type" value={entryType} onChange={(e) => setEntryType(e.target.value as 'paid_leave' | 'absent')}>
              <option value="paid_leave">有給</option>
              <option value="absent">欠勤</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="manual-reason">理由（必須）</Label>
            <Textarea
              id="manual-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例: 事前に申請のあった有給休暇"
            />
          </div>
          <FieldError message={error ?? undefined} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? '追加中…' : '追加する'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
