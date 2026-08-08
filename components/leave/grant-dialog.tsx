'use client';

import { useState, useTransition } from 'react';
import { CalendarPlus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { todayJst } from '@/lib/format';
import { createLeaveGrant } from '@/app/app/leave/actions';

function addYears(dateStr: string, years: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y + years, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

/** 有給休暇の付与登録ダイアログ（attendance.approve 権限者用） */
export function LeaveGrantDialog({
  staffOptions,
  defaultExpiryYears = 2,
}: {
  staffOptions: { id: string; name: string }[];
  defaultExpiryYears?: number;
}) {
  const [open, setOpen] = useState(false);
  const today = todayJst();
  const [profileId, setProfileId] = useState('');
  const [days, setDays] = useState('10');
  const [grantedOn, setGrantedOn] = useState(today);
  const [expiresOn, setExpiresOn] = useState(addYears(today, defaultExpiryYears));
  const [reason, setReason] = useState<'annual' | 'adjustment'>('annual');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const handleGrantedOnChange = (value: string) => {
    setGrantedOn(value);
    setExpiresOn(addYears(value, defaultExpiryYears));
  };

  const submit = () => {
    const daysNum = Number(days);
    if (!profileId) {
      setError('対象スタッフを選択してください');
      return;
    }
    if (!(daysNum > 0)) {
      setError('付与日数は0より大きい値で入力してください');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createLeaveGrant({ profileId, days: daysNum, grantedOn, expiresOn, reason, note });
      toast(result.message, result.ok ? 'success' : 'error');
      if (result.ok) {
        close();
        setNote('');
        setProfileId('');
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <CalendarPlus className="h-3.5 w-3.5" />
        付与を登録
      </Button>
      <Dialog open={open} onClose={close} title="有給休暇の付与を登録">
        <div className="space-y-4">
          <div>
            <Label htmlFor="grant-staff">対象スタッフ</Label>
            <Select id="grant-staff" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">選択してください</option>
              {staffOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="grant-days">付与日数</Label>
              <Input id="grant-days" type="number" min="0.5" step="0.5" value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="grant-reason">理由</Label>
              <Select id="grant-reason" value={reason} onChange={(e) => setReason(e.target.value as 'annual' | 'adjustment')}>
                <option value="annual">年次付与</option>
                <option value="adjustment">調整</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="grant-granted">付与日</Label>
              <Input id="grant-granted" type="date" value={grantedOn} onChange={(e) => handleGrantedOnChange(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="grant-expires">失効日</Label>
              <Input id="grant-expires" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
              <p className="mt-1 text-xs text-gray-400">既定値: 付与日+{defaultExpiryYears}年（編集可）</p>
            </div>
          </div>
          <div>
            <Label htmlFor="grant-note">備考</Label>
            <Textarea id="grant-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="任意" />
          </div>
          <FieldError message={error ?? undefined} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? '登録中…' : '登録する'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
