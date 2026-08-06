'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { saveBusinessHours, type BusinessHourInput } from '@/app/app/settings/hours/actions';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export function BusinessHoursForm({ storeId, initial }: { storeId: string; initial: BusinessHourInput[] }) {
  const [rows, setRows] = useState<BusinessHourInput[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const update = (day: number, patch: Partial<BusinessHourInput>) => {
    setRows((prev) => prev.map((r) => (r.dayOfWeek === day ? { ...r, ...patch } : r)));
  };

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveBusinessHours(storeId, rows);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast('営業時間を保存しました');
    });
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        {rows.map((r) => (
          <div
            key={r.dayOfWeek}
            className="grid grid-cols-2 items-center gap-3 border-b border-gray-100 pb-3 last:border-0 last:pb-0 sm:grid-cols-6"
          >
            <p className="font-medium text-navy">{WEEKDAY_LABELS[r.dayOfWeek]}曜日</p>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                checked={r.isClosed}
                onChange={(e) => update(r.dayOfWeek, { isClosed: e.target.checked })}
              />
              定休日
            </label>
            <div>
              <Label className="text-xs">開店</Label>
              <Input
                type="time"
                disabled={r.isClosed}
                value={r.openTime ?? ''}
                onChange={(e) => update(r.dayOfWeek, { openTime: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">閉店</Label>
              <Input
                type="time"
                disabled={r.isClosed}
                value={r.closeTime ?? ''}
                onChange={(e) => update(r.dayOfWeek, { closeTime: e.target.value })}
              />
            </div>
            <div className="col-span-2 sm:col-span-2">
              <Label className="text-xs">最終入店</Label>
              <Input
                type="time"
                disabled={r.isClosed}
                value={r.lastEntryTime ?? ''}
                onChange={(e) => update(r.dayOfWeek, { lastEntryTime: e.target.value })}
              />
            </div>
          </div>
        ))}

        <FieldError message={error ?? undefined} />

        <div className="flex justify-end pt-2">
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? '保存中…' : '営業時間を保存'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
