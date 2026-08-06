'use client';

import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { formatDate, weekdayJa } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { addHoliday, deleteHoliday } from '@/app/app/settings/hours/actions';

export interface HolidayRow {
  id: string;
  holidayDate: string;
  name: string | null;
  isTemporary: boolean;
}

export function HolidaysPanel({ storeId, initial }: { storeId: string; initial: HolidayRow[] }) {
  const [holidays, setHolidays] = useState<HolidayRow[]>(initial);
  // サーバーから渡されるinitialが更新されたら（追加・再取得等）ローカル表示も追従させる
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setHolidays(initial);
  }
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [isTemporary, setIsTemporary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { toast } = useToast();

  const handleAdd = () => {
    setError(null);
    if (!date) {
      setError('日付を選択してください');
      return;
    }
    startTransition(async () => {
      const result = await addHoliday({ storeId, holidayDate: date, name, isTemporary });
      if (result.error) {
        setError(result.error);
        return;
      }
      setDate('');
      setName('');
      setIsTemporary(false);
      toast('休業日を追加しました');
    });
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
    startTransition(async () => {
      const result = await deleteHoliday(id, storeId);
      if (result.error) {
        toast(result.error, 'error');
        setDeletingId(null);
        return;
      }
      setHolidays((prev) => prev.filter((h) => h.id !== id));
      toast('休業日を削除しました');
      setDeletingId(null);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>休業日</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
          <div>
            <Label htmlFor="holiday-date">日付</Label>
            <Input id="holiday-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="holiday-name">名称</Label>
            <Input id="holiday-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="年末年始休業 等" />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              checked={isTemporary}
              onChange={(e) => setIsTemporary(e.target.checked)}
            />
            臨時休業
          </label>
          <Button onClick={handleAdd} disabled={pending}>
            追加する
          </Button>
        </div>
        <FieldError message={error ?? undefined} />

        {holidays.length === 0 ? (
          <EmptyState title="登録された休業日がありません" className="py-8" />
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <span className="font-medium text-navy">
                    {formatDate(h.holidayDate)}（{weekdayJa(h.holidayDate)}）
                  </span>
                  {h.name && <span className="ml-2 text-gray-500">{h.name}</span>}
                  {h.isTemporary && (
                    <Badge tone="warning" className="ml-2">
                      臨時
                    </Badge>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(h.id)}
                  disabled={pending && deletingId === h.id}
                  aria-label="削除"
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
