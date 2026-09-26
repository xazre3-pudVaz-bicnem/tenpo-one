'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Label, FieldError, Select } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { saveBusinessHours, type BusinessHourInput } from '@/app/app/settings/hours/actions';
import { businessHourOptions } from '@/lib/business-hours';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/** 開店は当日（00:00〜23:45）、閉店・最終入店は翌朝 6:00（30:00）まで */
const OPEN_OPTIONS = businessHourOptions(0, 23 * 60 + 45);
const CLOSE_OPTIONS = businessHourOptions(0, 30 * 60);

function TimeSelect({
  value,
  onChange,
  options,
  disabled,
  label,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  options: string[];
  disabled?: boolean;
  label: string;
}) {
  return (
    <Select aria-label={label} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">--:--</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </Select>
  );
}

/**
 * 曜日別の営業時間。
 * - 閉店・最終入店は 24:00〜30:00（翌朝 6:00）まで選べる（同じ営業日として扱う。2026-09-27 Ronnie）
 * - 「まとめて変更」で 7 曜日を一度に入れて、そのまま保存できる（2026-09-27 Ronnie「全曜日に反映は要らない。営業時間を保存にして」）
 */
export function BusinessHoursForm({ storeId, initial }: { storeId: string; initial: BusinessHourInput[] }) {
  const [rows, setRows] = useState<BusinessHourInput[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  // まとめて変更の入力（開店・閉店・最終入店）
  const [bulk, setBulk] = useState<{ openTime: string | null; closeTime: string | null; lastEntryTime: string | null }>({
    openTime: initial.find((r) => !r.isClosed)?.openTime ?? null,
    closeTime: initial.find((r) => !r.isClosed)?.closeTime ?? null,
    lastEntryTime: initial.find((r) => !r.isClosed)?.lastEntryTime ?? null,
  });

  const update = (day: number, patch: Partial<BusinessHourInput>) => {
    setRows((prev) => prev.map((r) => (r.dayOfWeek === day ? { ...r, ...patch } : r)));
  };

  const save = (next: BusinessHourInput[]) => {
    setError(null);
    startTransition(async () => {
      const result = await saveBusinessHours(storeId, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast('営業時間を保存しました');
    });
  };

  /** まとめて変更: 全曜日に同じ時間を入れて、そのまま保存する（定休日の曜日は定休日のまま、時間だけ入れておく） */
  const saveBulk = () => {
    const next = rows.map((r) => ({ ...r, openTime: bulk.openTime, closeTime: bulk.closeTime, lastEntryTime: bulk.lastEntryTime }));
    setRows(next);
    save(next);
  };

  const handleSubmit = () => save(rows);

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        {/* まとめて変更（2026-09-27 Ronnie「一緒に変更する場合のも」。ボタン1つで全曜日に入れて保存まで） */}
        <div className="rounded-xl border border-line bg-lilac-soft/60 p-3">
          <p className="mb-2 text-sm font-semibold text-navy">
            営業時間をまとめて変更
            <span className="ml-2 text-xs font-normal text-ink-3">閉店・最終入店は 24:00〜30:00（翌朝6時）まで選べます</span>
          </p>
          <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
            <div>
              <Label className="text-xs">開店</Label>
              <TimeSelect label="開店（全曜日）" value={bulk.openTime} options={OPEN_OPTIONS} onChange={(v) => setBulk((b) => ({ ...b, openTime: v }))} />
            </div>
            <div>
              <Label className="text-xs">閉店</Label>
              <TimeSelect label="閉店（全曜日）" value={bulk.closeTime} options={CLOSE_OPTIONS} onChange={(v) => setBulk((b) => ({ ...b, closeTime: v }))} />
            </div>
            <div>
              <Label className="text-xs">最終入店</Label>
              <TimeSelect label="最終入店（全曜日）" value={bulk.lastEntryTime} options={CLOSE_OPTIONS} onChange={(v) => setBulk((b) => ({ ...b, lastEntryTime: v }))} />
            </div>
            <Button onClick={saveBulk} disabled={pending || !bulk.openTime || !bulk.closeTime}>
              {pending ? '保存中…' : '営業時間を保存'}
            </Button>
          </div>
        </div>

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
              <TimeSelect label={`${WEEKDAY_LABELS[r.dayOfWeek]}曜日の開店`} disabled={r.isClosed} value={r.openTime} options={OPEN_OPTIONS} onChange={(v) => update(r.dayOfWeek, { openTime: v })} />
            </div>
            <div>
              <Label className="text-xs">閉店</Label>
              <TimeSelect label={`${WEEKDAY_LABELS[r.dayOfWeek]}曜日の閉店`} disabled={r.isClosed} value={r.closeTime} options={CLOSE_OPTIONS} onChange={(v) => update(r.dayOfWeek, { closeTime: v })} />
            </div>
            <div className="col-span-2 sm:col-span-2">
              <Label className="text-xs">最終入店</Label>
              <TimeSelect label={`${WEEKDAY_LABELS[r.dayOfWeek]}曜日の最終入店`} disabled={r.isClosed} value={r.lastEntryTime} options={CLOSE_OPTIONS} onChange={(v) => update(r.dayOfWeek, { lastEntryTime: v })} />
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
