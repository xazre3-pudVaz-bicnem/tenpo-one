'use client';

import { useState, useTransition } from 'react';
import { Tag } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, Label, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { changeEntryType, type EntryType } from '@/app/app/attendance/actions';

const ENTRY_TYPE_OPTIONS: { value: EntryType; label: string }[] = [
  { value: 'normal', label: '通常' },
  { value: 'late', label: '遅刻' },
  { value: 'early_leave', label: '早退' },
  { value: 'absent', label: '欠勤' },
  { value: 'paid_leave', label: '有給' },
  { value: 'holiday_work', label: '休日出勤' },
];

/** 勤怠一覧の各行から開く区分変更ダイアログ（attendance.approve 権限者用） */
export function EntryTypeDialog({
  timeEntryId,
  currentType,
  workDate,
}: {
  timeEntryId: string;
  currentType: EntryType;
  workDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [entryType, setEntryType] = useState<EntryType>(currentType);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const submit = () => {
    if (!reason.trim()) {
      setError('理由を入力してください');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await changeEntryType({ timeEntryId, entryType, reason: reason.trim() });
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
        <Tag className="h-3.5 w-3.5" />
        区分を変更
      </Button>
      <Dialog open={open} onClose={close} title={`${workDate} の区分変更`}>
        <div className="space-y-4">
          <div>
            <Label htmlFor="entry-type-select">勤怠区分</Label>
            <Select id="entry-type-select" value={entryType} onChange={(e) => setEntryType(e.target.value as EntryType)}>
              {ENTRY_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="entry-type-reason">変更理由（必須・操作履歴に記録されます）</Label>
            <Textarea
              id="entry-type-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例: 事前申請の有給を確認したため"
            />
          </div>
          <FieldError message={error ?? undefined} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? '保存中…' : '変更する'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
